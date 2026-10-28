import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {and,eq,inArray,lte,or,sql} from 'drizzle-orm';
import {db,signalAtsEndpointsTable as endpoints,signalOutboxTable as outbox,signalOutboxDeliveriesTable as deliveries,signalWebhookInboxTable as inbox,signalWebhookProjectionTable as projection,signalDependencyEpochTable as epochs,signalCompaniesTable as companies,signalUsersTable as users} from '@workspace/db';
import {companyOwner} from './shared-selection';
import {loadOwnedSelectionContext} from './signal-employer-context';
import {loadAccessibleShortlistCandidates} from './shortlist-access';
import {poolScopeForAccount} from './signal-pool-scope';
import {FeatureError} from './competitive-http';
import {validateWebhookEndpoint,sendWebhook,verifyWebhookSignature,webhookBodyHash} from './webhook-transport';
import {canonicalJson} from './canonical-json';
import {z} from 'zod';
import {logger} from './logger';
type User=typeof users.$inferSelect;
function encryptionKey(){const key=Buffer.from(process.env.SIGNAL_ATS_ENCRYPTION_KEY??'','base64');if(key.length!==32)throw new FeatureError(503,'ats_key_missing','Интеграции пока не настроены.');return key;}
function seal(secret:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv),encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');}
function unseal(value:string){const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',encryptionKey(),b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');}
export async function registerAtsEndpoint(user:User,url:string,revision?:number){
 await companyOwner(user);try{await validateWebhookEndpoint(url);}catch{throw new FeatureError(422,'endpoint_denied','Нужен публичный HTTPS-адрес без перенаправлений.');}
 return db.transaction(async tx=>{const c=await companyOwner(user,tx);await tx.execute(sql`select pg_advisory_xact_lock(7495,${c.id})`);const [old]=await tx.select().from(endpoints).where(eq(endpoints.companyId,c.id)).for('update');if(old&&old.revision!==revision)throw new FeatureError(409,'endpoint_changed','Интеграция изменилась.');const secret=randomBytes(32).toString('base64url'),values={companyId:c.id,actorId:user.id,url,secretCipher:seal(secret),revision:(old?.revision??0)+1,active:1};const [saved]=old?await tx.update(endpoints).set(values).where(eq(endpoints.id,old.id)).returning():await tx.insert(endpoints).values({...values,id:randomUUID()}).returning();return {id:saved.id,url:saved.url,revision:saved.revision,secret};});
}
export async function disableAtsEndpoint(user:User,id:string,revision:number){const c=await companyOwner(user);const [updated]=await db.update(endpoints).set({active:0,revision:revision+1}).where(and(eq(endpoints.id,id),eq(endpoints.companyId,c.id),eq(endpoints.revision,revision))).returning();if(!updated)throw new FeatureError(409,'endpoint_changed','Интеграция изменилась.');return {disabled:true,revision:updated.revision};}
export async function claimOutboxDelivery(endpointId?:string){
 return db.transaction(async tx=>{
  const now=new Date();const [row]=await tx.select().from(deliveries).where(and(endpointId?eq(deliveries.endpointId,endpointId):undefined,or(and(eq(deliveries.state,'queued'),lte(deliveries.nextAt,now)),and(eq(deliveries.state,'running'),lte(deliveries.leaseUntil,now))))).orderBy(deliveries.nextAt).for('update',{skipLocked:true}).limit(1);
  if(!row)return null;const [claimed]=await tx.update(deliveries).set({state:'running',fence:row.fence+1,attempts:row.attempts+1,leaseUntil:new Date(Date.now()+30000),updatedAt:now}).where(eq(deliveries.id,row.id)).returning();return claimed;
 });
}
export async function completeOutboxDelivery(claim:typeof deliveries.$inferSelect,result:'delivered'|'suppressed'|'retry',code:string){
 return db.transaction(async tx=>{const [row]=await tx.select().from(deliveries).where(eq(deliveries.id,claim.id)).for('update');if(!row||row.state!=='running'||row.fence!==claim.fence||!row.leaseUntil||+row.leaseUntil<=Date.now())return false;
  const dead=result==='retry'&&row.attempts>=5,state=result==='retry'?(dead?'dead':'queued'):result,delay=Math.min(300000,1000*2**Math.min(8,row.attempts-1))*(.75+Math.random()*.5);
  await tx.update(deliveries).set({state,lastCode:code.slice(0,80),leaseUntil:null,nextAt:new Date(Date.now()+delay),updatedAt:new Date()}).where(eq(deliveries.id,row.id));return true;});
}
export async function deliverClaimedOutbox(claim:typeof deliveries.$inferSelect){
 const [generation]=await db.select().from(epochs).where(eq(epochs.key,'professional-pool'));
 const [endpoint]=await db.select().from(endpoints).where(eq(endpoints.id,claim.endpointId));const [event]=await db.select().from(outbox).where(eq(outbox.id,claim.eventId));
 if(!endpoint||!event||!endpoint.active||endpoint.revision!==claim.endpointRevision){await completeOutboxDelivery(claim,'suppressed','endpoint_revoked');return;}
 const [company]=await db.select().from(companies).where(eq(companies.id,endpoint.companyId));const [owner]=company?await db.select().from(users).where(eq(users.id,company.ownerUserId)):[];
 if(!owner||owner.role!=='employer'||company.ownerUserId!==endpoint.actorId||event.companyId!==endpoint.companyId){await completeOutboxDelivery(claim,'suppressed','tenant_denied');return;}
 const p=event.payload;
 if(event.eventType!=='cv.access_revoked'){
  if(!['job','need'].includes(String(p.contextType))||!Number.isInteger(p.contextId)||!Number.isInteger(p.resumeId)||!Number.isInteger(p.candidateId)){await completeOutboxDelivery(claim,'suppressed','source_unavailable');return;}
  const context=await loadOwnedSelectionContext(endpoint.companyId,{type:p.contextType as 'job'|'need',id:Number(p.contextId)});
  const visible=context?.active?await loadAccessibleShortlistCandidates(endpoint.companyId,poolScopeForAccount(owner),[{candidateUserId:Number(p.candidateId),resumeId:Number(p.resumeId)}]):new Map();
  if(!visible.has(Number(p.resumeId))){await completeOutboxDelivery(claim,'suppressed','current_cv_denied');return;}
 }
 // The wire body contains routing/status references only. CV content, names, contacts, notes and internal need descriptions are never stored in the outbox or sent.
 const data=event.eventType==='cv.access_revoked'?{resumeId:Number(p.resumeId)}:{status:p.status,contextType:p.contextType,contextId:p.contextId,resumeId:p.resumeId};
 const wire={schema:'signal-ats-event-v1',id:event.id,type:event.eventType,tenant:event.companyId,entity:{type:event.entityType,id:event.entityId,version:String(event.sequence)},occurredAt:event.createdAt.toISOString(),data};
 const [fresh]=await db.select().from(deliveries).where(and(eq(deliveries.id,claim.id),eq(deliveries.state,'running'),eq(deliveries.fence,claim.fence)));
 const [currentEndpoint]=await db.select().from(endpoints).where(eq(endpoints.id,claim.endpointId));
 if(!fresh?.leaseUntil||+fresh.leaseUntil<=Date.now()||!currentEndpoint?.active||currentEndpoint.revision!==claim.endpointRevision){await completeOutboxDelivery(claim,'suppressed','lease_or_endpoint_changed');return;}
 const [latestGeneration]=await db.select().from(epochs).where(eq(epochs.key,'professional-pool'));
 if(!generation||!latestGeneration||generation.revision!==latestGeneration.revision){await completeOutboxDelivery(claim,'retry','dependencies_changed');return;}
 try{const status=await sendWebhook(endpoint.url,unseal(endpoint.secretCipher),event.id,Buffer.from(canonicalJson(wire)));await completeOutboxDelivery(claim,status>=200&&status<300?'delivered':'retry',`http_${status}`);}catch{await completeOutboxDelivery(claim,'retry','transport_unavailable');}
}
export async function retryOutboxDelivery(user:User,id:string){return db.transaction(async tx=>{const c=await companyOwner(user,tx);const [row]=await tx.select({delivery:deliveries,endpoint:endpoints}).from(deliveries).innerJoin(endpoints,eq(endpoints.id,deliveries.endpointId)).where(and(eq(deliveries.id,id),eq(endpoints.companyId,c.id))).for('update');if(!row||!row.endpoint.active||row.endpoint.revision!==row.delivery.endpointRevision)throw new FeatureError(404,'delivery_unavailable','Доставка недоступна.');if(row.delivery.state!=='dead')throw new FeatureError(409,'delivery_changed','Повтор доступен после исчерпания попыток.');await tx.update(deliveries).set({state:'queued',attempts:0,fence:row.delivery.fence+1,nextAt:new Date(),lastCode:'manual_retry',updatedAt:new Date()}).where(eq(deliveries.id,id));return {queued:true};});}
const WireSchema=z.object({schema:z.literal('signal-ats-event-v1'),id:z.string().uuid(),type:z.enum(['application.status_changed','invitation.status_changed','cv.access_revoked']),tenant:z.number().int().positive(),entity:z.object({type:z.enum(['application','invitation','cv']),id:z.number().int().positive(),version:z.string().regex(/^[1-9]\d{0,25}$/)}).strict(),occurredAt:z.string().datetime(),data:z.record(z.string(),z.unknown())}).strict();
export async function receiveWebhook(raw:Buffer,headers:{timestamp:string;eventId:string;signature:string},secret:string,expectedTenant:number){
 if(raw.length>16000||!verifyWebhookSignature(secret,headers.timestamp,headers.eventId,raw,headers.signature))throw new FeatureError(401,'signature_invalid','Invalid webhook signature');
 let parsed:unknown;try{parsed=JSON.parse(raw.toString('utf8'));}catch{throw new FeatureError(400,'invalid_event','Invalid event JSON');}const event=WireSchema.parse(parsed);if(event.tenant!==expectedTenant)throw new FeatureError(403,'tenant_denied','Event tenant mismatch');
 const dataSchema=event.type==='cv.access_revoked'?z.object({resumeId:z.number().int().positive()}).strict():z.object({status:z.string().min(1).max(40),contextType:z.enum(['job','need']),contextId:z.number().int().positive(),resumeId:z.number().int().positive()}).strict();dataSchema.parse(event.data);
 if(event.entity.type!==(event.type==='cv.access_revoked'?'cv':event.type.startsWith('application.')?'application':'invitation'))throw new FeatureError(400,'invalid_entity','Event entity mismatch');
 if(event.id!==headers.eventId)throw new FeatureError(400,'invalid_event','Event identity mismatch');
 return db.transaction(async tx=>{
  const hash=webhookBodyHash(raw);const [inserted]=await tx.insert(inbox).values({eventId:event.id,bodyHash:hash}).onConflictDoNothing().returning();
  if(!inserted){const [previous]=await tx.select().from(inbox).where(eq(inbox.eventId,event.id));if(!previous||previous.bodyHash!==hash)throw new FeatureError(409,'event_collision','Same event ID has different bytes');return {duplicate:true,applied:false};}
  const key=`${event.tenant}:${event.entity.type}:${event.entity.id}`;
  const updated=await tx.insert(projection).values({key,version:event.entity.version,body:event,effects:1}).onConflictDoUpdate({target:projection.key,set:{version:event.entity.version,body:event,effects:sql`${projection.effects}+1`},setWhere:sql`${projection.version}<${event.entity.version}::numeric`}).returning();
  return {duplicate:false,applied:updated.length>0};
 });
}
export function startAtsOutboxWorker(){
 if(process.env.SIGNAL_ATS_WORKER_ENABLED!=='true')return()=>{};let running=false;
 const tick=async()=>{if(running)return;running=true;try{for(let i=0;i<5;i++){const claim=await claimOutboxDelivery();if(!claim)break;await deliverClaimedOutbox(claim);}}catch{logger.warn({outboxError:'worker_retry'},'ATS worker will retry');}finally{running=false;}};
 const timer=setInterval(()=>void tick(),2000);timer.unref();void tick();return()=>clearInterval(timer);
}
