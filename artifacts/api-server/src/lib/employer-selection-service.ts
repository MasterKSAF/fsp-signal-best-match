import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db, signalCandidateResumesTable as resumes, signalResumeWorkPreferencesTable as work,
  signalUsersTable as users, signalCompanyBlocksTable as blocks,signalCandidateProfilesTable as profiles } from '@workspace/db';
import { loadResumeCandidates, withResumeSkillEvidence } from './signal-resume-matching';
import { withAssessmentRankingEvidence } from './assessment-ranking-evidence';
import { assertCompanyActionAllowed } from './signal-trust';
import { signalPoolPredicate, type SignalPoolScope } from './signal-pool-scope';
import type { CatalogResume } from './signal-resume-catalog';
import type { SelectionResume } from './employer-selection-query';

export async function selectionMetadata(rows:CatalogResume[]) : Promise<SelectionResume[]> {
  if(!rows.length)return [];
  const metadata=new Map<number,{location:string|null;updatedAt:Date}>();
  // Bounded parameters support both an exact detail and a large filtered pool.
  for(let offset=0;offset<rows.length;offset+=2000) {
    const batch=await db.select({id:resumes.id,location:work.location,updatedAt:resumes.updatedAt})
      .from(resumes).leftJoin(work,eq(work.resumeId,resumes.id)).where(inArray(resumes.id,rows.slice(offset,offset+2000).map(row=>row.resumeId)));
    for(const row of batch)metadata.set(row.id,row);
  }
  return rows.filter(row=>metadata.has(row.resumeId)).map(row=>({...row,location:metadata.get(row.resumeId)!.location??'',updatedAt:metadata.get(row.resumeId)!.updatedAt}));
}
export async function loadSelectionResumes(companyId:number,scope:SignalPoolScope,purpose:'catalog'|'matching',options:{resumeIds?:number[];userId?:number}={}) {
  if(!(await assertCompanyActionAllowed(companyId,undefined,db,'invitations')).allowed)return [];
  const raw=await loadResumeCandidates(scope,{purpose,...options});
  const denied=await db.select({id:blocks.candidateUserId}).from(blocks).where(and(eq(blocks.companyId,companyId),eq(blocks.active,true)));
  const blocked=new Set(denied.map(row=>row.id));
  const enriched=await withResumeSkillEvidence(await withAssessmentRankingEvidence(raw.filter(row=>!blocked.has(row.userId))),db,{includePhotos:false});
  const current=enriched.map(row=>row.assessmentEvidence?.state==='revoked'&&row.categoryEvidence?.grade!==row.verifiedGrade?{...row,verifiedGrade:null,verifiedScore:null,verifiedSkills:[],latestAssessmentAt:null}:row);
  return selectionMetadata(current);
}
/** Recheck exact page rows after qualification work. An already saved ID or an
 * earlier pool projection cannot authorize a newly revoked CV. */
export async function freshSelectionIds(companyId:number,scope:SignalPoolScope,purpose:'catalog'|'matching',ids:number[]) {
  const empty=new Map<number,{visibility:CatalogResume['visibility'];publicName:string|null;avatarDataUrl:string|null;revision:number;alias:string}>();
  if(!ids.length||!(await assertCompanyActionAllowed(companyId,undefined,db,'invitations')).allowed)return empty;
  const rows=await db.select({id:resumes.id,userId:resumes.userId,visibility:resumes.visibility,name:users.displayName,photo:profiles.avatarDataUrl,alias:profiles.professionalAlias,revision:resumes.revision}).from(resumes).innerJoin(users,eq(users.id,resumes.userId)).innerJoin(profiles,eq(profiles.userId,users.id))
    .where(and(inArray(resumes.id,ids),eq(users.role,'candidate'),signalPoolPredicate(users,scope),isNull(resumes.deletedAt),ne(resumes.visibility,'private'),purpose==='catalog'?eq(resumes.consentCatalog,true):eq(resumes.consentMatching,true)));
  const denied=await db.select({id:blocks.candidateUserId}).from(blocks).where(and(eq(blocks.companyId,companyId),eq(blocks.active,true)));
  const blocked=new Set(denied.map(row=>row.id));return new Map(rows.filter(row=>!blocked.has(row.userId)).map(row=>[row.id,{visibility:row.visibility,publicName:row.visibility==='public'?row.name:null,avatarDataUrl:row.visibility==='public'?row.photo:null,revision:row.revision,alias:row.alias}]));
}
export function freshSelectionIdentity(row:SelectionResume,fresh:Awaited<ReturnType<typeof freshSelectionIds>>) {
  const identity=fresh.get(row.resumeId);
  return identity&&identity.revision===row.resumeRevision?{...row,visibility:identity.visibility,publicName:identity.publicName,avatarDataUrl:identity.avatarDataUrl,alias:identity.alias}:null;
}
