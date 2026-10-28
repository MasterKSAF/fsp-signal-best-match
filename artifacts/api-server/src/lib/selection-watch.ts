import { createHash,randomUUID } from 'node:crypto';
import { and,eq,lte,inArray,sql } from 'drizzle-orm';
import { db,signalSelectionWatchesTable as watches,signalSelectionWatchEventsTable as events,signalUsersTable as users,signalDependencyEpochTable as epochs,type WatchEntry } from '@workspace/db';
import { canonicalJson } from './canonical-json';
import { currentComputationVersions,enqueueComputation,claimComputation,publishComputation,readCurrentComputation,ComputationAccessError,StaleComputationError } from './signal-computation-tasks';
import { type PreviewActor,RefinementError } from './requirement-preview';
import { loadOwnedSelectionContext } from './signal-employer-context';
import { selectionMatchNeed,type SelectionContextRef } from './selection-context-contract';
import { loadSelectionResumes } from './employer-selection-service';
import { evaluateResumeCandidates } from './signal-resume-evaluation';
import { rankMatches } from './signal-matching';
import { selectMatchingResumes } from './signal-resume-catalog';
import { candidateQualificationFingerprint } from './matching-factor-ledger';
import { contextExcludedCandidates } from './selection-exclusions';
import { poolScopeForAccount } from './signal-pool-scope';
import { runCompanyCommand,findCompanyCommand } from './company-command';
import { logger } from './logger';
import { canonicalSkillKey } from './skill-catalog';
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const refOf=(row:typeof watches.$inferSelect):SelectionContextRef=>({type:row.contextType,id:row.contextId});
const actorOf=(row:typeof watches.$inferSelect):PreviewActor=>({actorId:row.actorId,companyId:row.companyId});

async function currentPool(actor:PreviewActor,ref:SelectionContextRef) {
 const loaded=await loadOwnedSelectionContext(actor.companyId,ref);
 if(!loaded?.active)throw new ComputationAccessError('Контекст недоступен.');
 const [user]=await db.select().from(users).where(eq(users.id,actor.actorId)),scope=poolScopeForAccount(user);
 const authorized=await loadSelectionResumes(actor.companyId,scope,'matching'),excluded=await contextExcludedCandidates(actor.companyId,loaded.context);
 const ranked=rankMatches(selectMatchingResumes(evaluateResumeCandidates(loaded.matchNeed,authorized.filter(c=>!excluded.has(c.userId)),scope.demoMode,new Date()).filter(row=>row.evaluation.eligible)));
 const required=new Set(loaded.matchNeed.requiredSkills.map(canonicalSkillKey));
 return {loaded,ranked,entries:ranked.map((row,index):WatchEntry=>({candidateId:row.candidate.userId,resumeId:row.candidate.resumeId,resumeRevision:row.candidate.resumeRevision,proofHash:candidateQualificationFingerprint(row.candidate),
  proofKeys:[...(row.candidate.skillEvidence??[]).filter(p=>required.has(canonicalSkillKey(p.skill))&&(p.sourceType==='signal_skill_module'||p.sourceType==='signal_assessment')).map(p=>hash([p.sourceType,p.evidenceId??null,p.attemptId,p.programVersion,p.criterionId,p.level??null])),
   ...(row.candidate.assessmentEvidence?.state==='verified'?[hash(['assessment',row.candidate.assessmentEvidence.attemptId,row.candidate.assessmentEvidence.programVersion,row.candidate.assessmentEvidence.grade])]:[])],position:index+1})),conditionsHash:hash(selectionMatchNeed(loaded.context))};
}
async function capturedPool(actor:PreviewActor,ref:SelectionContextRef,key:string) {
 const task=await enqueueComputation({...actor,context:ref,kind:'selection-watch',commandKey:key,input:{}});
 if(task.state!=='ready'){
  const lease=await claimComputation(task.id);if(!lease)throw new RefinementError(409,'watch_processing','Обновление уже выполняется.');
  const pool=await currentPool(actor,ref);
  if(pool.loaded.context.version!==lease.versions.contextRevision){await publishComputation(task.id,lease.leaseFence,{});throw new StaleComputationError('Требования изменились.');}
  const published=await publishComputation(task.id,lease.leaseFence,{entries:pool.entries,conditionsHash:pool.conditionsHash});
  if(!published.published)throw new StaleComputationError('Данные обновились во время расчёта.');
 }
 const ready=await readCurrentComputation(task.id,actor.actorId,actor.companyId);
 if(ready.state!=='ready'||!ready.result)throw new StaleComputationError('Расчёт ещё не готов.');
 return {versions:task.versions,entries:ready.result.entries as WatchEntry[],conditionsHash:ready.result.conditionsHash as string};
}
export async function recoverWatchComputation(row:{actorId:number;companyId:number;contextType:'job'|'need';contextId:number;commandKey:string}){await capturedPool({actorId:row.actorId,companyId:row.companyId},{type:row.contextType,id:row.contextId},row.commandKey);}
const personKey=(entry:WatchEntry)=>`person:${entry.candidateId}`;
const proofKey=(entry:WatchEntry)=>`proof:${entry.candidateId}:${entry.proofHash}`;
const topKey=(entry:WatchEntry)=>`top:${entry.candidateId}:${entry.proofHash}`;
const proofSetKey=(entry:WatchEntry)=>`proof-set:${entry.candidateId}`;
const evidenceKey=(entry:WatchEntry,key:string)=>`evidence:${entry.candidateId}:${key}`;
export function baselineWatchKeys(entries:WatchEntry[]){return entries.flatMap(e=>[personKey(e),proofKey(e),...(e.proofKeys===undefined?[]:[proofSetKey(e),...e.proofKeys.map(key=>evidenceKey(e,key))]),...(e.position<=10?[topKey(e)]:[])]);}
export function deriveWatchChanges(before:WatchEntry[],after:WatchEntry[],seenInput:readonly string[]) {
 const seen=new Set(seenInput),prior=new Map(before.map(e=>[e.candidateId,e]));
 const changes:{entry:WatchEntry;reason:'new_candidate'|'new_proof'|'entered_top';eventKey:string}[]=[];
 for(const entry of after){
  const previous=prior.get(entry.candidateId);
  // A changed hash alone can mean revocation. Old baselines without proof keys
  // acquire them silently; only a newly available relevant proof is announced.
  const addedProof=seen.has(proofSetKey(entry))&&entry.proofKeys?.some(key=>!seen.has(evidenceKey(entry,key)));
  const reason=!seen.has(personKey(entry))?'new_candidate':addedProof&&!seen.has(proofKey(entry))?'new_proof':entry.position<=10&&(!previous||previous.position>10)&&!seen.has(topKey(entry))?'entered_top':null;
  if(reason)changes.push({entry,reason,eventKey:reason==='new_candidate'?personKey(entry):reason==='new_proof'?proofKey(entry):topKey(entry)});
  for(const key of baselineWatchKeys([entry]))seen.add(key);
 }
 return {changes,seen:[...seen]};
}
export async function configureSelectionWatch(actor:PreviewActor,ref:SelectionContextRef,input:{enabled:boolean;revision?:number;frequencyMinutes:number;commandKey:string}) {
 const payload={kind:'configure-watch',ref,...input},authorize=(tx:Parameters<Parameters<typeof db.transaction>[0]>[0])=>currentComputationVersions(actor.actorId,actor.companyId,ref,tx);
 const prior=await findCompanyCommand(actor,input.commandKey,payload,authorize);if(prior)return prior;
 // Enabling/resuming always captures a fresh baseline. No old people are announced as new.
 const snapshot=input.enabled?await capturedPool(actor,ref,`watch-enable:${input.commandKey}`):null;
 return runCompanyCommand(actor,input.commandKey,payload,authorize,async tx=>{
  await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('share');
  const current=await currentComputationVersions(actor.actorId,actor.companyId,ref,tx);
  if(snapshot&&canonicalJson(snapshot.versions)!==canonicalJson(current))throw new StaleComputationError('Данные изменились. Повторите включение подписки.');
  const [old]=await tx.select().from(watches).where(and(eq(watches.actorId,actor.actorId),eq(watches.companyId,actor.companyId),eq(watches.contextType,ref.type),eq(watches.contextId,ref.id))).for('update');
  if(old&&input.revision!==old.revision)throw new StaleComputationError('Настройки подписки изменились.');
  if(!old&&!snapshot)throw new RefinementError(404,'watch_not_found','Подписка ещё не включена.');
  const next={state:input.enabled?'active' as const:'paused' as const,frequencyMinutes:input.frequencyMinutes,contextRevision:current.contextRevision,
   watermark:current.poolEpoch,conditionsHash:snapshot?.conditionsHash??old!.conditionsHash,baseline:snapshot?.entries??old!.baseline,
   seenEvents:[...new Set([...(old?.seenEvents??[]),...baselineWatchKeys(snapshot?.entries??[])])],nextCheckAt:new Date(Date.now()+input.frequencyMinutes*60_000),updatedAt:new Date()};
  const [saved]=old?await tx.update(watches).set({...next,revision:old.revision+1}).where(eq(watches.id,old.id)).returning():await tx.insert(watches).values({id:randomUUID(),...actor,contextType:ref.type,contextId:ref.id,...next}).returning();
  if(old)await tx.update(events).set({state:'suppressed'}).where(and(eq(events.watchId,old.id),eq(events.state,'pending')));
  return {id:saved.id,state:saved.state,revision:saved.revision,frequencyMinutes:saved.frequencyMinutes,contextRevision:saved.contextRevision};
 });
}
export async function processSelectionWatch(id:string,now=new Date()) {
 const [watch]=await db.select().from(watches).where(eq(watches.id,id));if(!watch||watch.state!=='active')return;
 const actor=actorOf(watch),ref=refOf(watch);
 let versions;
 try {versions=await currentComputationVersions(actor.actorId,actor.companyId,ref);}
 catch(error){if(!(error instanceof ComputationAccessError))throw error;await db.transaction(async tx=>{
  const [closed]=await tx.update(watches).set({state:'closed',revision:watch.revision+1,updatedAt:now}).where(and(eq(watches.id,id),eq(watches.revision,watch.revision))).returning({id:watches.id});
  if(closed)await tx.update(events).set({state:'suppressed'}).where(and(eq(events.watchId,id),eq(events.state,'pending')));
 });return;}
 if(watch.watermark===versions.poolEpoch&&watch.contextRevision===versions.contextRevision){await db.update(watches).set({nextCheckAt:new Date(+now+watch.frequencyMinutes*60_000)}).where(and(eq(watches.id,id),eq(watches.revision,watch.revision)));return;}
 const snapshot=await capturedPool(actor,ref,`watch:${watch.id}:${watch.revision}:${versions.poolEpoch}`);
 await db.transaction(async tx=>{
  await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('share');
  const current=await currentComputationVersions(actor.actorId,actor.companyId,ref,tx);
  const [locked]=await tx.select().from(watches).where(eq(watches.id,id)).for('update');
  if(!locked||locked.state!=='active'||locked.revision!==watch.revision)return;
  if(canonicalJson(snapshot.versions)!==canonicalJson(current))throw new StaleComputationError('Снимок подписки устарел.');
  const rebaseline=locked.contextRevision!==current.contextRevision||locked.conditionsHash!==snapshot.conditionsHash;
  const delta=rebaseline?{changes:[],seen:[...new Set([...locked.seenEvents,...baselineWatchKeys(snapshot.entries)])]}:deriveWatchChanges(locked.baseline,snapshot.entries,locked.seenEvents);
  if(rebaseline)await tx.update(events).set({state:'suppressed'}).where(and(eq(events.watchId,id),eq(events.state,'pending')));
  for(const change of delta.changes)await tx.insert(events).values({id:randomUUID(),watchId:id,candidateId:change.entry.candidateId,resumeId:change.entry.resumeId,eventKey:change.eventKey,reason:change.reason,contextRevision:current.contextRevision,proofHash:change.entry.proofHash}).onConflictDoNothing();
  await tx.update(watches).set({baseline:snapshot.entries,seenEvents:delta.seen,contextRevision:current.contextRevision,conditionsHash:snapshot.conditionsHash,watermark:current.poolEpoch,revision:locked.revision+1,nextCheckAt:new Date(+now+locked.frequencyMinutes*60_000),updatedAt:now}).where(eq(watches.id,id));
 });
}
export async function readSelectionWatch(actor:PreviewActor,ref:SelectionContextRef) {
 return db.transaction(async tx=>{
  await tx.select().from(epochs).where(eq(epochs.key,'professional-pool')).for('share');
  const versions=await currentComputationVersions(actor.actorId,actor.companyId,ref,tx);
  const [watch]=await tx.select().from(watches).where(and(eq(watches.actorId,actor.actorId),eq(watches.companyId,actor.companyId),eq(watches.contextType,ref.type),eq(watches.contextId,ref.id))).for('update');
  if(!watch)return {watch:null,events:[]};
  if(watch.state!=='active')return {watch:{id:watch.id,state:watch.state,revision:watch.revision,frequencyMinutes:watch.frequencyMinutes},events:[]};
  const pool=await currentPool(actor,ref),byId=new Map(pool.ranked.map(row=>[row.candidate.resumeId,row.candidate]));
  // Drain pending work before replaying history. A full page of delivered rows
  // must not indefinitely hide older pending notifications.
  const rows=await tx.select().from(events).where(and(eq(events.watchId,watch.id),inArray(events.state,['pending','delivered']))).orderBy(sql`case when ${events.state} = 'pending' then 0 else 1 end`,sql`${events.createdAt} desc`,sql`${events.id} desc`).limit(100);
  const visible=[];
  for(const event of rows){
   const candidate=byId.get(event.resumeId);
   if(!candidate||candidate.userId!==event.candidateId||event.contextRevision!==versions.contextRevision||event.proofHash!==candidateQualificationFingerprint(candidate)){
    await tx.update(events).set({state:'suppressed'}).where(eq(events.id,event.id));continue;
   }
   const deliveredAt=event.deliveredAt??new Date();
   await tx.update(events).set({state:'delivered',deliveredAt}).where(eq(events.id,event.id));
   visible.push({id:event.id,reason:event.reason,candidate:{candidateId:candidate.userId,resumeId:candidate.resumeId,title:candidate.title,name:candidate.publicName??candidate.alias},createdAt:event.createdAt.toISOString(),deliveredAt:deliveredAt.toISOString(),href:`/employer/candidates?contextType=${ref.type}&contextId=${ref.id}&resumeId=${candidate.resumeId}&applied=1`});
  }
  return {watch:{id:watch.id,state:watch.state,revision:watch.revision,frequencyMinutes:watch.frequencyMinutes},events:visible};
 });
}
export function startSelectionWatchScheduler(){
 if(process.env.SIGNAL_SELECTION_WATCH_SCHEDULER_ENABLED==='false')return()=>{};
 let running=false;
 const tick=async()=>{if(running)return;running=true;try{
  const due=await db.select({id:watches.id}).from(watches).where(and(eq(watches.state,'active'),lte(watches.nextCheckAt,new Date()))).orderBy(watches.nextCheckAt).limit(20);
  for(const row of due)try{await processSelectionWatch(row.id);}catch(error){logger.warn({watchError:error instanceof Error?error.name:'unknown'},'Selection watch will retry');}
 }catch(error){logger.error({schedulerError:error instanceof Error?error.name:'unknown'},'Selection watch scheduler failed');}finally{running=false;}};
 const timer=setInterval(()=>void tick(),30_000);timer.unref();void tick();return()=>clearInterval(timer);
}
