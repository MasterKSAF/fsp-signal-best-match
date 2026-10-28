import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {pool} from '../lib/db/src/index';
import {assertOwnDatabase,qaUser,qaNeed} from './competitive-fixtures';
import {compareMutualConditions,acceptancePredictionEnabled} from '../artifacts/api-server/src/lib/mutual-compatibility';
assertOwnDatabase();process.env.DEMO_MODE='true';
const {default:app}=await import('../artifacts/api-server/src/app');
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS',s);};
async function api(path:string,cookie:string,body?:unknown,method=body===undefined?'GET':'POST'){
 const r=await fetch(base+path,{method,headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};
}
try{
 const owner=await qaUser('employer'),foreign=await qaUser('employer'),candidate=await qaUser(),other=await qaUser(),need=await qaNeed(owner.companyId!),context={type:'need',id:need.id};
 await pool.query(`UPDATE signal_candidate_resumes SET specialization='Backend / Python',assumed_grade='Junior' WHERE id=$1`,[candidate.resumeId]);
 const pref={formats:['Удалённо'],locations:['Казань'],timeZones:['UTC+03:00'],employment:['Полная занятость']};
 const save=await api(`/candidate/offer-preferences/${candidate.resumeId}`,candidate.cookie,{shared:false,revision:0,preferences:pref},'PUT');assert.equal(save.status,200,JSON.stringify(save.data));
 assert.equal((await api(`/candidate/offer-preferences/${candidate.resumeId}`,other.cookie)).status,404);
 assert.equal((await api(`/candidate/offer-preferences/${candidate.resumeId}`,candidate.cookie,{shared:true,revision:0,preferences:pref},'PUT')).status,409);
 const req={context,candidateId:candidate.id,resumeId:candidate.resumeId};
 let r=await api('/employer/offer-compatibility',owner.cookie,req);assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.factors.filter((f:any)=>f.id!=='direction').every((f:any)=>f.state==='unknown'));
 assert.equal((await api('/employer/offer-compatibility',foreign.cookie,req)).status,404);
 assert.equal((await api('/employer/offer-compatibility',owner.cookie,{...req,resumeId:other.resumeId})).status,404);pass('exact CV ownership, opt-in, unknown hidden preferences and stale update conflict');
 await api(`/candidate/offer-preferences/${candidate.resumeId}`,candidate.cookie,{shared:true,revision:1,preferences:pref},'PUT');
 const offer={location:'Казань',timeZone:'UTC+03:00',employment:'Полная занятость'};
 assert.equal((await api('/employer/offer-conditions',owner.cookie,{context,contextRevision:need.revision,revision:0,conditions:offer},'PUT')).status,200);
 r=await api('/employer/offer-compatibility',owner.cookie,req);assert.equal(r.data.contextRevision,need.revision+1);assert.ok(r.data.factors.filter((f:any)=>f.id!=='salary').every((f:any)=>f.state==='match'));assert.equal(r.data.prediction.available,false);
 await pool.query(`UPDATE signal_needs SET required_skills=ARRAY['Python'],skill_requirements='[{"skill":"Python","mode":"verified","level":"Senior"}]',revision=revision+1 WHERE id=$1`,[need.id]);
 assert.equal((await api('/employer/offer-compatibility',owner.cookie,req)).data.professionallyEligible,false);pass('offer revision refresh, deterministic factors and independent mandatory professional requirements');
 const salary=[];for(const amount of [1,1000,100000,1000000,10000000]){
  await pool.query('UPDATE signal_needs SET salary_min=$2,salary_max=$2,revision=revision+1 WHERE id=$1',[need.id,amount]);
  const v=(await api('/employer/offer-compatibility',owner.cookie,req)).data;salary.push(v.factors.find((f:any)=>f.id==='salary'));assert.ok(!JSON.stringify(v).includes('salaryMin'));
 }assert.ok(salary.every(f=>f.state==='unknown'));process.env.SIGNAL_ACCEPTANCE_PREDICTION_ENABLED='true';assert.equal(acceptancePredictionEnabled(),false);pass('repeated offer salary edits provide no private threshold oracle; prediction cannot be enabled without accepted model');
 const job=(await pool.query(`INSERT INTO signal_jobs(company_id,title,description,specialization,grade,work_format,skills,status,salary_min,salary_max,salary_period,salary_type) VALUES($1,'QA public vacancy','Public QA','Backend / Python','Junior','Удалённо',ARRAY['Python'],'published',100000,200000,'month','gross') RETURNING id,version`,[owner.companyId])).rows[0];
 assert.equal((await api('/employer/offer-conditions',owner.cookie,{context:{type:'job',id:job.id},contextRevision:job.version,revision:0,conditions:offer},'PUT')).status,200);
 r=await api('/candidate/offer-compatibility',candidate.cookie,{resumeId:candidate.resumeId,jobId:job.id});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.contextRevision,job.version+1);
 assert.equal((await api('/candidate/offer-compatibility',other.cookie,{resumeId:candidate.resumeId,jobId:job.id})).status,404);
 await pool.query('UPDATE signal_candidate_resumes SET consent_matching=false,revision=revision+1 WHERE id=$1',[candidate.resumeId]);assert.equal((await api('/employer/offer-compatibility',owner.cookie,req)).status,404);
 assert.equal((await api('/candidate/offer-compatibility',candidate.cookie,{resumeId:candidate.resumeId,jobId:job.id})).status,200);
 await pool.query(`UPDATE signal_jobs SET status='archived',version=version+1 WHERE id=$1`,[job.id]);assert.equal((await api('/candidate/offer-compatibility',candidate.cookie,{resumeId:candidate.resumeId,jobId:job.id})).status,404);pass('candidate public-vacancy view, independent matching consent, immediate employer revocation and archived vacancy denial');
 const missing=compareMutualConditions(null,{...offer,workFormat:'Удалённо',specialization:'Backend / Python'},'');assert.ok(missing.factors.every(f=>f.state==='unknown'));
 writeFileSync('../compatibility-integration.json',JSON.stringify({status:'passed',synthetic:true,checks,at:new Date().toISOString()},null,2));
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
