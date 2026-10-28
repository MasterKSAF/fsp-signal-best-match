import { createHash, randomUUID } from 'node:crypto';
import { and, count, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { db, signalRequirementPreviewsTable as previews, signalContextRevisionsTable as history,
  signalDependencyEpochTable as epochs, signalNeedsTable as needs, signalJobsTable as jobs,
  signalNeedSkillLevelsTable as levels, signalJobRequirementsTable as details, signalUsersTable as users, signalComputationTasksTable as tasks,
  signalSelectionFeedbackTable as feedback, signalContextExclusionsTable as exclusions, signalRefinementProposalsTable as proposals,
  type ComputationVersions } from '@workspace/db';
import { canonicalJson } from './canonical-json';
import { currentComputationVersions, enqueueComputation, claimComputation, publishComputation, readCurrentComputation, StaleComputationError, ComputationAccessError } from './signal-computation-tasks';
import { loadOwnedSelectionContext } from './signal-employer-context';
import { selectionMatchNeed, type SelectionContextDto, type SelectionContextRef } from './selection-context-contract';
import { loadSelectionResumes } from './employer-selection-service';
import { evaluateResumeCandidates } from './signal-resume-evaluation';
import { selectMatchingResumes } from './signal-resume-catalog';
import { rankMatches } from './signal-matching';
import { RecruitingSkillRequirementsSchema, validateRecruitingRequirements, RequirementModeSchema } from './recruiting-requirements';
import { canonicalSkillKey, resolveSkill } from './skill-catalog';
import { poolScopeForAccount } from './signal-pool-scope';

export class RefinementError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const RequirementPatchSchema = z.object({
  grade: z.enum(['Junior','Middle','Senior']).optional(), gradeMode: RequirementModeSchema.optional(),
  requiredSkills: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
  skillRequirements: RecruitingSkillRequirementsSchema.optional(),
  workFormat: z.enum(['Удалённо','Офис','Гибрид']).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Укажите изменение требований.');
export type RequirementPatch = z.infer<typeof RequirementPatchSchema>;
export type PreviewActor = { actorId: number; companyId: number };
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sameVersions = (a: ComputationVersions, b: ComputationVersions) => canonicalJson(a) === canonicalJson(b);

export function patchedRequirements(context: SelectionContextDto, raw: unknown) {
  const parsed = RequirementPatchSchema.safeParse(raw);
  if (!parsed.success) throw new RefinementError(400,'invalid_patch',parsed.error.issues[0]?.message ?? 'Проверьте требования.');
  const patch = parsed.data, skills = patch.requiredSkills ?? context.requiredSkills;
  if (new Set(skills.map(canonicalSkillKey)).size !== skills.length || skills.some(skill => !resolveSkill(skill)))
    throw new RefinementError(400,'invalid_skills','Выберите навыки из справочника без повторов.');
  const validated = validateRecruitingRequirements(skills,patch.skillRequirements,undefined,context.skillRequirements,context.requiredSkillLevels);
  if (!validated.success) throw new RefinementError(400,'invalid_requirements',validated.fieldErrors.skillRequirements);
  return { ...context, ...patch, requiredSkills: skills, skillRequirements: validated.data, requiredSkillLevels: validated.levels };
}
function comparisonFields(context: SelectionContextDto) {
  return { grade:context.grade, gradeMode:context.gradeMode, requiredSkills:context.requiredSkills,
    skillRequirements:context.skillRequirements, workFormat:context.workFormat };
}
/** Buckets and suppression apply after authorization; no individual identities in this DTO. */
export function previewCountBand(value: number) { return value < 5 ? 'Меньше 5' : `${Math.floor(value/5)*5}–${Math.floor(value/5)*5+4}`; }
export function publicRequirementPreview(row: typeof previews.$inferSelect) {
  const data = row.result as { beforeCount: number; afterCount: number; before: Record<string,unknown>; after: Record<string,unknown> };
  return { id:row.id, context:{type:row.contextType,id:row.contextId}, baseRevision:row.baseRevision,
    patch:row.patch, patchHash:row.patchHash, expiresAt:row.expiresAt.toISOString(), appliedRevision:row.appliedRevision,
    currentPool:previewCountBand(data.beforeCount), expectedPool:previewCountBand(data.afterCount),
    smallGroupSuppressed:data.beforeCount<5 || data.afterCount<5 || Math.abs(data.afterCount-data.beforeCount)<5,
    emptyResult:data.afterCount===0,
    diff:Object.keys(row.patch).map(field=>({field,before:data.before[field]??null,after:data.after[field]??null})),
    versions:{algorithm:row.versions.algorithm,requirementsPolicy:row.versions.requirementsPolicy,contextRevision:row.versions.contextRevision},
  };
}
export async function readOwnedPreview(actor: PreviewActor, id: string) {
  // Context ACL is always read again, including for an already applied command.
  const [row] = await db.select().from(previews).where(and(eq(previews.id,id),eq(previews.actorId,actor.actorId),eq(previews.companyId,actor.companyId)));
  if (!row) throw new ComputationAccessError('Предварительный расчёт недоступен.');
  const current = await currentComputationVersions(actor.actorId,actor.companyId,{type:row.contextType,id:row.contextId});
  if (!sameVersions(row.versions,current) || +row.expiresAt <= Date.now()) throw new StaleComputationError('Расчёт устарел. Обновите его.');
  return row;
}
export async function createRequirementPreview(actor: PreviewActor, ref: SelectionContextRef, rawPatch: unknown, commandKey: string, refinement?: {feedbackId:string;excludeCandidateIds:number[]}) {
  const patch = RequirementPatchSchema.parse(rawPatch);
  const initial = await loadOwnedSelectionContext(actor.companyId,ref);
  if (!initial?.active) throw new ComputationAccessError('Контекст недоступен.');
  patchedRequirements(initial.context,patch);
  const task = await enqueueComputation({...actor,context:ref,kind:'requirements-preview',commandKey,input:{patch,...(refinement?{refinement}:{})}});
  const prior = await db.select().from(previews).where(eq(previews.id,task.id));
  if (prior[0]) { await readOwnedPreview(actor,task.id); return publicRequirementPreview(prior[0]); }
  if (task.state !== 'ready') {
    const leased = await claimComputation(task.id);
    if (!leased) throw new RefinementError(409,'preview_processing','Расчёт уже выполняется. Повторите запрос с тем же ключом.');
    const loaded = await loadOwnedSelectionContext(actor.companyId,ref);
    if (!loaded?.active || loaded.context.version !== leased.versions.contextRevision) {
      await publishComputation(task.id,leased.leaseFence,{});
      throw new StaleComputationError('Требования изменились. Запустите новый расчёт.');
    }
    const after = patchedRequirements(loaded.context,patch);
    const [user] = await db.select().from(users).where(eq(users.id,actor.actorId));
    const scope = poolScopeForAccount(user);
    // Same professional pool and final eligibility as the actual selection; no relaxed fallback.
    const authorized = await loadSelectionResumes(actor.companyId,scope,'matching');
    const at = new Date();
    const select = (context: SelectionContextDto) => rankMatches(selectMatchingResumes(evaluateResumeCandidates(selectionMatchNeed(context),authorized,scope.demoMode,at).filter(row=>row.evaluation.eligible)));
    const local = await db.select().from(exclusions).where(and(eq(exclusions.companyId,actor.companyId),eq(exclusions.contextType,ref.type),eq(exclusions.contextId,ref.id),eq(exclusions.contextRevision,loaded.context.version),eq(exclusions.active,true)));
    const existingExcluded=new Set(local.map(row=>row.candidateId));
    const beforePool=select(loaded.context).filter(row=>!existingExcluded.has(row.candidate.userId));
    const afterExcluded=new Set(refinement?.excludeCandidateIds??[]);
    const afterPool=select(after).filter(row=>!afterExcluded.has(row.candidate.userId));
    const published = await publishComputation(task.id,leased.leaseFence,{
      beforeCount:beforePool.length,afterCount:afterPool.length,
      before:comparisonFields(loaded.context),after:comparisonFields(after),...(refinement?{refinement}:{}),
    });
    if (!published.published) throw new StaleComputationError('Данные изменились во время расчёта. Запустите новый расчёт.');
  }
  // One short critical section: snapshot validation, rate limit and persisted receipt.
  return db.transaction(async tx => {
    await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('update');
    const versions = await currentComputationVersions(actor.actorId,actor.companyId,ref,tx);
    if (!sameVersions(versions,task.versions)) throw new StaleComputationError('Данные изменились. Запустите новый расчёт.');
    const [currentTask] = await tx.select().from(tasks).where(eq(tasks.id,task.id));
    if (currentTask?.state !== 'ready' || !currentTask.result) throw new StaleComputationError('Расчёт ещё не готов.');
    const [existing] = await tx.select().from(previews).where(eq(previews.id,task.id));
    if (existing) return publicRequirementPreview(existing);
    const [daily] = await tx.select({n:count()}).from(previews).where(and(eq(previews.companyId,actor.companyId),eq(previews.contextType,ref.type),eq(previews.contextId,ref.id),gte(previews.createdAt,new Date(Date.now()-86400_000))));
    if (Number(daily.n)>=20) throw new RefinementError(429,'preview_limit','Лимит расчётов для этого подбора на сегодня исчерпан.');
    const [saved] = await tx.insert(previews).values({id:task.id,...actor,contextType:ref.type,contextId:ref.id,baseRevision:versions.contextRevision,
      patch,patchHash:hash(patch),versions,result:currentTask.result,expiresAt:new Date(Date.now()+10*60_000)}).returning();
    return publicRequirementPreview(saved);
  });
}
export async function applyRequirementPreview(actor: PreviewActor, id: string, commandKey: string) {
  return db.transaction(async tx => {
    await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('update');
    const [row] = await tx.select().from(previews).where(and(eq(previews.id,id),eq(previews.actorId,actor.actorId),eq(previews.companyId,actor.companyId))).for('update');
    if (!row) throw new ComputationAccessError('Расчёт недоступен.');
    const ref = {type:row.contextType,id:row.contextId};
    const versions = await currentComputationVersions(actor.actorId,actor.companyId,ref,tx);
    if (row.appliedRevision) {
      if (row.applyCommand !== commandKey) throw new RefinementError(409,'command_conflict','Этот расчёт уже применён другой командой.');
      return {appliedRevision:row.appliedRevision,parentRevision:row.baseRevision,replayed:true};
    }
    if (+row.expiresAt<=Date.now() || !sameVersions(versions,row.versions) || hash(row.patch)!==row.patchHash)
      throw new StaleComputationError('Расчёт устарел. Требования не изменены.');
    const loaded = await loadOwnedSelectionContext(actor.companyId,ref,tx,{lock:true});
    if (!loaded?.active || loaded.context.version !== row.baseRevision) throw new StaleComputationError('Редакция требований изменилась.');
    const next = patchedRequirements(loaded.context,row.patch), now = new Date(), revision=row.baseRevision+1;
    if (ref.type==='need') {
      await tx.update(needs).set({grade:next.grade,gradeMode:next.gradeMode,requiredSkills:next.requiredSkills,skillRequirements:next.skillRequirements,workFormat:next.workFormat,revision,updatedAt:now}).where(and(eq(needs.id,ref.id),eq(needs.companyId,actor.companyId),eq(needs.revision,row.baseRevision)));
      await tx.insert(levels).values({needId:ref.id,levels:next.requiredSkillLevels}).onConflictDoUpdate({target:levels.needId,set:{levels:next.requiredSkillLevels}});
    } else {
      await tx.update(jobs).set({grade:next.grade,gradeMode:next.gradeMode,skills:next.requiredSkills,workFormat:next.workFormat,version:revision,updatedAt:now}).where(and(eq(jobs.id,ref.id),eq(jobs.companyId,actor.companyId),eq(jobs.version,row.baseRevision)));
      await tx.insert(details).values({jobId:ref.id,skillRequirements:next.skillRequirements??[]}).onConflictDoUpdate({target:details.jobId,set:{skillRequirements:next.skillRequirements??[]}});
    }
    await tx.insert(history).values({id:randomUUID(),...actor,contextType:ref.type,contextId:ref.id,revision,parentRevision:row.baseRevision,previewId:row.id,before:comparisonFields(loaded.context),after:comparisonFields(next)});
    const refinement=row.result.refinement as {feedbackId:string;excludeCandidateIds:number[]}|undefined;
    if(refinement) {
      const [source] = await tx.select().from(feedback).where(and(eq(feedback.id,refinement.feedbackId),eq(feedback.actorId,actor.actorId),eq(feedback.companyId,actor.companyId),eq(feedback.contextType,ref.type),eq(feedback.contextId,ref.id),eq(feedback.contextRevision,row.baseRevision)));
      if(!source)throw new RefinementError(409,'feedback_conflict','Основание изменения недоступно.');
      for(const candidateId of refinement.excludeCandidateIds) {
        if(candidateId!==source.candidateId || source.reason!=='reviewed')throw new RefinementError(400,'invalid_exclusion','Исключение не связано с обратной связью.');
        await tx.insert(exclusions).values({id:randomUUID(),...actor,contextType:ref.type,contextId:ref.id,contextRevision:revision,candidateId,resumeId:source.resumeId,feedbackId:source.id}).onConflictDoNothing();
      }
      await tx.update(proposals).set({appliedRevision:revision}).where(eq(proposals.previewId,row.id));
    }
    await tx.update(previews).set({appliedRevision:revision,applyCommand:commandKey}).where(eq(previews.id,id));
    return {appliedRevision:revision,parentRevision:row.baseRevision,replayed:false};
  });
}
