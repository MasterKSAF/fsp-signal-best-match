import {createPrivateKey,createPublicKey,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {db,signalPassportKeysTable as keys,signalPassportPreviewsTable as previews,signalPublicPassportsTable as passports,signalPassportEventsTable as events,signalSkillAttemptsTable as attempts,signalAssessmentHeadsTable as heads,signalDependencyEpochTable as epochs,type PublicSkillClaim,type SignedPassportDocument} from '@workspace/db';
import {loadSkillQualificationInputs} from './skill-module-service';
import {selectAccountSkillEvidence} from './skill-module-qualification';
import {canonicalJson} from './canonical-json';
import {FeatureError} from './competitive-http';
import {signPassport,verifyPassportIntegrity} from './passport-signature';
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export function passportIssuer(){
 const raw=process.env.SIGNAL_PASSPORT_ISSUER;if(!raw)throw new FeatureError(503,'passport_not_configured','Публикация паспортов пока не настроена.');
 let u:URL;try{u=new URL(raw);}catch{throw new Error('Invalid passport issuer');}
 const local=['localhost','127.0.0.1'].includes(u.hostname)&&process.env.DEMO_MODE==='true'&&process.env.NODE_ENV!=='production';
 if(u.pathname!=='/'||u.username||u.password||u.search||u.hash||u.protocol!=='https:'&&!local)throw new Error('Passport issuer requires HTTPS');
 return u.href.replace(/\/$/,'');
}
export async function availablePublicClaims(userId:number,reader:Pick<typeof db,'select'>=db):Promise<PublicSkillClaim[]>{
 const input=await loadSkillQualificationInputs([userId],reader);
 const projections=selectAccountSkillEvidence({userId,specialization:'',assumedGrade:'Junior',stack:[],skills:[]},input);
 if(!projections.length)return [];
 const source=await reader.select().from(attempts).where(and(eq(attempts.userId,userId),inArray(attempts.id,projections.map(p=>p.attemptId))));
 const reviews=await reader.select().from(heads).where(and(eq(heads.userId,userId),eq(heads.kind,'skill'),inArray(heads.attemptId,projections.map(p=>p.attemptId))));
 return projections.map(p=>({skillId:p.skillId,label:p.label,level:p.level,programVersion:p.programVersion,verifiedAt:p.verifiedAt,source:{type:'signal_skill_assessment' as const,attemptId:p.attemptId,evidenceId:p.evidenceId,bankReleaseHash:source.find(a=>a.id===p.attemptId)?.bankReleaseHash??null,reviewRevision:reviews.find(r=>r.attemptId===p.attemptId)?.revision??0}})).sort((a,b)=>a.skillId.localeCompare(b.skillId));
}
export async function previewPublicPassport(userId:number,skillIds:string[]){
 return db.transaction(async tx=>{
  await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('share');
  const available=await availablePublicClaims(userId,tx),wanted=new Set(skillIds),claims=available.filter(p=>wanted.has(p.skillId));
  if(!claims.length||claims.length!==wanted.size)throw new FeatureError(422,'proof_unavailable','Выберите действующие подтверждения.');
  const [row]=await tx.insert(previews).values({id:randomUUID(),userId,claims,expiresAt:new Date(Date.now()+600000)}).returning();
  return {id:row.id,claims:row.claims,expiresAt:row.expiresAt,issuer:passportIssuer(),disclosure:'selected_skill_claims_only'};
 });
}
function signingKey(){
 const file=process.env.SIGNAL_PASSPORT_SIGNING_KEY_FILE;if(!file)throw new FeatureError(503,'passport_key_missing','Ключ выпуска не настроен.');
 const absolute=path.resolve(file),relative=path.relative(process.cwd(),absolute);
 if(!relative.startsWith('..')&&!path.isAbsolute(relative))throw new Error('Passport private key must be outside repository');
 return createPrivateKey(readFileSync(absolute));
}
export async function issuePublicPassport(userId:number,input:{previewId:string;acceptPublication:true;days:number;replaceId?:string}){
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(7493,${userId})`);
  await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('share');
  const [preview]=await tx.select().from(previews).where(and(eq(previews.id,input.previewId),eq(previews.userId,userId))).for('update');
  if(!preview)throw new FeatureError(404,'preview_unavailable','Предпросмотр недоступен.');
  if(preview.issuedId){const [prior]=await tx.select().from(passports).where(and(eq(passports.id,preview.issuedId),eq(passports.userId,userId)));const [replaced]=await tx.select().from(events).where(and(eq(events.kind,'replaced'),eq(events.replacementId,prior.id)));if((+new Date(prior.document.body.expiresAt)-+new Date(prior.document.body.issuedAt))/86400000!==input.days||(replaced?.passportId??null)!==(input.replaceId??null))throw new FeatureError(409,'publication_command_changed','Этот предпросмотр уже опубликован с другими параметрами.');return {id:prior.id,state:prior.state};}
  if(+preview.expiresAt<=Date.now())throw new FeatureError(409,'preview_expired','Создайте новый предпросмотр.');
  const nowClaims=await availablePublicClaims(userId,tx),selected=nowClaims.filter(c=>preview.claims.some(p=>p.skillId===c.skillId));
  if(canonicalJson(selected)!==canonicalJson(preview.claims))throw new FeatureError(409,'proof_changed','Подтверждения изменились. Проверьте новый предпросмотр.');
  const issuer=passportIssuer();const [key]=await tx.select().from(keys).where(and(eq(keys.issuer,issuer),eq(keys.state,'active'))).for('share');
  if(!key)throw new FeatureError(503,'passport_key_missing','Ключ выпуска не настроен.');
  const privateKey=signingKey();if(createPublicKey(privateKey).export({format:'pem',type:'spki'}).toString()!==key.publicKeyPem)throw new Error('Configured signing key does not match trusted kid');
  let prior:typeof passports.$inferSelect|undefined;
  if(input.replaceId){[prior]=await tx.select().from(passports).where(and(eq(passports.id,input.replaceId),eq(passports.userId,userId))).for('update');if(!prior||prior.state!=='active')throw new FeatureError(409,'passport_changed','Предыдущий паспорт уже изменён.');}
  const id=randomUUID(),now=new Date(),document=signPassport({schema:'signal-voluntary-passport-v1',algorithm:'Ed25519',issuer,kid:key.kid,id,subject:randomUUID(),issuedAt:now.toISOString(),expiresAt:new Date(+now+input.days*86400000).toISOString(),claims:preview.claims},privateKey);
  await tx.insert(passports).values({id,userId,document});
  await tx.insert(events).values({id:randomUUID(),passportId:id,actorId:userId,kind:'issued'});
  if(prior){await tx.update(passports).set({state:'replaced',replacementId:id}).where(eq(passports.id,prior.id));await tx.insert(events).values({id:randomUUID(),passportId:prior.id,actorId:userId,kind:'replaced',replacementId:id});}
  await tx.update(previews).set({issuedId:id}).where(eq(previews.id,preview.id));return {id,state:'active'};
 });
}
export async function revokePublicPassport(userId:number,id:string){
 return db.transaction(async tx=>{const [row]=await tx.select().from(passports).where(and(eq(passports.id,id),eq(passports.userId,userId))).for('update');if(!row)throw new FeatureError(404,'passport_unavailable','Паспорт недоступен.');if(row.state==='active'){await tx.update(passports).set({state:'revoked'}).where(eq(passports.id,id));await tx.insert(events).values({id:randomUUID(),passportId:id,actorId:userId,kind:'revoked'});}return {id,status:row.state==='active'?'revoked':row.state};});
}
async function currentPassport(tx:Tx,id:string,uploaded?:SignedPassportDocument){
 const [row]=await tx.select().from(passports).where(eq(passports.id,id)).for('share');
 if(!row)return {id,status:'not_found'};
 if(row.state!=='active')return {id,status:row.state,replacementId:row.replacementId};
 const issuer=passportIssuer(),trusted=await tx.select().from(keys).where(eq(keys.issuer,issuer)).for('share');
 const checked=verifyPassportIntegrity(uploaded??row.document,trusted,issuer);
 if(!checked.valid)return {id,status:checked.status};
 if(uploaded&&canonicalJson(uploaded)!==canonicalJson(row.document))return {id,status:'document_mismatch'};
 const current=await availablePublicClaims(row.userId,tx);
 if(row.document.body.claims.some(p=>!current.some(c=>canonicalJson(c)===canonicalJson(p))))return {id,status:'evidence_changed'};
 return {id,status:'active',integrity:'verified',currentStatusCheckedAt:new Date().toISOString(),document:row.document};
}
export async function readPublicPassport(id:string,uploaded?:SignedPassportDocument){return db.transaction(async tx=>{await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('share');return currentPassport(tx,id,uploaded);});}
