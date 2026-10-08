/** Exactly one own synthetic task answer for the readable delivery actors. */
import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const privateLedger=process.argv[2],runtimePath=process.argv[3];assert.ok(privateLedger?.replaceAll('\\','/').startsWith('C:/Users/Misha/.codex/private/signal-delivery-demo-20261009-'));assert.ok(runtimePath?.replaceAll('\\','/').startsWith('C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008/outputs/verification/'));
const ledger=JSON.parse(await readFile(privateLedger,'utf8'));assert.equal(ledger.synthetic,true);assert.equal(ledger.practice,undefined,'Avoid duplicate delivery tasks');
const owner=ledger.actors.find(a=>a.suffix==='team'),candidate=ledger.actors.find(a=>a.suffix==='alexey');assert.equal(owner.name,'Команда разработки');assert.equal(candidate.name,'Алексей Орлов');const resumeId=candidate.resumeIds[0];
const env=Object.fromEntries((await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008.env','utf8')).split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));const database=new URL(env.DATABASE_URL);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_employer_e_20261008');const pool=new pg.Pool({connectionString:env.DATABASE_URL});
const runtimeSha256=createHash('sha256').update(await readFile(runtimePath)).digest('hex'),receipts=[];let passed=false,failure,templateId,offerId;
async function request(actor,path,method='GET',body,status=200){const r=await fetch('http://localhost:4413/api'+path,{method,headers:{Cookie:actor.cookie,Origin:'http://signal-employer.localhost:4414',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const json=await r.json();receipts.push({actorId:actor.id,path,method,status:r.status});assert.equal(r.status,status,json.error);return json;}
const save=()=>writeFile(privateLedger,JSON.stringify(ledger,null,2));
try{
  assert.equal(Number((await pool.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count),17);
  const before=(await request(candidate,`/me/skill-matrix?resumeId=${resumeId}`)).qualification.verifiedGrade;assert.equal(before,'Junior');
  await request(candidate,'/me/microtasks/preferences','PUT',{enabled:true});
  const template=await request(owner,'/employer/microtasks','POST',{title:'Повторная отправка заявки',competency:'Надёжность API',specialization:'Backend / Python',
    scenario:'Учебный сервис принимает заявки на вымышленный кружок. После сетевого сбоя клиент отправляет одну и ту же заявку повторно. Предложите формат идентификатора запроса, способ атомарно сохранить заявку и результат и два теста. Используйте только вымышленные данные; доступ к системам компании и рабочий код не требуются.',
    expectedMinutes:15,intervalDays:7,deadlineDays:3,educationalOnly:true,rubric:[{id:'repeat',label:'Повтор не создаёт вторую заявку',maxPoints:4},{id:'atomic',label:'Заявка и результат сохраняются атомарно',maxPoints:3},{id:'checks',label:'Два проверяемых сценария',maxPoints:3}]},201);
  templateId=template.id;ledger.practice={synthetic:true,templateId,resumeId};await save();
  await request(owner,`/employer/microtasks/${templateId}/subscriptions`,'POST',{candidateId:candidate.id,resumeId});
  const offers=(await request(candidate,'/me/microtasks')).offers;const offer=offers.find(item=>item.snapshot.title==='Повторная отправка заявки'&&item.companyId===owner.companyId&&item.resumeId===resumeId);assert.ok(offer);assert.equal(offer.status,'offered');offerId=offer.id;Object.assign(ledger.practice,{offerId});await save();
  await request(candidate,`/me/microtasks/${offerId}/decision`,'POST',{decision:'accept',consentCompanyReview:true});
  await request(candidate,`/me/microtasks/${offerId}/submit`,'POST',{answer:'Передаю UUID в заголовке Idempotency-Key. В транзакции сохраняю ключ, заявку и ответ; повтор с тем же ключом возвращает прежний ответ. Другое тело с тем же ключом даёт конфликт. Проверяю два случая: последовательный повтор создаёт одну заявку; два одновременных запроса с одним ключом также создают одну заявку и получают одинаковый результат.'});
  const evaluated=await request(owner,`/employer/microtasks/offers/${offerId}/evaluate`,'POST',{scores:[
    {criterionId:'repeat',points:4,comment:'Один и тот же UUID возвращает сохранённый результат; другое тело с тем же ключом вызывает конфликт.'},
    {criterionId:'atomic',points:3,comment:'Ключ, заявка и результат записываются в одной транзакции, поэтому нет промежуточного состояния.'},
    {criterionId:'checks',points:3,comment:'Названы последовательный повтор и конкурентные запросы; в обоих случаях ожидается одна заявка и одинаковый ответ.'}],
    feedback:'Решение охватывает повтор, атомарность и два проверяемых сценария. В учебном примере следующей проверкой может быть сбой после commit перед отправкой ответа. Оценка относится только к этой рубрике.'});
  assert.equal(evaluated.status,'evaluated');assert.equal(evaluated.result.total,10);assert.equal(evaluated.result.max,10);assert.equal(evaluated.result.qualificationEffect,'none');
  const templates=await request(owner,'/employer/microtasks');const counted=templates.find(item=>item.id===templateId);assert.equal(counted.answerCount,1);assert.equal(counted.evaluatedAnswerCount,1);
  assert.equal((await request(candidate,`/me/skill-matrix?resumeId=${resumeId}`)).qualification.verifiedGrade,before);
  Object.assign(ledger.practice,{status:'evaluated',ownerRoute:`/employer/microtasks?task=${templateId}&tab=answers`,profileRoute:`/employer/microtasks?task=${templateId}&tab=answers&offer=${offerId}&profile=1`});await save();passed=true;
}catch(error){failure={name:error.name,message:error.message};}
finally{await pool.end();const report=`outputs/verification/delivery-demo-20261009/microtask-${ledger.runId}.json`;await writeFile(report,JSON.stringify({passed,failure,synthetic:true,exactlyOneNewTask:true,existingRecordsUntouched:true,templateId,offerId,resumeId,candidateId:candidate.id,companyId:owner.companyId,runtimePath,runtimeSha256,receipts,verifiedAt:new Date().toISOString()},null,2));console.log(JSON.stringify({passed,failure,templateId,offerId,resumeId,report,privateLedger}));}
if(!passed)process.exitCode=1;
