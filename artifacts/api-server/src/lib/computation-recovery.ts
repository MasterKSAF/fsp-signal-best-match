import {and,eq,inArray,lt,sql} from 'drizzle-orm';
import {db,signalComputationTasksTable as tasks} from '@workspace/db';
import {createRequirementPreview} from './requirement-preview';
import {recoverWatchComputation} from './selection-watch';
import {ComputationAccessError} from './signal-computation-tasks';
import {logger} from './logger';

/** Only replay known pure computations. Never apply a requirement or create an invitation. */
export async function recoverPendingComputations(){
 // Expire disposable payloads before replay, so old failures cannot starve recent work.
 await db.update(tasks).set({state:'failed',result:null,leaseUntil:null,errorCode:'calculation_retention_expired',updatedAt:new Date()}).where(and(inArray(tasks.state,['ready','queued','running']),lt(tasks.createdAt,new Date(Date.now()-7*86400000))));
 const rows=await db.select().from(tasks).where(and(inArray(tasks.kind,['requirements-preview','selection-watch']),sql`(${tasks.state}='queued' OR (${tasks.state}='running' AND ${tasks.leaseUntil}<now()))`)).orderBy(tasks.updatedAt,tasks.id).limit(5);
 for(const row of rows)try{
  if(row.kind==='selection-watch')await recoverWatchComputation(row);
  else await createRequirementPreview({actorId:row.actorId,companyId:row.companyId},{type:row.contextType,id:row.contextId},row.input.patch,row.commandKey,row.input.refinement as {feedbackId:string;excludeCandidateIds:number[]}|undefined);
 }catch(e){
  // A still-valid API/worker lease owns its own completion. Do not overwrite it.
  if(e instanceof ComputationAccessError)await db.update(tasks).set({state:'discarded_stale',result:null,errorCode:'access_revoked',leaseUntil:null,updatedAt:new Date()}).where(and(eq(tasks.id,row.id),eq(tasks.state,'queued')));
  else {await db.update(tasks).set({updatedAt:new Date()}).where(and(eq(tasks.id,row.id),sql`${tasks.state} in ('queued','running')`));logger.warn({computationError:e instanceof Error?e.name:'unknown'},'Computation recovery deferred');}
 }
}
export function startComputationRecovery(){
 if(process.env.SIGNAL_COMPUTATION_RECOVERY_ENABLED==='false')return()=>{};let busy=false;
 const tick=async()=>{if(busy)return;busy=true;try{await recoverPendingComputations();}catch{logger.warn({computationError:'recovery_retry'},'Computation recovery will retry');}finally{busy=false;}};
 const timer=setInterval(()=>void tick(),5000);timer.unref();void tick();return()=>clearInterval(timer);
}
