import { and, eq, inArray } from 'drizzle-orm';
import { db, signalShortlistTable as shortlist, signalCompanyBlocksTable as blocks } from '@workspace/db';
import { assertCompanyActionAllowed } from './signal-trust';
import { loadResumeCandidates, withResumeSkillEvidence } from './signal-resume-matching';
import { withAssessmentRankingEvidence } from './assessment-ranking-evidence';
import { safeCatalogResume, type CatalogResume } from './signal-resume-catalog';
import type { SelectionContextRef } from './selection-context-contract';
import type { SignalPoolScope } from './signal-pool-scope';
import type { SelectionContextReader } from './signal-employer-context';

export async function loadOwnedShortlistLinks(companyId:number,ref:SelectionContextRef,reader:SelectionContextReader=db) {
  return reader.select().from(shortlist).where(and(eq(shortlist.companyId,companyId),eq(shortlist.contextType,ref.type),eq(shortlist.contextId,ref.id)));
}
/** Every call checks current matching purpose, exact CV owner, pool, deletion,
 * blocks and restrictions. Saved IDs never grant access or retrieve snapshots. */
export async function loadAccessibleShortlistCandidates(companyId:number,scope:SignalPoolScope,
  links:readonly {candidateUserId:number;resumeId:number}[],reader:SelectionContextReader=db):Promise<Map<number,CatalogResume>> {
  if(!links.length || !(await assertCompanyActionAllowed(companyId,undefined,reader,'invitations')).allowed)return new Map();
  const candidateIds=[...new Set(links.map(link=>link.candidateUserId))];
  const blocked=await reader.select({candidateId:blocks.candidateUserId}).from(blocks)
    .where(and(eq(blocks.companyId,companyId),eq(blocks.active,true),inArray(blocks.candidateUserId,candidateIds)));
  const blockedIds=new Set(blocked.map(row=>row.candidateId));
  const raw=await loadResumeCandidates(scope,{purpose:'matching',resumeIds:[...new Set(links.map(link=>link.resumeId))]},reader);
  const owners=new Map(links.map(link=>[link.resumeId,link.candidateUserId]));
  const allowed=raw.filter(row=>owners.get(row.resumeId)===row.userId&&!blockedIds.has(row.userId));
  const professional=await withAssessmentRankingEvidence(await withResumeSkillEvidence(allowed,reader),reader);
  return new Map(professional.map(row=>[row.resumeId,row]));
}
export function safeShortlistCandidate(candidate:CatalogResume) {
  return {candidateId:candidate.userId,alias:candidate.alias,
    publicName:candidate.visibility==='public'?candidate.publicName:null,
    avatarDataUrl:candidate.visibility==='public'?candidate.avatarDataUrl:null,
    selectedResume:safeCatalogResume(candidate),statedSkills:candidate.statedSkills,
    skillEvidence:(candidate.skillEvidence??[]).map(proof=>({skill:proof.skill,level:proof.level??null,sourceType:proof.sourceType??null}))};
}
