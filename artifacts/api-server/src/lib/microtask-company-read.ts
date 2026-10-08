import { and, eq, inArray } from 'drizzle-orm';
import { db, signalMicroOffersTable as offers, signalMicroPreferencesTable as preferences,
  signalCompaniesTable as companies, signalUsersTable as users, signalCandidateProfilesTable as profiles,
  signalCandidateResumesTable as resumes, signalCompanyBlocksTable as blocks } from '@workspace/db';
import { microOfferCandidateIdentity, microOfferReadableFromFacts } from './microtask-workspace-policy';
import { assertCompanyActionAllowed } from './signal-trust';
import type { MicrotaskResumeWriter } from './microtask-resume';

type MicroOffer = typeof offers.$inferSelect;
/** ACL is read afresh once per list request; the map never survives the request. */
export async function loadCompanyOfferAccess(companyId:number, rows:readonly MicroOffer[], reader:MicrotaskResumeWriter = db) {
  const access = new Map<number,{readable:boolean;candidateIdentity:ReturnType<typeof microOfferCandidateIdentity>}>(rows.map(row=>[row.id,{readable:false,candidateIdentity:null}]));
  const current = rows.filter(row=>row.companyId === companyId && !row.consentRevokedAt);
  if (!current.length || !(await assertCompanyActionAllowed(companyId,undefined,reader,'contacts')).allowed) return access;
  const candidateIds = [...new Set(current.map(row=>row.candidateUserId))];
  const resumeIds = [...new Set(current.map(row=>row.resumeId).filter((id):id is number=>id !== null))];
  const [companyRows,candidateRows,resumeRows,blockRows] = await Promise.all([
    reader.select({demoMode:users.demoMode,reviewScopeId:users.reviewScopeId,role:users.role}).from(companies).innerJoin(users,eq(users.id,companies.ownerUserId)).where(eq(companies.id,companyId)),
    reader.select({id:users.id,demoMode:users.demoMode,reviewScopeId:users.reviewScopeId,role:users.role,displayName:users.displayName,alias:profiles.professionalAlias,visibility:profiles.visibility,matching:profiles.consentMatching,enabled:preferences.enabled}).from(users)
      .leftJoin(profiles,eq(profiles.userId,users.id)).leftJoin(preferences,eq(preferences.candidateUserId,users.id)).where(inArray(users.id,candidateIds)),
    resumeIds.length ? reader.select().from(resumes).where(inArray(resumes.id,resumeIds)) : Promise.resolve([]),
    reader.select({candidateId:blocks.candidateUserId}).from(blocks).where(and(eq(blocks.companyId,companyId),eq(blocks.active,true),inArray(blocks.candidateUserId,candidateIds))),
  ]);
  const company = companyRows[0];
  if (!company || company.role !== 'employer') return access;
  const candidates = new Map(candidateRows.map(row=>[row.id,row])), resumeMap = new Map(resumeRows.map(row=>[row.id,row])), blocked = new Set(blockRows.map(row=>row.candidateId));
  for (const offer of current) {
    const candidate = candidates.get(offer.candidateUserId);
    const facts = {company:{...company,id:companyId},candidate,resume:resumeMap.get(offer.resumeId!),blocked:blocked.has(offer.candidateUserId),companyAllowed:true};
    const readable = microOfferReadableFromFacts(offer,facts);
    access.set(offer.id,{readable,candidateIdentity:microOfferCandidateIdentity(offer,facts)});
  }
  return access;
}
export async function loadCompanyOfferReadability(companyId:number, rows:readonly MicroOffer[], reader:MicrotaskResumeWriter = db) {
  return new Map([...(await loadCompanyOfferAccess(companyId,rows,reader))].map(([id,access])=>[id,access.readable]));
}
export async function companyOfferReadable(offer:MicroOffer, reader:MicrotaskResumeWriter = db) {
  return (await loadCompanyOfferReadability(offer.companyId,[offer],reader)).get(offer.id) === true;
}
