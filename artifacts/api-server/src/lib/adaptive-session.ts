import { randomUUID } from 'node:crypto';
import { and,eq,sql } from 'drizzle-orm';
import { db,signalAdaptiveSessionsTable as sessions,signalAdaptiveExposuresTable as exposures,signalSkillExposuresTable as acceptedExposures,signalBankTemplateOverridesTable as overrides,signalSkillBankReleasesTable as releases,type AdaptiveSavedItem,type AdaptiveSavedAnswer,type SkillLevel } from '@workspace/db';
import { ADAPTIVE_PROCEDURE,adaptiveState,nextAdaptiveItem } from './adaptive-assessment';
import { buildSkillAttempt,scoreSkillAttempt,skillContentFamilyId,skillModuleRegistry,SkillBankUnavailableError } from './skill-module-bank';
import { bankContentHash,currentBankBundle } from './skill-bank-manifest';
import { ReviewError } from './assessment-review';
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Session=typeof sessions.$inferSelect;
export const adaptiveExperimentEnabled=()=>process.env.SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED==='true';
/** History remains readable when issuance/scoring is disabled; never advances the session. */
export async function readAdaptiveSession(userId:number,id:string){
 const a=(await db.select().from(sessions).where(and(eq(sessions.id,id),eq(sessions.userId,userId))).limit(1))[0];
 if(!a)throw new ReviewError(404,'SESSION_NOT_FOUND','Экспериментальная сессия не найдена.');
 return a;
}
function observations(a:Session){return a.answers.map(x=>({itemId:x.itemId,familyId:x.familyId,competencyId:x.competencyId,passed:x.passed,receivedAt:x.receivedAt,skipped:x.skipped}));}
async function owned(id:string,userId:number,tx:Tx){const a=(await tx.select().from(sessions).where(and(eq(sessions.id,id),eq(sessions.userId,userId))).for('update'))[0];if(!a)throw new ReviewError(404,'SESSION_NOT_FOUND','Экспериментальная сессия не найдена.');return a;}
export function publicAdaptiveSession(a:Session){
 const question=a.currentItemId?a.pool.find(i=>i.id===a.currentItemId):null,state=adaptiveState(a.topics,observations(a),new Date(),a.deadline);
 return {id:a.id,procedure:a.procedure,experimental:true,qualificationGranted:false,skillId:a.skillId,level:a.level,revision:a.revision,state:a.state,outcome:a.outcome??state.outcome,deadline:a.deadline.toISOString(),parentId:a.parentId,
  coverage:state.coverage.map(c=>({competencyId:c.id,observations:c.n,successes:c.successes,mastery:c.mastery})),answerCount:a.answers.length,analysisPending:a.answers.some(v=>!v.skipped&&v.passed===null),
  question:question?{id:question.id,competencyId:question.competencyId,title:question.question.title,prompt:question.question.prompt,responseType:question.question.responseType,options:question.question.options}:null,
  savedAnswers:a.answers.map(v=>({itemId:v.itemId,answer:v.answer,receivedAt:v.receivedAt,skipped:v.skipped})),
 };
}
export async function createAdaptiveSession(userId:number,input:{id:string;skillId:string;level:SkillLevel;parentId?:string}){
 return db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(4410,${userId})`);
  const previous=(await tx.select().from(sessions).where(eq(sessions.id,input.id)).limit(1))[0];
  if(previous){if(previous.userId!==userId||previous.skillId!==input.skillId||previous.level!==input.level||(previous.parentId??undefined)!==input.parentId)throw new ReviewError(409,'COMMAND_KEY_REUSED','Ключ сессии уже использован.');return previous;}
  const module=skillModuleRegistry.find(m=>m.id===input.skillId&&m.availableLevels.includes(input.level));if(!module)throw new ReviewError(422,'LEVEL_UNSUPPORTED','Программа этого уровня недоступна.');
  const recent=await tx.select({id:sessions.id}).from(sessions).where(and(eq(sessions.userId,userId),sql`${sessions.createdAt}>now()-interval '24 hours'`));if(recent.length>=3)throw new ReviewError(429,'EXPERIMENT_DAILY_LIMIT','Достигнут лимит экспериментальных сессий.');
  const parent=input.parentId?await owned(input.parentId,userId,tx):null;
  if(parent&&(parent.procedure!==ADAPTIVE_PROCEDURE||parent.skillId!==input.skillId||parent.level!==input.level||parent.state!=='finished'||parent.outcome!=='insufficient_data'||parent.answers.length>=24||+parent.deadline<=Date.now()))throw new ReviewError(409,'REFINEMENT_NOT_AVAILABLE','Уточнение недоступно для этой сессии.');
  await tx.execute(sql`SELECT pg_advisory_xact_lock(751203)`);
  const bank=currentBankBundle();if(parent&&parent.bankReleaseHash!==bank.manifestHash)throw new ReviewError(409,'RELEASE_CHANGED','Уточнение требует того же выпуска программы.');
  await tx.insert(releases).values({contentHash:bank.manifestHash,releaseId:bank.releaseId,programVersion:bank.manifest.programVersion,manifest:bank.manifest,sources:bank.sources,attestation:bank.attestation,attestationHash:bankContentHash(bank.attestation)}).onConflictDoNothing();
  const disabled=new Set((await tx.select().from(overrides).where(eq(overrides.status,'disabled'))).map(r=>skillContentFamilyId(r.templateId)));
  const accepted=await tx.select().from(acceptedExposures).where(eq(acceptedExposures.userId,userId));for(const e of accepted)disabled.add(skillContentFamilyId(e.templateId));
  const experimental=await tx.select().from(exposures).where(eq(exposures.userId,userId));for(const e of experimental)disabled.add(e.familyId);
  const global=await tx.select({familyId:exposures.familyId,n:sql<number>`count(*)::int`}).from(exposures).groupBy(exposures.familyId);for(const e of global)if(e.n>=1000)disabled.add(e.familyId);
  const acceptedGlobal=await tx.select({templateId:acceptedExposures.templateId,n:sql<number>`count(*)::int`}).from(acceptedExposures).groupBy(acceptedExposures.templateId);
  const familyGlobal=new Map<string,number>();for(const e of acceptedGlobal){const family=skillContentFamilyId(e.templateId);familyGlobal.set(family,(familyGlobal.get(family)??0)+e.n);}for(const e of global)familyGlobal.set(e.familyId,(familyGlobal.get(e.familyId)??0)+e.n);for(const [family,n]of familyGlobal)if(n>=1000)disabled.add(family);
  const seed=randomUUID(),pool:AdaptiveSavedItem[]=[];
  for(let round=0;round<4;round++){
   try{const form=buildSkillAttempt(input.skillId,input.level,`${seed}:${round}`,{disabled});
    for(const q of form.cases){const familyId=q.contentFamilyId??skillContentFamilyId(q.templateId);if(disabled.has(familyId))continue;pool.push({id:`${round}:${q.id}`,familyId,competencyId:q.competencyId,available:true,exposure:familyGlobal.get(familyId)??0,question:q,oracle:form.oracles[q.id]!,policy:form.policy});disabled.add(familyId);}
   }catch(e){if(e instanceof SkillBankUnavailableError)break;throw e;}
  }
  const [saved]=await tx.insert(sessions).values({id:input.id,userId,parentId:parent?.id,procedure:ADAPTIVE_PROCEDURE,skillId:input.skillId,level:input.level,bankReleaseHash:bank.manifestHash,seed,topics:[...module.competencies],pool,answers:parent?.answers??[],deadline:parent?.deadline??new Date(Date.now()+45*60000)}).returning();
  if(parent)await tx.update(sessions).set({state:'refined',currentItemId:null,revision:parent.revision+1}).where(eq(sessions.id,parent.id));
  return saved!;
 });
}
/** Persist first. Model recovery is deliberately a separate transaction. */
export async function saveAdaptiveAnswer(userId:number,id:string,input:{revision:number;commandKey:string;itemId:string;answer:string;skip:boolean}){
 return db.transaction(async tx=>{
  const a=await owned(id,userId,tx),repeat=a.answers.find(v=>v.commandKey===input.commandKey);
  if(repeat){if(repeat.answer!==input.answer||repeat.itemId!==input.itemId||repeat.skipped!==input.skip)throw new ReviewError(409,'COMMAND_KEY_REUSED','Ключ ответа уже использован.');return a;}
  if(a.state!=='active'||+a.deadline<=Date.now())throw new ReviewError(409,'SESSION_CLOSED','Сессия завершена. Сохранённые ответы доступны в истории.');
  if(a.revision!==input.revision||a.currentItemId!==input.itemId)throw new ReviewError(409,'SESSION_REVISION_CONFLICT','Задание изменилось. Обновите сессию.');
  const item=a.pool.find(i=>i.id===input.itemId)!;
  const answer:AdaptiveSavedAnswer={commandKey:input.commandKey,itemId:item.id,familyId:item.familyId,competencyId:item.competencyId,answer:input.answer,receivedAt:new Date().toISOString(),passed:null,skipped:input.skip,errorCode:null};
  return (await tx.update(sessions).set({answers:[...a.answers,answer],currentItemId:null,revision:a.revision+1}).where(eq(sessions.id,a.id)).returning())[0]!;
 });
}
export async function progressAdaptiveSession(userId:number,id:string,grade:typeof scoreSkillAttempt=scoreSkillAttempt){
 return db.transaction(async tx=>{
  const a=await owned(id,userId,tx);if(a.state!=='active')return a;
  let changed=false;const answers=a.answers.map(v=>{if(v.passed!==null||v.skipped)return v;const item=a.pool.find(i=>i.id===v.itemId);if(!item)return {...v,errorCode:'SOURCE_UNAVAILABLE'};
   try{const evaluated=grade([item.question],{[item.question.id]:item.oracle},{[item.question.id]:v.answer},item.policy);changed=true;return {...v,passed:evaluated.competencies[0]!.passed,errorCode:null};}catch{changed=true;return {...v,errorCode:'SCORING_UNAVAILABLE'};}
  });
  const state=adaptiveState(a.topics,observations({...a,answers}),new Date(),a.deadline);
  if(state.outcome!=='continue'){
   const finished=state.outcome!=='analysis_pending';return (await tx.update(sessions).set({answers,state:finished?'finished':'active',outcome:state.outcome,currentItemId:null,revision:a.revision+(changed||finished?1:0)}).where(eq(sessions.id,a.id)).returning())[0]!;
  }
  if(a.currentItemId&&!changed)return a;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(751203)`);
  const disabled=new Set((await tx.select().from(overrides).where(eq(overrides.status,'disabled'))).map(r=>skillContentFamilyId(r.templateId)));
  const personal=await tx.select().from(exposures).where(eq(exposures.userId,userId));for(const e of personal)disabled.add(e.familyId);
  const totals=new Map<string,number>();
  for(const r of await tx.select({familyId:exposures.familyId,n:sql<number>`count(*)::int`}).from(exposures).groupBy(exposures.familyId))totals.set(r.familyId,r.n);
  for(const r of await tx.select({templateId:acceptedExposures.templateId,n:sql<number>`count(*)::int`}).from(acceptedExposures).groupBy(acceptedExposures.templateId)){const f=skillContentFamilyId(r.templateId);totals.set(f,(totals.get(f)??0)+r.n);}
  for(const [f,n]of totals)if(n>=1000)disabled.add(f);
  const next=nextAdaptiveItem(a.pool,a.topics,observations({...a,answers}),a.seed,new Date(),a.deadline,disabled);
  if(next.item)await tx.insert(exposures).values({id:randomUUID(),sessionId:a.id,userId,familyId:next.item.familyId});
  return (await tx.update(sessions).set({answers,currentItemId:next.item?.id??null,state:next.item?'active':'finished',outcome:next.item?null:'insufficient_data',revision:a.revision+1}).where(eq(sessions.id,a.id)).returning())[0]!;
 });
}
export async function finishAdaptiveSession(userId:number,id:string,revision:number){return db.transaction(async tx=>{const a=await owned(id,userId,tx);if(a.state==='finished')return a;if(a.state!=='active'||a.revision!==revision||a.answers.some(v=>!v.skipped&&v.passed===null))throw new ReviewError(409,'SESSION_REVISION_CONFLICT','Дождитесь сохранения ответа и обновите сессию.');return (await tx.update(sessions).set({state:'finished',outcome:'insufficient_data',currentItemId:null,revision:a.revision+1}).where(eq(sessions.id,id)).returning())[0]!;});}
