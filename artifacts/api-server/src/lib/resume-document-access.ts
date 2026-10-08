import { and, eq, isNull } from 'drizzle-orm';
import { db, signalCandidateResumesTable as resumes, signalUsersTable as users, signalCompaniesTable as companies, signalContactGrantsTable as grants, signalInvitationsTable as invitations, signalApplicationsTable as applications } from '@workspace/db';
import { getResumeProfile } from './signal-resume';
import { sameSignalPool, poolScopeForAccount, type SignalScopedAccount } from './signal-pool-scope';
import { canReadCompanyCandidateContacts, assertCompanyActionAllowed } from './signal-trust';
import { loadResumeCandidates, withResumeSkillEvidence } from './signal-resume-matching';
import { withAssessmentRankingEvidence } from './assessment-ranking-evidence';
import { evaluateResumeCandidates } from './signal-resume-evaluation';
import { listActiveOwnedMatchNeeds } from './signal-employer-context';

/** Resolve one exact current résumé. A permission never enumerates or unlocks sibling résumés. */
export async function resolveDocumentAccess(actor: SignalScopedAccount & {id:number;role:string}, resumeId:number) {
  const [row]=await db.select().from(resumes).where(and(eq(resumes.id,resumeId),isNull(resumes.deletedAt))).limit(1);
  if(!row)return null;
  const [owner]=await db.select().from(users).where(and(eq(users.id,row.userId),eq(users.role,'candidate'))).limit(1);
  if(!owner || !sameSignalPool(actor,owner))return null;
  if(actor.role==='candidate' && actor.id===row.userId){const profile=await getResumeProfile(row.userId,row.id);return profile?{row,profile,audience:'owner' as const,contactsAllowed:true,publicIdentity:true}:null;}
  if(actor.role!=='employer')return null;
  const [company]=await db.select().from(companies).where(eq(companies.ownerUserId,actor.id)).limit(1);
  if(!company || !(await assertCompanyActionAllowed(company.id,row.userId,db,'invitations')).allowed)return null;
  // Addressed sharing stays specific to the invitation/application's captured résumé.
  const permissions=await db.select({grant:grants,invitationResumeId:invitations.resumeId,invitationStatus:invitations.status,applicationResumeId:applications.resumeId,applicationStatus:applications.status}).from(grants)
    .leftJoin(invitations,eq(invitations.id,grants.invitationId)).leftJoin(applications,eq(applications.id,grants.applicationId))
    .where(and(eq(grants.candidateUserId,row.userId),eq(grants.companyId,company.id),isNull(grants.revokedAt)));
  const addressed=permissions.some(permission=>(permission.invitationResumeId===row.id && permission.invitationStatus==='accepted') || (permission.applicationResumeId===row.id && permission.applicationStatus!=='withdrawn'));
  const catalog=row.visibility!=='private' && row.consentCatalog;
  let matching=false;
  if(!catalog && !addressed && row.visibility!=='private' && row.consentMatching){
    const definitions=await listActiveOwnedMatchNeeds(company.id,row.specialization);
    const candidates=await withAssessmentRankingEvidence(await withResumeSkillEvidence(await loadResumeCandidates(poolScopeForAccount(actor),{purpose:'matching',resumeId:row.id})));
    matching=definitions.some(need=>evaluateResumeCandidates(need,candidates,actor.demoMode,new Date()).some(entry=>entry.evaluation.eligible));
  }
  if(!catalog && !addressed && !matching)return null;
  const profile=await getResumeProfile(row.userId,row.id);if(!profile)return null;
  const contactsAllowed=addressed && await canReadCompanyCandidateContacts(company.id,row.userId);
  return {row,profile,audience:'employer' as const,contactsAllowed,publicIdentity:row.visibility==='public'};
}
