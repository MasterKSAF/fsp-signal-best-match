import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, signalExpertGrantsTable as grants, signalAssessmentAppealsTable as appeals, signalAppealMessagesTable as messages, signalAssessmentHeadsTable as heads, signalAssessmentReviewDecisionsTable as decisions, signalQualificationProjectionEventsTable as events, signalSkillAttemptsTable as skills, signalAssessmentAttemptsTable as legacy, signalSkillEvidenceTable as evidence, signalSkillCorrectionsTable as corrections, signalAssessmentCorrectionsTable as legacyCorrections, type SkillModuleDecision } from '@workspace/db';
import { canonicalJson } from './canonical-json';
import { scoreSkillAttempt } from './skill-module-bank';
type Reader=Pick<typeof db,'select'>;
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export type AssessmentKind='skill'|'legacy';
export class ReviewError extends Error { constructor(public status:number,public code:string,message:string){super(message);} }
const hash=(v:unknown)=>createHash('sha256').update(canonicalJson(v)).digest('hex');
export async function expertAuthority(userId:number,reader:Reader=db){
 return (await reader.select().from(grants).where(and(eq(grants.userId,userId),isNull(grants.revokedAt),gt(grants.expiresAt,new Date()),eq(grants.authority,'assessment_review'))).orderBy(desc(grants.expiresAt)).limit(1))[0]??null;
}
export async function assessmentSource(kind:AssessmentKind,attemptId:number,reader:Reader=db){
 if(kind==='skill'){
  const a=(await reader.select().from(skills).where(eq(skills.id,attemptId)).limit(1))[0];
  if(!a||a.status==='active'||!a.decision)throw new ReviewError(404,'ATTEMPT_NOT_AVAILABLE','Завершённая проверка не найдена.');
  return {userId:a.userId,kind,attemptId,cases:a.cases,answers:a.answers,oracles:a.oracles,decision:a.decision,policy:a.policy,programVersion:a.programVersion,bankReleaseHash:a.bankReleaseHash,provenance:a.provenance,skillId:a.skillId,level:a.level,submittedAt:a.submittedAt};
 }
 const a=(await reader.select().from(legacy).where(eq(legacy.id,attemptId)).limit(1))[0];
 if(!a||a.status!=='submitted')throw new ReviewError(404,'ATTEMPT_NOT_AVAILABLE','Завершённая проверка не найдена.');
 return {userId:a.userId,kind,attemptId,cases:a.cases,answers:a.answers,oracles:a.oracles,decision:{score:a.score,verified:a.verified},programVersion:a.programVersion,bankReleaseHash:null,provenance:null,skillId:null,level:a.grade,submittedAt:a.submittedAt};
}
export async function openAssessmentAppeal(userId:number,input:{kind:AssessmentKind;attemptId:number;reason:string;revision?:number}){
 return db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(4410,${userId})`);
  const source=await assessmentSource(input.kind,input.attemptId,tx);
  if(source.userId!==userId)throw new ReviewError(404,'ATTEMPT_NOT_AVAILABLE','Проверка не найдена.');
  const existing=(await tx.select().from(appeals).where(and(eq(appeals.kind,input.kind),eq(appeals.attemptId,input.attemptId))).limit(1))[0];
  const grounds=hash(input.reason.normalize('NFKC').trim().toLocaleLowerCase('ru'));
  if(existing){
   if(existing.status!=='resolved'){if(existing.groundsHashes.includes(grounds))return existing;throw new ReviewError(409,'APPEAL_ALREADY_OPEN','Обращение уже открыто. Добавьте сообщение.');}
   if(existing.revision!==input.revision)throw new ReviewError(409,'APPEAL_REVISION_CONFLICT','Обновите обращение перед повторным открытием.');
   if(existing.groundsHashes.includes(grounds))throw new ReviewError(409,'NEW_GROUNDS_REQUIRED','Для повторного открытия нужны новые основания.');
   if(existing.cycle>=5)throw new ReviewError(429,'APPEAL_REOPEN_LIMIT','Лимит повторных обращений достигнут. Обратитесь в поддержку.');
   const [saved]=await tx.update(appeals).set({status:'open',reason:input.reason,cycle:existing.cycle+1,revision:existing.revision+1,groundsHashes:[...existing.groundsHashes,grounds],updatedAt:new Date()}).where(eq(appeals.id,existing.id)).returning();
   await tx.insert(messages).values({id:randomUUID(),appealId:existing.id,authorId:userId,visibility:'candidate',body:input.reason});return saved!;
  }
  const [saved]=await tx.insert(appeals).values({id:randomUUID(),userId,kind:input.kind,attemptId:input.attemptId,reason:input.reason,groundsHashes:[grounds]}).returning();
  await tx.insert(messages).values({id:randomUUID(),appealId:saved!.id,authorId:userId,visibility:'candidate',body:input.reason});return saved!;
 });
}
export async function appealDetail(appealId:string,userId:number,expert=false,reader:Reader=db){
 const grant=expert?await expertAuthority(userId,reader):null;
 if(expert&&!grant)throw new ReviewError(403,'EXPERT_AUTHORITY_REQUIRED','Нет полномочий для пересмотра.');
 const a=(await reader.select().from(appeals).where(and(eq(appeals.id,appealId),...(!expert?[eq(appeals.userId,userId)]:[]))).limit(1))[0];
 if(!a)throw new ReviewError(404,'APPEAL_NOT_FOUND','Обращение не найдено.');
 const [source,history,conversation,head]=await Promise.all([
  assessmentSource(a.kind,a.attemptId,reader),reader.select().from(decisions).where(eq(decisions.appealId,a.id)).orderBy(decisions.createdAt),
  reader.select().from(messages).where(and(eq(messages.appealId,a.id),...(!expert?[eq(messages.visibility,'candidate')]:[]))).orderBy(messages.createdAt),
  reader.select().from(heads).where(eq(heads.id,`${a.kind}:${a.attemptId}`)).limit(1),
 ]);
 return {appeal:a,headRevision:head[0]?.revision??1,headDecisionId:head[0]?.decisionId??null,
  source:expert?source:{kind:source.kind,attemptId:source.attemptId,cases:source.cases,answers:source.answers,decision:source.decision,programVersion:source.programVersion,bankReleaseHash:source.bankReleaseHash},
  messages:conversation.map(m=>({id:m.id,author:m.authorId===a.userId?'candidate':'expert',visibility:m.visibility,body:m.body,createdAt:m.createdAt})),
  decisions:history.map(d=>expert?d:{id:d.id,action:d.action,explanation:d.explanation,supersedes:d.supersedes,previousRevision:d.previousRevision,revision:d.revision,affectedSkills:d.affectedSkills,createdAt:d.createdAt}),
 };
}
export type ReviewCommand={commandKey:string;appealRevision:number;decisionRevision:number;action:'confirm'|'correct'|'invalidate'|'new_check';explanation:string;internalNote:string;caseReviews:{caseId:string;passed:boolean;basis:string}[]};
export async function resolveAssessmentAppeal(actorId:number,appealId:string,input:ReviewCommand){
 const payloadHash=hash({actorId,appealId,...input});
 return db.transaction(async tx=>{
  const grant=await expertAuthority(actorId,tx);if(!grant)throw new ReviewError(403,'EXPERT_AUTHORITY_REQUIRED','Нет полномочий для пересмотра.');
  const initial=(await tx.select().from(appeals).where(eq(appeals.id,appealId)).limit(1))[0];if(!initial)throw new ReviewError(404,'APPEAL_NOT_FOUND','Обращение не найдено.');
  await tx.execute(sql`SELECT pg_advisory_xact_lock(4410,${initial.userId})`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${initial.userId})`);
  // Recheck authority inside the locked transaction, including a concurrent revocation.
  const lockedGrant=(await tx.select().from(grants).where(and(eq(grants.id,grant.id),isNull(grants.revokedAt),gt(grants.expiresAt,new Date()))).for('share'))[0];
  if(!lockedGrant)throw new ReviewError(403,'EXPERT_AUTHORITY_REQUIRED','Полномочия отозваны.');
  const previous=(await tx.select().from(decisions).where(eq(decisions.commandKey,input.commandKey)).limit(1))[0];
  if(previous){if(previous.payloadHash!==payloadHash)throw new ReviewError(409,'COMMAND_KEY_REUSED','Ключ команды уже использован.');return {decisionId:previous.id,revision:previous.revision,replayed:true};}
  const a=(await tx.select().from(appeals).where(eq(appeals.id,appealId)).for('update'))[0]!;
  if(a.status!=='in_review'||a.revision!==input.appealRevision)throw new ReviewError(409,'APPEAL_REVISION_CONFLICT','Обращение изменилось. Обновите экран эксперта.');
  const source=await assessmentSource(a.kind,a.attemptId,tx),id=`${a.kind}:${a.attemptId}`;
  await tx.insert(heads).values({id,userId:a.userId,kind:a.kind,attemptId:a.attemptId}).onConflictDoNothing();
  const head=(await tx.select().from(heads).where(eq(heads.id,id)).for('update'))[0]!;
  if(head.revision!==input.decisionRevision)throw new ReviewError(409,'DECISION_REVISION_CONFLICT','Уже принято другое решение. Обновите историю.');
  let validity=head.validity,decision=head.decision;
  if(input.action==='correct'){
   if(source.kind!=='skill'||!('policy' in source)||!source.policy||!source.skillId)throw new ReviewError(422,'LEGACY_RECHECK_REQUIRED','Для этой исторической программы доступно подтверждение, аннулирование или новая проверка.');
   if(source.cases.length!==6||new Set(source.cases.map(c=>c.id)).size!==6||input.caseReviews.length!==6||new Set(input.caseReviews.map(c=>c.caseId)).size!==6||input.caseReviews.some(c=>!source.cases.some(s=>s.id===c.caseId)||c.passed&&!String(source.answers[c.caseId]??'').trim()))throw new ReviewError(422,'SOURCE_REVIEW_REQUIRED','Оцените каждый исходный ответ по его сохранённой рубрике. Пустой ответ нельзя признать выполненным.');
   const original=scoreSkillAttempt(source.cases,source.oracles,source.answers,source.policy);
   const competencies=source.cases.map(c=>({id:c.competencyId,critical:c.critical,passed:input.caseReviews.find(v=>v.caseId===c.id)!.passed}));
   const score=Math.round(100*competencies.filter(c=>c.passed).length/6),criticalComplete=competencies.filter(c=>c.critical).every(c=>c.passed);
   decision={...original,score,criticalComplete,passed:score>=source.policy.threshold&&criticalComplete,competencies,...(original.levelCoverage?{levelCoverage:source.cases.filter(c=>c.levelRequirementId).map(c=>({requirementId:c.levelRequirementId!,passed:input.caseReviews.find(v=>v.caseId===c.id)!.passed}))}:{})};
   validity=decision.passed?'valid':'invalid';
   if(decision.passed){
    if(!source.submittedAt)throw new ReviewError(422,'MISSING_SOURCE_DATE','Для этой записи не сохранена дата завершения. Нужна новая проверка.');
    // A distinct current projection references the unchanged source attempt. Its date remains the original submission date.
    await tx.insert(evidence).values({userId:a.userId,attemptId:a.attemptId,skillId:source.skillId,level:source.level,programVersion:source.programVersion,competencyIds:competencies.filter(c=>c.passed).map(c=>c.id),verifiedAt:source.submittedAt,decision}).onConflictDoNothing();
   }
  }else if(input.action==='invalidate')validity='invalid';
  else if(input.caseReviews.length)throw new ReviewError(422,'UNEXPECTED_CASE_REVIEWS','Оценки ответов применяются только при исправлении.');
  const nextRevision=head.revision+1,decisionId=randomUUID(),now=new Date();
  const projection={validity,decision,rule:'current_review_then_source_validity_v1',restoration:'Only explicit reviewed source; older evidence is revalidated by its original supported programme and corrections, never a copied score.'};
  await tx.insert(decisions).values({id:decisionId,appealId:a.id,actorId,authorityId:grant.id,authority:grant.authority,commandKey:input.commandKey,payloadHash,supersedes:head.decisionId,previousRevision:head.revision,revision:nextRevision,action:input.action,explanation:input.explanation,internalNote:input.internalNote,source:{kind:a.kind,attemptId:a.attemptId,sourceHash:hash(source),bankReleaseHash:source.bankReleaseHash,programVersion:source.programVersion,provenance:source.provenance,rubric:'policy' in source?source.policy?.rubricVersion:null},affectedSkills:source.skillId?[source.skillId]:['legacy_programme'],caseReviews:input.caseReviews,projection});
  await tx.update(heads).set({revision:nextRevision,decisionId,validity,decision,updatedAt:now}).where(eq(heads.id,id));
  await tx.update(appeals).set({status:'resolved',revision:a.revision+1,updatedAt:now}).where(eq(appeals.id,a.id));
  await tx.insert(messages).values({id:randomUUID(),appealId:a.id,authorId:actorId,authorityId:grant.id,visibility:'candidate',body:input.explanation});
  await tx.insert(events).values({id:randomUUID(),userId:a.userId,decisionId});
  const {recomputeCandidateResumes}=await import('./signal-resume');await recomputeCandidateResumes(a.userId,tx);
  return {decisionId,revision:nextRevision,replayed:false};
 });
}
/** All product reads pass through this overlay. Corrections made after a review still revoke it. */
export async function overlaySkillReviews<T extends typeof evidence.$inferSelect>(rows:T[],revokedIds:Set<number>,reader:Reader=db):Promise<{evidence:T[];revokedIds:Set<number>}>{
 if(!rows.length)return {evidence:rows,revokedIds};
 const current=await reader.select().from(heads).where(and(eq(heads.kind,'skill'),sql`${heads.attemptId}=any(${sql.param(rows.map(r=>r.attemptId))}::int[])`));
 const old=await reader.select().from(corrections).where(sql`${corrections.evidenceId}=any(${sql.param(rows.map(r=>r.id))}::int[])`);
 const mapped=rows.map(row=>{const h=current.find(h=>h.attemptId===row.attemptId&&h.userId===row.userId);if(!h)return row;const c=old.find(c=>c.evidenceId===row.id);
  if(h.validity==='invalid')revokedIds.add(row.id);
  if(h.validity==='valid'&&h.decision&&(!c||+c.createdAt<+h.updatedAt)){revokedIds.delete(row.id);return {...row,decision:h.decision,competencyIds:h.decision.competencies.filter(c=>c.passed).map(c=>c.id)};}
  return row;});return {evidence:mapped,revokedIds};
}
export async function overlayLegacyReviews(attemptIds:number[],correctedIds:Set<number>,reader:Reader=db){
 if(!attemptIds.length)return correctedIds;
 const current=await reader.select().from(heads).where(and(eq(heads.kind,'legacy'),sql`${heads.attemptId}=any(${sql.param(attemptIds)}::int[])`));
 // Legacy reviews do not mint replacement programme results. Invalidations are additive.
 for(const h of current)if(h.validity==='invalid')correctedIds.add(h.attemptId);
 return correctedIds;
}
