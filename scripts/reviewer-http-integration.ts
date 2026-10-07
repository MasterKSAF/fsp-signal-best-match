/** Short isolated HTTP proof. Creates its own blank pairs; never uses or exports answer keys. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { assertLocalReviewerTarget } from "./reviewer-local-guards.ts";
import { captureV060CompiledTarget } from "./lib/compiled-v060-acceptance";
import { captureCleanV060Target } from "./lib/clean-v060-target";
const origin=process.env.API_ORIGIN??"", database=process.env.REVIEWER_DATABASE_NAME??"";
const compiledTarget=captureV060CompiledTarget(process.env,origin,process.env.PUBLIC_URL??origin);
const cleanTarget=captureCleanV060Target(process.env,origin,database);
assertLocalReviewerTarget(process.env.DATABASE_URL??"",origin,database,process.env);
if(process.env.SIGNAL_REVIEWER_HTTP_PROBE!=="true") throw new Error("Dedicated reviewer HTTP probe authorization flag required");
const runId=randomUUID(),privateFile=resolve(homedir(),".signal-reviewer-private",`http-${runId}.json`);
const output=cleanTarget?`outputs/release-0.6.0/reviewer-http-clean-${runId}.json`:compiledTarget?`outputs/verification/release-0.6.0/reviewer-http-compiled-${runId}.json`:"outputs/verification/reviewer-http-2026-10-06.json";
const checks:{name:string;status:"PASS"}[]=[];
const responses:{method:string;path:string;status:number}[]=[];
let activeCheck="provision and login";
const report:any={status:"FAIL",startedAt:new Date().toISOString(),apiOrigin:origin,checks,responses,synthetic:true,serverExam:true,oracleRead:false,desiredGradeInjected:false,privateCredentialsExported:false,ordinaryCooldownBypass:false,cleanup:false,scope:"Two fresh independent reviewer pairs; fixed incorrect text tests genuine server scoring, not human exam validity or passed qualification.",...(compiledTarget?{compiledTarget}:{})};
let provisioned=false;
function provision(mode:"create"|"remove") {
  const child=spawnSync(process.execPath,["--import","tsx","scripts/provision-reviewers.ts","--mode",mode,"--origin",origin,"--database",database,"--private-file",privateFile],{cwd:process.cwd(),env:process.env,encoding:"utf8"});
  assert.equal(child.status,0,`controlled reviewer ${mode} failed (private details suppressed)`);
}
async function check(name:string,action:()=>Promise<void>) {activeCheck=name;await action();checks.push({name,status:"PASS"});}
async function request(cookie:string,path:string,method="GET",body?:unknown) {
  const response=await fetch(`${origin}/api${path}`,{method,headers:{Cookie:cookie,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=response.headers.get("content-type")?.includes("json")?await response.json():null;
  responses.push({method,path,status:response.status});
  return {status:response.status,data,cookie:response.headers.getSetCookie()[0]?.split(";")[0]??""};
}
function noSecrets(data:unknown) {
  const scan=(value:any):void=> {if(!value||typeof value!=="object")return;for(const [key,item]of Object.entries(value)){assert.ok(!/^(oracles?|correctAnswer|answerKey|passwordHash)$/i.test(key),"private exam/account field leaked");scan(item);}};
  scan(data);
}
try {
  provision("create");provisioned=true;
  const manifest=JSON.parse(await readFile(privateFile,"utf8"));
  const candidates=manifest.accounts.filter((a:any)=>a.role==="candidate"),employers=manifest.accounts.filter((a:any)=>a.role==="employer");
  async function login(account:any) {const r=await request("","/auth/login","POST",{email:account.email,password:account.password});assert.equal(r.status,200);assert.ok(r.cookie);assert.equal(r.data.user.reviewMode,true);assert.equal(r.data.user.demoMode,true);assert.equal("reviewScopeId" in r.data.user,false);return r.cookie;}
  let ca=await login(candidates[0]),cb=await login(candidates[1]);const ea=await login(employers[0]),eb=await login(employers[1]);
  await check("four unique identities and exactly two pair scopes",async()=> {assert.equal(new Set(manifest.accounts.map((a:any)=>a.id)).size,4);assert.equal(new Set(manifest.accounts.map((a:any)=>a.reviewScopeId)).size,2);assert.equal(candidates[0].reviewScopeId,employers[0].reviewScopeId);assert.notEqual(candidates[0].reviewScopeId,candidates[1].reviewScopeId);});
  const start=(candidate:any)=>({purpose:"signal_qualification",gradeConfirmed:true,programId:"backend-python",grade:"Junior",resumeId:candidate.resumeId});
  await check("reviewer cannot skip questionnaire; spoofed flags do not enable overview shortcut",async()=> {
    assert.equal((await request(ca,"/assessments/attempts","POST",start(candidates[0]))).status,409);
    assert.equal((await request(ca,"/assessments/attempts","POST",{...start(candidates[0]),demoMode:true,reviewMode:false})).status,400);
  });
  await check("blank profiles have no seeded qualification or exam and foreign resume is denied",async()=> {
    for(const [cookie,account]of [[ca,candidates[0]],[cb,candidates[1]]] as const){const r=await request(cookie,`/me/resumes/${account.resumeId}`);assert.equal(r.status,200);assert.equal(r.data.qualification.verifiedGrade,null);assert.equal(r.data.visibility,"private");assert.equal((await request(cookie,"/assessments/history")).data.attempts.length,0);noSecrets(r.data);}
    assert.equal((await request(cb,`/me/resumes/${candidates[0].resumeId}`)).status,404);
  });
  await check("each reviewer saves an independent questionnaire through ordinary API",async()=> {
    for(const [cookie,account]of [[ca,candidates[0]],[cb,candidates[1]]] as const) {
      const content={summary:"",softSkills:[],experience:[],projects:[],education:[],portfolio:[],questionnaire:{version:"backend-python-v1",industry:"Информационные технологии",specialization:"Backend / Python",answers:{python:0,databases:0,api:0,testing:0,reliability:0,ownership:0}}};
      assert.equal((await request(cookie,`/me/resumes/${account.resumeId}`,"PUT",content)).status,200);
      assert.equal((await request(cookie,`/me/resumes/${account.resumeId}`,"PATCH",{visibility:"pseudonymous",consentCatalog:true})).status,200);
    }
  });
  await check("company A and B each see only their pair candidate; common Demo cannot see either",async()=> {
    for(const [cookie,account]of [[ea,candidates[0]],[eb,candidates[1]]] as const){const r=await request(cookie,"/employer/candidates");assert.equal(r.status,200);assert.equal(r.data.total,1);assert.deepEqual(r.data.candidates.map((x:any)=>x.candidateId),[account.id]);noSecrets(r.data);}
    const demo=await request("","/auth/demo-session","POST",{role:"employer"});assert.equal(demo.status,200);const catalogue=await request(demo.cookie,"/employer/candidates");assert.equal(catalogue.status,200);assert.equal(catalogue.data.candidates.some((x:any)=>candidates.some((a:any)=>a.id===x.candidateId)),false);
    assert.equal((await request(ea,`/employer/candidates/${candidates[1].resumeId}`)).status,404);
  });
  await check("published job, company trust actions and microtask authoring remain inside each pair",async()=> {
    const jobBody={title:"Вакансия изолированной компании",description:"Синтетическая вакансия для проверки разграничения доступа между независимыми компаниями.",specialization:"Backend / Python",grade:"Junior",skills:["Python"],workFormat:"Удалённо",salaryMin:50000,salaryMax:90000,salaryPeriod:"month",salaryType:"gross"};
    const job=await request(ea,"/employer/jobs","POST",jobBody);assert.equal(job.status,201);
    assert.equal((await request(ea,`/employer/jobs/${job.data.id}/status`,"POST",{status:"published"})).status,200);
    assert.equal((await request(ca,`/public/jobs/${job.data.id}`)).status,200);
    assert.equal((await request(cb,`/public/jobs/${job.data.id}`)).status,404);
    assert.equal((await request("",`/public/jobs/${job.data.id}`)).status,404);
    assert.equal((await request(eb,`/employer/jobs/${job.data.id}`,"PUT",jobBody)).status,404);
    assert.equal((await request(cb,`/me/companies/${employers[0].companyId}/block`,"PUT",{blocked:true})).status,404);
    assert.equal((await request(cb,"/me/complaints","POST",{objectType:"job",objectId:job.data.id,category:"other",explanation:"",idempotencyKey:`probe_${runId.replaceAll("-","")}`})).status,404);
    const microBody={title:"Учебная проверка API",specialization:"Backend / Python",competency:"Python",scenario:"Разберите изолированную учебную ситуацию без производственного применения. Объясните выбранный контракт API.",expectedMinutes:5,intervalDays:7,deadlineDays:1,educationalOnly:true,rubric:[{id:"reasoning",label:"Объяснение решения",maxPoints:1}]};
    const micro=await request(ea,"/employer/microtasks","POST",microBody);assert.equal(micro.status,201);
    assert.equal((await request(eb,`/employer/microtasks/${micro.data.id}`,"PUT",microBody)).status,404);
    assert.equal((await request(ca,"/me/trust-status")).data.moderator,false);
    assert.equal((await request(ca,"/moderation/queue")).status,403);
  });
  const aa=await request(ca,"/assessments/attempts","POST",start(candidates[0])),ab=await request(cb,"/assessments/attempts","POST",start(candidates[1]));
  await check("two genuine server attempts have distinct owners and contain no answer keys",async()=> {assert.equal(aa.status,201);assert.equal(ab.status,201);assert.notEqual(aa.data.id,ab.data.id);assert.equal(aa.data.purpose,"signal_qualification");assert.ok(aa.data.cases.length>=6);noSecrets(aa.data);noSecrets(ab.data);});
  const answer={caseId:aa.data.cases[0].id,answer:"Не знаю ответ. Это синтетическая проверка сохранения, а не решение задания."};
  await check("foreign attempt read/save/submit cannot affect the owner",async()=> {
    assert.equal((await request(cb,`/assessments/attempts/${aa.data.id}`)).status,404);
    assert.equal((await request(cb,`/assessments/attempts/${aa.data.id}/answers`,"PUT",{answers:[answer]})).status,404);
    assert.equal((await request(cb,`/assessments/attempts/${aa.data.id}/submit`,"POST",{})).status,404);
  });
  await check("saved answer survives logout/relogin and does not appear in reviewer B state",async()=> {
    assert.equal((await request(ca,`/assessments/attempts/${aa.data.id}/answers`,"PUT",{answers:[answer]})).status,200);
    assert.equal((await request(ca,"/auth/logout","POST")).status,200);ca=await login(candidates[0]);cb=await login(candidates[1]);
    assert.equal((await request(ca,`/assessments/attempts/${aa.data.id}`)).data.cases[0].savedAnswer,answer.answer);
    assert.equal((await request(cb,`/assessments/attempts/${ab.data.id}`)).data.cases.some((x:any)=>x.savedAnswer),false);
    assert.equal((await request(ca,"/assessments/attempts","POST",start(candidates[0]))).data.id,aa.data.id);
  });
  let submission:any;
  await check("server evaluates deliberately incorrect text; no automatic pass or grade award",async()=> {
    submission=await request(ca,`/assessments/attempts/${aa.data.id}/submit`,"POST",{});assert.equal(submission.status,200);assert.equal(submission.data.verified,false);assert.equal(submission.data.gradeChanged,false);noSecrets(submission.data);
    assert.equal((await request(ca,`/me/resumes/${candidates[0].resumeId}`)).data.qualification.verifiedGrade,null);
  });
  await check("ordinary repeat delay survives reviewer login, copy and spoofed purpose",async()=> {
    ca=await login(candidates[0]);assert.equal((await request(ca,"/assessments/attempts","POST",start(candidates[0]))).status,409);
    const copy=await request(ca,`/me/resumes/${candidates[0].resumeId}/copy`,"POST",{title:"Копия проверяющего"});assert.equal(copy.status,201);
    assert.equal((await request(ca,"/assessments/attempts","POST",{...start(candidates[0]),resumeId:copy.data.id})).status,409);
    assert.equal((await request(ca,`/assessments/attempts/${aa.data.id}/submit`,"POST",{purpose:"company_task",verified:true,score:100})).status,400);
  });
  await check("repeated submit preserves server result; reviewer B remains in progress",async()=> {
    const twice=await request(ca,`/assessments/attempts/${aa.data.id}/submit`,"POST",{});assert.equal(twice.status,200);assert.deepEqual(twice.data,submission.data);
    assert.equal((await request(cb,`/assessments/attempts/${ab.data.id}`)).data.status,"in_progress");
  });
  await check("server scope change invalidates existing session rather than moving it to another reviewer pool",async()=> {
    const {db,pool,signalUsersTable:users}=await import("../lib/db/src/index.ts");
    const {and,eq}=await import("../lib/db/node_modules/drizzle-orm/index.js");
    try {
      await db.update(users).set({reviewScopeId:candidates[1].reviewScopeId}).where(and(eq(users.id,candidates[0].id),eq(users.reviewScopeId,candidates[0].reviewScopeId)));
      assert.equal((await request(ca,"/me")).status,401);
    } finally {
      await db.update(users).set({reviewScopeId:candidates[0].reviewScopeId}).where(eq(users.id,candidates[0].id));await pool.end();
    }
    ca=await login(candidates[0]);assert.equal((await request(ca,`/assessments/attempts/${aa.data.id}`)).data.status,"submitted");
  });
  if(compiledTarget)assert.deepEqual(captureV060CompiledTarget(process.env,origin,process.env.PUBLIC_URL??origin),compiledTarget,"Normal bundle changed during reviewer acceptance");
  report.status="PASS";
} catch {
  report.failure="Reviewer HTTP acceptance failed; sensitive response and credential values suppressed.";
  report.failedAt=activeCheck;
} finally {
  if(provisioned)try{provision("remove");report.cleanup=true;report.cleanedOwnedAccounts=4;}catch{report.cleanup=false;report.status="FAIL";report.failure="Exact reviewer cleanup failed; private manifest retained for controlled retry.";}
  report.finishedAt=new Date().toISOString();
  report.sourceHashes=Object.fromEntries(await Promise.all(["scripts/reviewer-http-integration.ts","scripts/provision-reviewers.ts","artifacts/api-server/src/lib/signal-auth.ts","artifacts/api-server/src/lib/signal-pool-scope.ts","artifacts/api-server/src/routes/signal-auth.ts","artifacts/api-server/src/routes/signal-profile-assessments.ts","lib/db/migrations/0007_reviewer_scope.sql"].map(async p=>[p,createHash("sha256").update(await readFile(p)).digest("hex")])));
  await mkdir(dirname(output),{recursive:true});
  try{const prior=await readFile(output);await mkdir("outputs/verification/history",{recursive:true});await writeFile(`outputs/verification/history/reviewer-http-${createHash("sha256").update(prior).digest("hex").slice(0,12)}.json`,prior,{flag:"wx"});}catch(error:any){if(!["ENOENT","EEXIST"].includes(error.code))throw error;}
  await writeFile(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({status:report.status,checks:checks.length,cleanup:report.cleanup,proof:output}));
  if(report.status!=="PASS")process.exitCode=1;
}
