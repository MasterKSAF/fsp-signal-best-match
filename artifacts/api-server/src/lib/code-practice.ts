import {createHash,randomUUID} from 'node:crypto';
import {and,desc,eq,sql} from 'drizzle-orm';
import {db,signalCodePracticeTable as attempts,type CodePracticeReceipt} from '@workspace/db';
import {CODE_RUNTIME,CODE_TEST_VERSION,codePracticePrompt,codePracticeTests,codeRunnerEnabled,resolveCodeImage,runCodeTest,stopCodeContainer,type CodeStatus} from './code-runner';
import {ReviewError} from './assessment-review';
import {logger} from './logger';
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Attempt=typeof attempts.$inferSelect;
async function own(tx:Tx,id:string,userId:number){const a=(await tx.select().from(attempts).where(and(eq(attempts.id,id),eq(attempts.userId,userId))).for('update'))[0];if(!a)throw new ReviewError(404,'PRACTICE_NOT_FOUND','Практическая проверка не найдена.');return a;}
export function publicCodePractice(a:Attempt){return {id:a.id,task:codePracticePrompt,taskVersion:a.taskVersion,revision:a.revision,state:a.state,status:a.status,deadline:a.deadline.toISOString(),submittedAt:a.submittedAt?.toISOString()??null,source:a.source,sourceHash:a.sourceHash,history:a.history,qualificationGranted:false,experimental:true};}
export async function issueCodePractice(userId:number,id:string){return db.transaction(async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(7490,${userId})`);const existing=(await tx.select().from(attempts).where(eq(attempts.id,id)).limit(1))[0];if(existing){if(existing.userId!==userId)throw new ReviewError(409,'COMMAND_KEY_REUSED','Ключ уже использован.');return existing;}
 const recent=await tx.select({id:attempts.id}).from(attempts).where(and(eq(attempts.userId,userId),sql`${attempts.createdAt}>now()-interval '24 hours'`));if(recent.length>=3)throw new ReviewError(429,'PRACTICE_DAILY_LIMIT','Достигнут лимит практических проверок.');
 return (await tx.insert(attempts).values({id,userId,taskVersion:CODE_TEST_VERSION,tests:codePracticeTests(randomUUID()),deadline:new Date(Date.now()+30*60000)}).returning())[0]!;
});}
export async function readCodePractice(userId:number,id:string){return db.transaction(tx=>own(tx,id,userId));}
export async function listCodePractice(userId:number){return db.select().from(attempts).where(eq(attempts.userId,userId)).orderBy(desc(attempts.createdAt)).limit(30);}
export async function submitCodePractice(userId:number,id:string,input:{revision:number;source:string}){return db.transaction(async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(7491,1)`);const a=await own(tx,id,userId),sourceHash=createHash('sha256').update(input.source).digest('hex');
 if(a.sourceHash){if(a.sourceHash!==sourceHash)throw new ReviewError(409,'SUBMISSION_ALREADY_SAVED','Исходный код уже сохранён. Для другого решения начните новую проверку.');return a;}
 if(a.revision!==input.revision||a.state!=='draft'||+a.deadline<=Date.now())throw new ReviewError(409,'PRACTICE_CLOSED','Срок отправки истёк или проверка уже изменена.');
 const queue=await tx.select({id:attempts.id}).from(attempts).where(sql`${attempts.state} in ('queued','running')`);if(queue.length>=50)throw new ReviewError(503,'RUNNER_QUEUE_FULL','Очередь проверок заполнена. Код ещё не принят; повторите отправку.');
 return (await tx.update(attempts).set({source:input.source,sourceHash,submittedAt:new Date(),state:'queued',revision:a.revision+1}).where(eq(attempts.id,id)).returning())[0]!;
});}
export async function retryCodePractice(userId:number,id:string,revision:number){return db.transaction(async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(7491,1)`);const a=await own(tx,id,userId);if(a.state==='queued'||a.state==='running')return a;
 if(a.revision!==revision||a.status!=='infrastructure_error'||a.history.length>=3)throw new ReviewError(409,'PRACTICE_RETRY_UNAVAILABLE','Повтор доступен только после сбоя среды, не более двух раз.');
 // Original source and its on-time receipt stay unchanged even if recovery is after deadline.
 const queue=await tx.select({id:attempts.id}).from(attempts).where(sql`${attempts.state} in ('queued','running')`);if(queue.length>=50)throw new ReviewError(503,'RUNNER_QUEUE_FULL','Очередь проверок заполнена. Повторите позже.');
 return (await tx.update(attempts).set({state:'queued',status:null,revision:a.revision+1}).where(eq(attempts.id,id)).returning())[0]!;
});}
export async function cancelCodePractice(userId:number,id:string,revision:number){const a=await db.transaction(async tx=>{const a=await own(tx,id,userId);if(a.state==='cancelled')return a;if(a.state==='finished'||a.revision!==revision)throw new ReviewError(409,'PRACTICE_REVISION_CONFLICT','Проверка изменилась. Обновите экран.');return (await tx.update(attempts).set({state:'cancelled',status:'cancelled',fence:a.fence+1,revision:a.revision+1,leaseUntil:null}).where(eq(attempts.id,id)).returning())[0]!;});if(a.containerName)await stopCodeContainer(a.containerName);return a;}
export async function claimCodeExecution(){return db.transaction(async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(7491,1)`);
 const running=await tx.select({id:attempts.id}).from(attempts).where(sql`${attempts.state}='running' and ${attempts.leaseUntil}>now()`);if(running.length>=2)return null;
 const a=(await tx.select().from(attempts).where(sql`${attempts.state}='queued' or (${attempts.state}='running' and ${attempts.leaseUntil}<now())`).orderBy(attempts.submittedAt).for('update',{skipLocked:true}).limit(1))[0];if(!a)return null;
 return (await tx.update(attempts).set({state:'running',fence:a.fence+1,leaseUntil:new Date(Date.now()+60000),revision:a.revision+1}).where(eq(attempts.id,a.id)).returning())[0]!;
});}
export async function publishCodeExecution(a:Attempt,receipt:CodePracticeReceipt){return db.transaction(async tx=>{
 const current=(await tx.select().from(attempts).where(eq(attempts.id,a.id)).for('update'))[0];if(!current||current.state!=='running'||current.fence!==a.fence||!current.leaseUntil||+current.leaseUntil<=Date.now())return false;
 await tx.update(attempts).set({state:'finished',status:receipt.status,history:[...current.history,receipt],leaseUntil:null,containerName:null,imageDigest:receipt.imageDigest,revision:current.revision+1}).where(eq(attempts.id,a.id));return true;
});}
export async function executeClaimedCode(a:Attempt){
 if(a.containerName)await stopCodeContainer(a.containerName);
 const imageDigest=a.imageDigest??await resolveCodeImage();let status:CodeStatus='infrastructure_error',reason:string|null='image_unavailable',passed=0;
 if(imageDigest&&a.source&&a.taskVersion===CODE_TEST_VERSION){
  for(const [index,test]of a.tests.entries()){
   const containerName=`signal-code-${a.id}-${a.fence}-${index}`;
   const changed=await db.update(attempts).set({containerName,imageDigest}).where(and(eq(attempts.id,a.id),eq(attempts.fence,a.fence),eq(attempts.state,'running'),sql`${attempts.leaseUntil}>now()`)).returning({id:attempts.id});if(!changed.length)return false;
   const r=await runCodeTest({attemptId:a.id,fence:a.fence,index,source:a.source,test,imageDigest});status=r.status;reason=r.reason;if(status!=='passed')break;passed++;
  }
 }
 return publishCodeExecution(a,{fence:a.fence,status,reason,imageDigest,runtimeVersion:CODE_RUNTIME,testVersion:a.taskVersion,passed,total:a.tests.length,finishedAt:new Date().toISOString()});
}
export function startCodePracticeWorker(){let stopped=false,busy=false;const tick=async()=>{if(stopped||busy||!codeRunnerEnabled())return;busy=true;try{const a=await claimCodeExecution();if(a)await executeClaimedCode(a);}catch{logger.warn({codePracticeError:'worker_retry'},'Code worker will recover its durable lease');}finally{busy=false;}};const timer=setInterval(()=>void tick(),1500);timer.unref();void tick();return()=>{stopped=true;clearInterval(timer);};}
