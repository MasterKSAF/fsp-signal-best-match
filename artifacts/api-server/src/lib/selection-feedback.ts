import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, signalSelectionFeedbackTable as feedback, signalRefinementProposalsTable as proposals, signalDependencyEpochTable as epochs, signalUsersTable as users } from '@workspace/db';
import { canonicalJson } from './canonical-json';
import { currentComputationVersions, ComputationAccessError, StaleComputationError } from './signal-computation-tasks';
import { loadOwnedSelectionContext } from './signal-employer-context';
import { loadSelectionResumes } from './employer-selection-service';
import { poolScopeForAccount } from './signal-pool-scope';
import { canonicalSkillKey } from './skill-catalog';
import { SelectionContextRefSchema, type SelectionContextDto } from './selection-context-contract';
import { RequirementPatchSchema, RefinementError, createRequirementPreview, type PreviewActor, type RequirementPatch } from './requirement-preview';

export const SelectionFeedbackInput=z.object({
  context:SelectionContextRefSchema,contextRevision:z.number().int().positive(),candidateId:z.number().int().positive(),resumeId:z.number().int().positive(),resumeRevision:z.number().int().positive(),
  reason:z.enum(['proof_required','level_required','conditions','reviewed','other']),skill:z.string().trim().min(1).max(100).optional(),targetLevel:z.enum(['Junior','Middle','Senior']).optional(),
  note:z.string().trim().max(1500).default(''),commandKey:z.string().min(8).max(120),manualPatch:RequirementPatchSchema.optional(),
}).strict();
type Input=z.infer<typeof SelectionFeedbackInput>;
export function feedbackRequirementPatch(context:SelectionContextDto,input:Pick<Input,'reason'|'skill'|'targetLevel'|'manualPatch'>):RequirementPatch {
  if(input.manualPatch)return input.manualPatch;
  const requirements:NonNullable<SelectionContextDto['skillRequirements']>=context.skillRequirements??context.requiredSkills.map(skill=>({skill,mode:'verified' as const}));
  if(input.reason==='proof_required'||input.reason==='level_required') {
    const key=input.skill?canonicalSkillKey(input.skill):'',existing=requirements.find(item=>canonicalSkillKey(item.skill)===key);
    if(!existing)throw new RefinementError(400,'skill_not_required','Выберите навык из требований этого подбора.');
    if(input.reason==='level_required'&&!input.targetLevel)throw new RefinementError(400,'level_required','Укажите минимальный уровень навыка.');
    const rank={Junior:1,Middle:2,Senior:3};
    if(input.reason==='level_required'&&existing.level&&rank[input.targetLevel!]<=rank[existing.level])throw new RefinementError(400,'level_not_higher','Выберите уровень выше текущего требования.');
    return {skillRequirements:requirements.map(item=>canonicalSkillKey(item.skill)===key?{...item,mode:'verified',...(input.reason==='level_required'?{level:input.targetLevel}:{})}:item)};
  }
  // Free text is retained for the employer. It never becomes an executable instruction or inferred personal filter.
  return {skillRequirements:requirements};
}
export async function createFeedbackProposal(actor:PreviewActor,raw:unknown) {
  const input=SelectionFeedbackInput.parse(raw), payloadHash=createHash('sha256').update(canonicalJson(input)).digest('hex');
  const saved=await db.transaction(async tx=>{
    await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('share');
    const versions=await currentComputationVersions(actor.actorId,actor.companyId,input.context,tx);
    const [prior]=await tx.select().from(feedback).where(and(eq(feedback.actorId,actor.actorId),eq(feedback.companyId,actor.companyId),eq(feedback.commandKey,input.commandKey)));
    if(prior){if(prior.payloadHash!==payloadHash)throw new RefinementError(409,'command_conflict','Ключ уже использован для другого действия.');return prior;}
    if(versions.contextRevision!==input.contextRevision)throw new StaleComputationError('Требования изменились. Обновите подбор.');
    const [user]=await tx.select().from(users).where(eq(users.id,actor.actorId));
    const [candidate]=await loadSelectionResumes(actor.companyId,poolScopeForAccount(user),'matching',{resumeIds:[input.resumeId]});
    if(!candidate||candidate.userId!==input.candidateId)throw new ComputationAccessError('Это резюме недоступно для подбора.');
    if(candidate.resumeRevision!==input.resumeRevision)throw new StaleComputationError('Кандидат изменил резюме. Обновите карточку.');
    const loaded=await loadOwnedSelectionContext(actor.companyId,input.context,tx);if(!loaded)throw new ComputationAccessError('Контекст недоступен.');
    feedbackRequirementPatch(loaded.context,input);
    const [row]=await tx.insert(feedback).values({id:randomUUID(),...actor,contextType:input.context.type,contextId:input.context.id,contextRevision:input.contextRevision,candidateId:input.candidateId,resumeId:input.resumeId,resumeRevision:input.resumeRevision,reason:input.reason,skill:input.skill,targetLevel:input.targetLevel,note:input.note,commandKey:input.commandKey,payloadHash}).onConflictDoNothing().returning();
    if(row)return row;
    const [concurrent]=await tx.select().from(feedback).where(and(eq(feedback.actorId,actor.actorId),eq(feedback.companyId,actor.companyId),eq(feedback.commandKey,input.commandKey)));
    if(!concurrent||concurrent.payloadHash!==payloadHash)throw new RefinementError(409,'command_conflict','Конфликт повторной команды.');return concurrent;
  });
  const context=await loadOwnedSelectionContext(actor.companyId,input.context);
  if(!context||context.context.version!==saved.contextRevision)throw new StaleComputationError('Требования изменились после обратной связи.');
  const patch=feedbackRequirementPatch(context.context,input),excludeCandidateIds=saved.reason==='reviewed'?[saved.candidateId]:[];
  const preview=await createRequirementPreview(actor,input.context,patch,`feedback:${saved.id}`,{feedbackId:saved.id,excludeCandidateIds});
  const [proposal]=await db.insert(proposals).values({id:randomUUID(),...actor,feedbackId:saved.id,previewId:preview.id,proposedExclusions:excludeCandidateIds.map(candidateId=>({candidateId,resumeId:saved.resumeId}))}).onConflictDoNothing().returning();
  const [prior]=proposal?[]:await db.select().from(proposals).where(eq(proposals.feedbackId,saved.id));
  return {id:proposal?.id??prior!.id,parentRevision:saved.contextRevision,sourceFeedbackIds:[saved.id],reason:saved.reason,proposedExclusions:excludeCandidateIds.map(candidateId=>({candidateId,resumeId:saved.resumeId})),preview};
}
