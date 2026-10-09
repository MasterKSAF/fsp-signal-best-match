import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { db, signalNeedsTable as needs, signalJobsTable as jobs,
  signalNeedSkillLevelsTable as levels, signalJobRequirementsTable as requirements,
  signalShortlistTable as shortlist, signalApplicationsTable as applications } from '@workspace/db';
import { selectionMatchNeed, requirementLevels, selectionContextActive, selectionContextKey,
  type SelectionContextDto, type SelectionContextRef } from './selection-context-contract';
import { interpretSkillRequirements, REQUIREMENTS_VERSION } from './recruiting-requirements';

export type SelectionContextReader = Pick<typeof db, 'select'>;
export type LoadedSelectionContext = { context: SelectionContextDto; matchNeed: ReturnType<typeof selectionMatchNeed>; active: boolean };
export function needSelectionContext(need: typeof needs.$inferSelect, requiredSkillLevels: SelectionContextDto['requiredSkillLevels'] = {}): SelectionContextDto {
  return { type:'need', id:need.id, version:need.revision, title:need.title, specialization:need.specialization,
    grade:need.grade, requiredSkills:need.requiredSkills, requiredSkillLevels, desirableSkills:need.desirableSkills,
    gradeMode:need.gradeMode, skillRequirements:interpretSkillRequirements(need.requiredSkills,need.skillRequirements,requiredSkillLevels),requirementsVersion:REQUIREMENTS_VERSION,
    description:need.description, workFormat:need.workFormat, salaryMin:need.salaryMin, salaryMax:need.salaryMax,
    salaryPeriod:need.salaryPeriod, salaryType:need.salaryType, status:need.status, updatedAt:need.updatedAt.toISOString() };
}
export function jobSelectionContext(job: typeof jobs.$inferSelect, skillRequirements: typeof requirements.$inferSelect.skillRequirements = []): SelectionContextDto {
  return { type:'job', id:job.id, version:job.version, title:job.title, specialization:job.specialization,
    grade:job.grade as SelectionContextDto['grade'], requiredSkills:job.skills,
    gradeMode:job.gradeMode,skillRequirements:interpretSkillRequirements(job.skills,skillRequirements),requirementsVersion:REQUIREMENTS_VERSION,
    requiredSkillLevels:requirementLevels(skillRequirements), desirableSkills:[], description:job.description,
    workFormat:job.workFormat, salaryMin:job.salaryMin, salaryMax:job.salaryMax, salaryPeriod:job.salaryPeriod,
    salaryType:job.salaryType, status:job.status, updatedAt:job.updatedAt.toISOString() };
}
/** Read one typed, owned, non-deleted context. Never creates a hidden private need.
 * Optional lock lets mutations evaluate requirements in the same transaction. */
export async function loadOwnedSelectionContext(companyId: number, ref: SelectionContextRef,
  reader: SelectionContextReader = db, options: {lock?:boolean} = {}): Promise<LoadedSelectionContext | null> {
  let context: SelectionContextDto;
  if (ref.type === 'need') {
    const query = reader.select().from(needs).where(and(eq(needs.companyId,companyId),eq(needs.id,ref.id),isNull(needs.deletedAt))).limit(1);
    const [need] = await (options.lock ? query.for('update') : query);
    if (!need) return null;
    const [row] = await reader.select().from(levels).where(eq(levels.needId,need.id)).limit(1);
    context = needSelectionContext(need,row?.levels);
  } else {
    const query = reader.select().from(jobs).where(and(eq(jobs.companyId,companyId),eq(jobs.id,ref.id),isNull(jobs.deletedAt))).limit(1);
    const [job] = await (options.lock ? query.for('update') : query);
    if (!job) return null;
    const [row] = await reader.select().from(requirements).where(eq(requirements.jobId,job.id)).limit(1);
    context = jobSelectionContext(job,row?.skillRequirements);
  }
  return {context,matchNeed:selectionMatchNeed(context),active:selectionContextActive(context)};
}
/** Grouped counters: one query per relation, not one query per card. Counts do
 * not disclose CV fields; revoked saved entries remain neutral saved links. */
export async function loadSelectionCounters(companyId:number, reader:SelectionContextReader = db) {
  const [saved, responses] = await Promise.all([
    reader.select({type:shortlist.contextType,id:shortlist.contextId,total:count()}).from(shortlist)
      .where(eq(shortlist.companyId,companyId)).groupBy(shortlist.contextType,shortlist.contextId),
    reader.select({id:applications.jobId,total:count()}).from(applications)
      .where(eq(applications.companyId,companyId)).groupBy(applications.jobId),
  ]);
  return {shortlist:new Map(saved.map(row=>[selectionContextKey({type:row.type,id:row.id}),row.total])),
    applications:new Map(responses.map(row=>[row.id,row.total]))};
}
export async function listOwnedSelectionContexts(companyId:number, reader:SelectionContextReader = db) {
  const [needRows, jobRows, counters] = await Promise.all([
    reader.select().from(needs).where(and(eq(needs.companyId,companyId),isNull(needs.deletedAt))),
    reader.select().from(jobs).where(and(eq(jobs.companyId,companyId),isNull(jobs.deletedAt))),
    loadSelectionCounters(companyId,reader),
  ]);
  const [needLevels, jobRequirements] = await Promise.all([
    needRows.length ? reader.select().from(levels).where(inArray(levels.needId,needRows.map(row=>row.id))) : [],
    jobRows.length ? reader.select().from(requirements).where(inArray(requirements.jobId,jobRows.map(row=>row.id))) : [],
  ]);
  const levelMap = new Map(needLevels.map(row=>[row.needId,row.levels]));
  const requirementMap = new Map(jobRequirements.map(row=>[row.jobId,row.skillRequirements]));
  return [...needRows.map(row=>needSelectionContext(row,levelMap.get(row.id))), ...jobRows.map(row=>jobSelectionContext(row,requirementMap.get(row.id)))]
    .filter(context=>context.status !== 'archived')
    .map(context=>({...context,shortlistCount:counters.shortlist.get(selectionContextKey(context))??0,
      ...(context.type==='job'?{applicationCount:counters.applications.get(context.id)??0}:{})}))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.type.localeCompare(b.type)||b.id-a.id);
}

/** Document access uses current eligible owned requests or vacancies. This is
 * purpose-specific authorization of the exact CV, never a saved-link grant. */
export async function listActiveOwnedMatchNeeds(companyId:number,specialization:string,reader:SelectionContextReader=db) {
  const [needRows,jobRows]=await Promise.all([
    reader.select().from(needs).where(and(eq(needs.companyId,companyId),eq(needs.specialization,specialization),eq(needs.status,'active'),isNull(needs.deletedAt))),
    reader.select().from(jobs).where(and(eq(jobs.companyId,companyId),eq(jobs.specialization,specialization),inArray(jobs.status,['draft','published']),isNull(jobs.deletedAt))),
  ]);
  const [needLevels,jobRequirements]=await Promise.all([
    needRows.length?reader.select().from(levels).where(inArray(levels.needId,needRows.map(row=>row.id))):[],
    jobRows.length?reader.select().from(requirements).where(inArray(requirements.jobId,jobRows.map(row=>row.id))):[],
  ]);
  const levelMap=new Map(needLevels.map(row=>[row.needId,row.levels]));
  const requirementMap=new Map(jobRequirements.map(row=>[row.jobId,row.skillRequirements]));
  return [...needRows.map(row=>selectionMatchNeed(needSelectionContext(row,levelMap.get(row.id)))),
    ...jobRows.map(row=>selectionMatchNeed(jobSelectionContext(row,requirementMap.get(row.id))))];
}
