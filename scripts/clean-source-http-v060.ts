/** Fresh clean-stand smoke; never queries working/stage databases or reads oracle keys. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { assertLocalReviewerTarget } from "./reviewer-local-guards.ts";
const origin=process.env.API_ORIGIN??"", database=process.env.REVIEWER_DATABASE_NAME??"",mailOrigin=process.env.CLEAN_MAIL_ORIGIN??"";
assertLocalReviewerTarget(process.env.DATABASE_URL??"",origin,database,process.env);
assert.equal(process.env.SIGNAL_CLEAN_V060_ACCEPTANCE,"1");
assert.notEqual(process.env.SIGNAL_V060_COMPILED_ACCEPTANCE,"1");
assert.notEqual(process.env.SIGNAL_ISOLATED_STAGE_ACCEPTANCE,"1");
assert.notEqual(process.env.SIGNAL_ISOLATED_FRESH_ACCEPTANCE,"1");
assert.match(database,/^signal_clean_v060_[a-f0-9]{8}$/);
assert.equal(new URL(origin).port,"4334");assert.equal(new URL(process.env.DATABASE_URL!).port,"55441");assert.equal(mailOrigin,"http://127.0.0.1:8034");
const runId=randomUUID(), email=`clean-v060-${runId}@example.test`,password=randomBytes(24).toString("base64url");
const checks:{name:string;status:"PASS"}[]=[];let activeCheck="initialization",ordinaryId:number|null=null,ordinaryCleanup=false;
const report:any={schemaVersion:1,applicationVersion:"0.6.0",status:"FAIL",startedAt:new Date().toISOString(),checks,synthetic:true,oracleRead:false,realServerExam:true,externalMail:false,realPdf:false,ordinaryCleanup:false,reviewerProof:null};
async function step(name:string,action:()=>Promise<void>){activeCheck=name;await action();checks.push({name,status:"PASS"});}
async function request(path:string,method="GET",body?:unknown,cookie="") {
  const r=await fetch(`${origin}/api${path}`,{method,headers:{Cookie:cookie,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=r.headers.get("content-type")?.includes("json")?await r.json():null;
  return{status:r.status,data,response:r,cookie:r.headers.getSetCookie()[0]?.split(";")[0]??""};
}
function checkNoPrivate(value:unknown){if(!value||typeof value!=="object")return;for(const[key,item]of Object.entries(value)){assert.ok(!/^(oracles?|answerKey|correctAnswer|passwordHash|reviewScopeId)$/i.test(key));checkNoPrivate(item);}}
let ordinaryCookie="",candidateDemo:any,employerDemo:any;
try {
  await step("fresh ordinary registration keeps verification mandatory and ignores requested synthetic privileges",async()=> {
    const register=await request("/auth/register","POST",{email,password,role:"candidate",displayName:"Синтетическая чистая проверка",consentTerms:true,consentPrivacy:true,demoMode:true,reviewMode:true,reviewScopeId:randomUUID()});assert.equal(register.status,201);assert.equal("verificationCode" in register.data,false);assert.equal("demoVerificationCode" in register.data,false);
    assert.equal((await request("/auth/login","POST",{email,password})).status,403);
    let code:string|undefined;
    for(let retry=0;retry<6&&!code;retry++) {
      const mailbox=await(await fetch(`${mailOrigin}/api/v1/messages`,{signal:AbortSignal.timeout(10000)})).json() as any;
      const item=mailbox.messages?.find((m:any)=>m.To?.some((to:any)=>(to.Address??to.Email)===email));
      if(item){const message=await(await fetch(`${mailOrigin}/api/v1/message/${item.ID}`,{signal:AbortSignal.timeout(10000)})).json() as any;code=message.Text?.match(/\b\d{6}\b/)?.[0];}
      if(!code)await new Promise(resolve=>setTimeout(resolve,500));
    }
    assert.ok(code,"local mailbox verification delivery missing");
    const verified=await request("/auth/verify-email","POST",{email,code});assert.equal(verified.status,200);ordinaryId=verified.data.user.id;ordinaryCookie=verified.cookie;assert.ok(ordinaryCookie);
    assert.equal(verified.data.user.demoMode,false);assert.equal(verified.data.user.reviewMode,false);checkNoPrivate(verified.data);
    assert.equal((await request("/auth/verify-email","POST",{email,code})).status,400);
  });
  await step("new ordinary profile has no grade; mandatory purpose and questionnaire gates are active",async()=> {
    const profile=await request("/me/resumes","GET",undefined,ordinaryCookie);assert.equal(profile.status,200);assert.equal(profile.data.count,1);const resume=profile.data.resumes[0];assert.equal(resume.verifiedGrade,null);
    const body={programId:"backend-python",grade:"Junior",resumeId:resume.id};
    assert.equal((await request("/assessments/attempts","POST",body,ordinaryCookie)).status,400);
    assert.equal((await request("/assessments/attempts","POST",{...body,purpose:"signal_qualification",gradeConfirmed:true},ordinaryCookie)).status,409);
    assert.equal((await request("/assessments/attempts","POST",{...body,purpose:"signal_qualification",gradeConfirmed:true,demoMode:true},ordinaryCookie)).status,400);
  });
  await step("common Demo remains overview and exposes genuine owned resume PDF",async()=> {
    candidateDemo=await request("/auth/demo-session","POST",{role:"candidate"});employerDemo=await request("/auth/demo-session","POST",{role:"employer"});assert.equal(candidateDemo.status,200);assert.equal(employerDemo.status,200);assert.equal(candidateDemo.data.user.reviewMode,false);
    const resume=await request("/me/resumes","GET",undefined,candidateDemo.cookie);assert.equal(resume.status,200);assert.equal(resume.data.count,1);
    const pdf=await fetch(`${origin}/api/me/resumes/${resume.data.resumes[0].id}/pdf`,{headers:{Cookie:candidateDemo.cookie},signal:AbortSignal.timeout(20000)});assert.equal(pdf.status,200);assert.match(pdf.headers.get("content-type")??"",/application\/pdf/);const bytes=Buffer.from(await pdf.arrayBuffer());assert.ok(bytes.length>1000);assert.equal(bytes.subarray(0,5).toString("ascii"),"%PDF-");assert.match(bytes.subarray(-100).toString("ascii"),/%%EOF/);assert.equal(pdf.headers.get("x-signal-resume-id"),String(resume.data.resumes[0].id));report.realPdf=true;report.pdf={bytes:bytes.length,signature:true,eof:true,ownedResumeHeader:true};
  });
  await step("five compatible copies preserve deduplicated catalogue and matching identities",async()=> {
    const beforeCatalog=await request("/employer/candidates","GET",undefined,employerDemo.cookie);assert.equal(beforeCatalog.status,200);checkNoPrivate(beforeCatalog.data);
    const needs=await request("/employer/needs","GET",undefined,employerDemo.cookie);assert.equal(needs.status,200);assert.ok(needs.data.length);
    const beforeMatches=await request(`/matches?needId=${needs.data[0].id}`,"GET",undefined,employerDemo.cookie);assert.equal(beforeMatches.status,200);assert.ok(beforeMatches.data.length);checkNoPrivate(beforeMatches.data);
    const initial=await request("/me/resumes","GET",undefined,candidateDemo.cookie),resumeId=initial.data.resumes[0].id;
    for(let index=0;index<4;index++) {const copy=await request(`/me/resumes/${resumeId}/copy`,"POST",{title:`Проверочная копия ${index+1}`},candidateDemo.cookie);assert.equal(copy.status,201);assert.equal(copy.data.visibility,"private");assert.equal(copy.data.consentCatalog,false);assert.equal(copy.data.verifiedGrade,initial.data.resumes[0].verifiedGrade);}
    assert.equal((await request("/me/resumes","GET",undefined,candidateDemo.cookie)).data.count,5);
    assert.equal((await request(`/me/resumes/${resumeId}/copy`,"POST",{title:"Шестая копия"},candidateDemo.cookie)).status,409);
    const afterCatalog=await request("/employer/candidates","GET",undefined,employerDemo.cookie),afterMatches=await request(`/matches?needId=${needs.data[0].id}`,"GET",undefined,employerDemo.cookie);
    assert.equal(afterCatalog.data.total,beforeCatalog.data.total);assert.deepEqual(afterCatalog.data.candidates.map((c:any)=>c.candidateId),beforeCatalog.data.candidates.map((c:any)=>c.candidateId));assert.equal(new Set(afterCatalog.data.candidates.map((c:any)=>c.candidateId)).size,afterCatalog.data.candidates.length);
    assert.deepEqual(afterMatches.data.map((c:any)=>c.candidateId),beforeMatches.data.map((c:any)=>c.candidateId));
    const first=afterMatches.data[0], explanation=await request(`/matches/explanation?needId=${needs.data[0].id}&candidateId=${first.candidateId}&resumeId=${first.resumeId}`,"GET",undefined,employerDemo.cookie);assert.equal(explanation.status,200);assert.equal(explanation.data.ranking.position,first.ranking.position);assert.equal(explanation.data.rankingScore,first.rankingScore);checkNoPrivate(explanation.data);
  });
  await step("two independent reviewer pairs take ordinary server exams and exact cleanup",async()=> {
    const probe=spawnSync(process.execPath,["--import","tsx","scripts/reviewer-http-integration.ts"],{cwd:process.cwd(),env:{...process.env,SIGNAL_REVIEWER_HTTP_PROBE:"true"},encoding:"utf8"});assert.equal(probe.status,0,"reviewer clean-stand probe failed (private output suppressed)");
    const lines=probe.stdout.trim().split(/\r?\n/),summary=JSON.parse(lines.at(-1)??"{}");
    assert.match(summary.proof??"",/^outputs\/release-0\.6\.0\/reviewer-http-clean-[a-f0-9-]{36}\.json$/);
    const bytes=await readFile(summary.proof),proof=JSON.parse(bytes.toString("utf8"));
    assert.equal(proof.apiOrigin,origin);assert.equal(proof.status,"PASS");assert.equal(proof.cleanup,true);assert.equal(proof.oracleRead,false);assert.equal(proof.checks.length,13);
    report.reviewerProof={status:proof.status,groups:proof.checks.length,cleanup:proof.cleanup,path:summary.proof,sha256:createHash("sha256").update(bytes).digest("hex")};
  });
  report.status="PASS";
} catch {report.failedAt=activeCheck;report.failure="Clean HTTP acceptance failed; private values and response text suppressed.";}
finally {
  const {db,pool,signalUsersTable:users}=await import("../lib/db/src/index.ts");const{and,eq,isNull}=await import("../lib/db/node_modules/drizzle-orm/index.js");
  try{
    const found=await db.select({id:users.id,demo:users.demoMode,scope:users.reviewScopeId}).from(users).where(eq(users.email,email));
    if(found.length===1&&found[0]!.demo===false&&found[0]!.scope===null){const removed=await db.delete(users).where(and(eq(users.id,found[0]!.id),eq(users.email,email),eq(users.demoMode,false),isNull(users.reviewScopeId))).returning({id:users.id});ordinaryCleanup=removed.length===1;}
    else if(!found.length)ordinaryCleanup=true;
    report.ordinaryCleanup=ordinaryCleanup;if(!ordinaryCleanup)report.status="FAIL";
  }catch{report.status="FAIL";report.ordinaryCleanup=false;}finally{await pool.end();}
  report.finishedAt=new Date().toISOString();await mkdir("outputs/release-0.6.0",{recursive:true});await writeFile("outputs/release-0.6.0/clean-http.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({status:report.status,groups:checks.length,ordinaryCleanup:report.ordinaryCleanup,reviewerCleanup:report.reviewerProof?.cleanup??false}));if(report.status!=="PASS")process.exitCode=1;
}
