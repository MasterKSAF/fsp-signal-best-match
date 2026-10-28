import { createHash,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { and,eq,inArray,sql } from 'drizzle-orm';
import { db,signalCompaniesTable as companies,signalUsersTable as users,signalSharedSelectionsTable as shares,signalCompanyMembersTable as members,signalGuestPermissionsTable as permissions,signalShareCommentsTable as comments,signalDependencyEpochTable as epochs,signalCandidateResumesTable as resumes } from '@workspace/db';
import { loadOwnedSelectionContext } from './signal-employer-context';
import { loadOwnedShortlistLinks,loadAccessibleShortlistCandidates,safeShortlistCandidate } from './shortlist-access';
import { poolScopeForAccount,sameSignalPool } from './signal-pool-scope';
import { FeatureError } from './competitive-http';
import type { SelectionContextRef } from './selection-context-contract';
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type User=typeof users.$inferSelect;
const deny=()=>new FeatureError(404,'share_unavailable','Подборка недоступна.');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function companyOwner(user:User,reader:Pick<typeof db,'select'>=db){
 if(user.role!=='employer')throw deny();
 const [company]=await reader.select().from(companies).where(eq(companies.ownerUserId,user.id));if(!company)throw deny();return company;
}
export async function appointReviewer(user:User,userId:number,active:boolean,revision?:number){
 return db.transaction(async tx=>{
  const c=await companyOwner(user,tx);const [target]=await tx.select().from(users).where(eq(users.id,userId));
  if(!target||target.role!=='employer'||!sameSignalPool(user,target)||target.id===user.id)throw deny();
  await tx.execute(sql`select pg_advisory_xact_lock(7492,${c.id})`);
  const [prior]=await tx.select().from(members).where(and(eq(members.companyId,c.id),eq(members.userId,userId))).for('update');
  if(prior&&prior.revision!==revision)throw new FeatureError(409,'member_changed','Права сотрудника изменились.');
  const values={companyId:c.id,userId,appointedBy:user.id,active,revision:(prior?.revision??0)+1};
  await tx.insert(members).values(values).onConflictDoUpdate({target:[members.companyId,members.userId],set:values});return values;
 });
}
export async function setGuestPermission(user:User,resumeId:number,allowed:boolean){
 return db.transaction(async tx=>{
  await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('update');
  const [resume]=await tx.select().from(resumes).where(and(eq(resumes.id,resumeId),eq(resumes.userId,user.id))).for('update');
  if(!resume||resume.deletedAt||user.role!=='candidate')throw deny();
  await tx.insert(permissions).values({resumeId,userId:user.id,allowed}).onConflictDoUpdate({target:permissions.resumeId,set:{allowed,updatedAt:new Date()}});
  return {resumeId,allowed};
 });
}
export async function createSharedSelection(user:User,input:{context:SelectionContextRef;publicPurpose:string;memberIds:number[];guest:boolean;hours:number}){
 return db.transaction(async tx=>{
  await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('share');
  const company=await companyOwner(user,tx),context=await loadOwnedSelectionContext(company.id,input.context,tx);
  if(!context?.active)throw deny();
  const appointed=input.memberIds.length?await tx.select().from(members).where(and(eq(members.companyId,company.id),eq(members.active,true),inArray(members.userId,input.memberIds))).for('share'):[];
  if(new Set(appointed.map(m=>m.userId)).size!==new Set(input.memberIds).size)throw deny();
  const links=await loadOwnedShortlistLinks(company.id,input.context,tx);
  if(links.length>40)throw new FeatureError(422,'share_size','Оставьте в подборке не больше 40 резюме.');
  const visible=await loadAccessibleShortlistCandidates(company.id,poolScopeForAccount(user),links,tx);
  const items=links.flatMap(l=>{const c=visible.get(l.resumeId);return c?[{candidateUserId:c.userId,resumeId:c.resumeId,resumeRevision:c.resumeRevision}]:[];});
  if(!items.length)throw new FeatureError(422,'empty_shortlist','Сначала сохраните доступные резюме в отбор.');
  const token=input.guest?randomBytes(32).toString('base64url'):null;
  const [row]=await tx.insert(shares).values({id:randomUUID(),companyId:company.id,createdBy:user.id,contextType:input.context.type,contextId:input.context.id,contextRevision:context.context.version,publicPurpose:input.publicPurpose,items,memberIds:[...new Set(input.memberIds)],tokenHash:token?hash(token):null,expiresAt:new Date(Date.now()+input.hours*3600000)}).returning();
  return {id:row.id,expiresAt:row.expiresAt,revision:row.revision,guestToken:token,memberIds:row.memberIds};
 });
}
export type ShareViewer={user?:User;token?:string};
async function authorizeShare(tx:Tx,id:string,viewer:ShareViewer){
 await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('share');
 const [share]=await tx.select().from(shares).where(eq(shares.id,id)).for('share');
 if(!share||share.revokedAt||+share.expiresAt<=Date.now())throw deny();
 const [company]=await tx.select().from(companies).where(eq(companies.id,share.companyId)).for('share');
 const [owner]=company?await tx.select().from(users).where(eq(users.id,company.ownerUserId)):[];if(!owner||owner.role!=='employer')throw deny();
 let guest=false,author='';
 if(viewer.user){
  if(viewer.user.role!=='employer'||!sameSignalPool(owner,viewer.user))throw deny();
  if(viewer.user.id!==owner.id){
   const [member]=await tx.select().from(members).where(and(eq(members.companyId,share.companyId),eq(members.userId,viewer.user.id),eq(members.active,true))).for('share');
   if(!member||!share.memberIds.includes(viewer.user.id))throw deny();
  }author=`user:${viewer.user.id}`;
 }else{
  const provided=hash(viewer.token??'');
  if(!share.tokenHash||!viewer.token||!timingSafeEqual(Buffer.from(provided),Buffer.from(share.tokenHash)))throw deny();
  guest=true;author=`guest:${share.tokenHash.slice(0,24)}`;
 }
 const context=await loadOwnedSelectionContext(share.companyId,{type:share.contextType,id:share.contextId},tx);
 if(!context?.active||context.context.version!==share.contextRevision)throw new FeatureError(409,'share_context_changed','Условия отбора изменились. Запросите новую подборку.');
 const visible=await loadAccessibleShortlistCandidates(share.companyId,poolScopeForAccount(owner),share.items,tx);
 const grants=guest&&share.items.length?await tx.select().from(permissions).where(and(inArray(permissions.resumeId,share.items.map(i=>i.resumeId)),eq(permissions.allowed,true))).for('share'):[];
 const allowed=new Set(grants.map(g=>`${g.userId}:${g.resumeId}`));
 const rows=share.items.flatMap((item,index)=>{
  const c=visible.get(item.resumeId);if(!c||c.userId!==item.candidateUserId||c.resumeRevision!==item.resumeRevision||guest&&!allowed.has(`${c.userId}:${c.resumeId}`))return [];
  return [{candidateId:c.userId,resumeId:c.resumeId,resumeRevision:c.resumeRevision,...(guest?{candidate:{label:`Специалист ${index+1}`,specialization:c.specialization,verifiedGrade:c.verifiedGrade,yearsExperience:c.yearsExperience,workFormat:c.workFormat,statedSkills:c.statedSkills,confirmedSkills:(c.skillEvidence??[]).map(p=>({skill:p.skill,level:p.level??null}))}}:{candidate:safeShortlistCandidate(c)})}];
 });
 // Candidate/row IDs are only routing handles; no contact, image, source-answer or private need object is copied into the guest DTO.
 return {share,rows,author,guest};
}
export async function readSharedSelection(id:string,viewer:ShareViewer){
 return db.transaction(async tx=>{
  const {share,rows,author,guest}=await authorizeShare(tx,id,viewer);
  const visible=new Set(rows.map(r=>`${r.candidateId}:${r.resumeId}:${r.resumeRevision}`));
  const notes=await tx.select().from(comments).where(eq(comments.shareId,id));
  return {id:share.id,publicPurpose:share.publicPurpose,contextRevision:share.contextRevision,revision:share.revision,expiresAt:share.expiresAt,guest,items:rows,comments:notes.filter(n=>visible.has(`${n.candidateId}:${n.resumeId}:${n.resumeRevision}`)&&(!guest||n.author===author)).map(n=>({id:n.id,candidateId:n.candidateId,resumeId:n.resumeId,resumeRevision:n.resumeRevision,author:n.author,reaction:n.reaction,note:n.note,revision:n.revision,createdAt:n.createdAt}))};
 });
}
export async function commentSharedSelection(id:string,viewer:ShareViewer,input:{candidateId:number;resumeId:number;resumeRevision:number;reaction:'consider'|'discuss'|'pass';note:string}){
 return db.transaction(async tx=>{
  const {rows,author}=await authorizeShare(tx,id,viewer);
  if(!rows.some(r=>r.candidateId===input.candidateId&&r.resumeId===input.resumeId&&r.resumeRevision===input.resumeRevision))throw deny();
  const [row]=await tx.insert(comments).values({id:randomUUID(),shareId:id,...input,author}).returning();return {id:row.id,revision:row.revision};
 });
}
export async function revokeSharedSelection(user:User,id:string,revision:number){
 return db.transaction(async tx=>{const c=await companyOwner(user,tx);const [row]=await tx.select().from(shares).where(and(eq(shares.id,id),eq(shares.companyId,c.id))).for('update');if(!row)throw deny();if(row.revokedAt)return {revoked:true,revision:row.revision};if(row.revision!==revision)throw new FeatureError(409,'share_changed','Подборка изменилась.');await tx.update(shares).set({revokedAt:new Date(),revision:row.revision+1}).where(eq(shares.id,id));return {revoked:true,revision:row.revision+1};});
}
