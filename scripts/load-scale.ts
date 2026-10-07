import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { and, eq, inArray } from 'drizzle-orm';

const base = process.env.LOAD_API_ORIGIN || 'http://127.0.0.1:4310';
for (const url of [base, process.env.DATABASE_URL || '']) assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname), 'Load test is local only');
const { db, pool, signalUsersTable: users, signalCandidateProfilesTable: profiles, signalCompaniesTable: companies, signalNeedsTable: needs, signalAssessmentAttemptsTable: attempts, signalAssessmentCorrectionsTable: corrections, signalAssessmentContextsTable: contexts, signalCandidateResumesTable: resumes, signalSessionsTable: sessionRows, signalJobsTable: jobs } = await import('../lib/db/src/index.ts');
const { assembleManagedAttempt, programSpecialization, verifiedSkillsForAttempt } = await import('../artifacts/api-server/src/lib/assessment-managed.ts');
const { scoreAttempt } = await import('../artifacts/api-server/src/lib/assessment-bank.ts');
const { snapshotForProfile } = await import('../artifacts/api-server/src/lib/assessment-context.ts');
const { hashPassword, ensureCandidateProfile, ensureEmployerCompany } = await import('../artifacts/api-server/src/lib/signal-auth.ts');
const run = promisify(execFile);
const id = randomUUID().slice(0,8), captured: number[] = [];
const output = 'outputs/verification'; await mkdir(output,{recursive:true});
const fixturePath = `outputs/local-backup/load-scale-fixtures-${id}.json`;
await mkdir('outputs/local-backup',{recursive:true});
const fixture = { version:'signal-load-scale-v1', seed:'signal-scale-2026-10-06-v1', sessions:32, candidates:1000, candidateSessions:16, employers:16, programs:['backend-python','frontend-typescript'], grades:['Junior','Middle','Senior'], warmupSeconds:30, measuredSeconds:180, thinkMs:100, timeoutMs:10000 };
const limits = { jsonP95Ms:1500, pdfP95Ms:2000, p99Ms:5000, errors:0, minRequestsPerRoute:50, maxAppMemoryBytes:1024*1024*1024, minimumValidTelemetrySamples:12 };
if(process.argv.includes('--fixture-check')){
 const groups:Record<string,number>={},versions=new Set<string>();
 for(let n=0;n<fixture.candidates;n++){
  const program=n%4===0||n%40===9?'frontend-typescript':'backend-python',grade=n%10===9?'Junior':n%10>=7?'Senior':'Middle',contextId=program==='backend-python'?'api-platform':'frontend-product';
  const form=assembleManagedAttempt(program,grade,`${fixture.seed}:${n}`,{contextId});const answers=form.cases.map((c,slot)=>({caseId:c.id,answer:n%2===0&&slot===(grade==='Senior'?2:4)?'intentional synthetic incorrect answer':form.oracles[c.id]!.answer}));
  const scored=scoreAttempt(form.cases,form.oracles,answers);assert.ok(scored.score>=83&&scored.criticalComplete);versions.add(form.oracles[form.cases[0]!.id]!.blueprint.version);
  const key=`${program}/${grade}`;groups[key]=(groups[key]||0)+1;
 }
 await pool.end();console.log(JSON.stringify({passed:true,scope:'pure generator preflight only; no HTTP/database load measured',profiles:fixture.candidates,groups,bankVersions:[...versions],fixtureHash:createHash('sha256').update(JSON.stringify(fixture)).digest('hex')},null,2));process.exit(0);
}
const metrics: Record<string,{durations:number[];errors:number;statuses:Record<string,number>}> = {};
const samples: Array<Record<string,unknown>> = [];
type Session = { cookie:string; routes:Array<{label:string;path:string}> };
const sessions:Session[]=[];
let sampleTimer:ReturnType<typeof setInterval>|undefined, samplePromise:Promise<void>|undefined;
const started = new Date(); let imageId:string|null=null, dockerId:string|null=null;
let finalReport:any;
async function request(path:string,cookie:string,method='GET',body?:unknown) {
 return fetch(`${base}/api${path}`,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(fixture.timeoutMs)});
}
function sample():Promise<void> {
 if(samplePromise)return samplePromise;
 if(!dockerId)return Promise.resolve();
 samplePromise=(async()=>{try { const {stdout}=await run('docker',['stats','--no-stream','--format','{{json .}}',dockerId!],{timeout:10000}); samples.push({at:new Date().toISOString(),...JSON.parse(stdout.trim())}); } catch { samples.push({at:new Date().toISOString(),unavailable:true}); }})().finally(()=>{samplePromise=undefined;});
 return samplePromise;
}
async function datasetSnapshot() {
 const candidateRows=await db.select({userId:profiles.userId,alias:profiles.professionalAlias,specialization:profiles.specialization,grade:profiles.verifiedGrade,score:profiles.verifiedScore,skills:profiles.verifiedSkills,consent:profiles.consentMatching,visibility:profiles.visibility,format:profiles.workFormat,salaryMin:profiles.salaryMin,salaryMax:profiles.salaryMax,salaryPeriod:profiles.salaryPeriod,salaryType:profiles.salaryType,latestAssessmentAt:profiles.latestAssessmentAt,fsp:profiles.hasFspHistory}).from(profiles).innerJoin(users,eq(users.id,profiles.userId)).where(eq(users.demoMode,false)).orderBy(profiles.userId);
 const needRows=await db.select({id:needs.id,grade:needs.grade,requiredSkills:needs.requiredSkills,desirableSkills:needs.desirableSkills,specialization:needs.specialization,salaryMin:needs.salaryMin,salaryMax:needs.salaryMax,salaryPeriod:needs.salaryPeriod,salaryType:needs.salaryType,workFormat:needs.workFormat}).from(needs).innerJoin(companies,eq(companies.id,needs.companyId)).where(inArray(companies.ownerUserId,captured)).orderBy(needs.id);
 const attemptRows=await db.select({id:attempts.id,userId:attempts.userId,program:attempts.programId,grade:attempts.grade,status:attempts.status,cases:attempts.cases,oracles:attempts.oracles,answers:attempts.answers,score:attempts.score,verified:attempts.verified,submittedAt:attempts.submittedAt}).from(attempts).innerJoin(users,eq(users.id,attempts.userId)).where(eq(users.demoMode,false)).orderBy(attempts.id);
 const correctionRows=await db.select({attemptId:corrections.attemptId,createdAt:corrections.createdAt}).from(corrections).innerJoin(attempts,eq(attempts.id,corrections.attemptId)).innerJoin(users,eq(users.id,attempts.userId)).where(eq(users.demoMode,false)).orderBy(corrections.attemptId);
 return {nonDemoCandidateProfiles:candidateRows.length,visibleVerifiedCandidateProfiles:candidateRows.filter(row=>row.consent&&row.visibility!=='private'&&row.grade).length,ordinaryAttempts:attemptRows.length,ordinaryCorrections:correctionRows.length,loadOwnedNeeds:needRows.length,sha256:createHash('sha256').update(JSON.stringify({candidateRows,needRows,attemptRows,correctionRows})).digest('hex'),privacy:'Only counts and a digest are exported; no candidate IDs, names, contacts, answers or oracle keys are exposed.'};
}
try {
 try { dockerId=(await run('docker',['compose','ps','-q','app'])).stdout.trim(); if(dockerId) imageId=(await run('docker',['inspect','--format','{{.Image}}',dockerId])).stdout.trim(); } catch {}
 assert.ok(dockerId&&imageId,'A running local Docker app and its image identity are required for CPU/RAM evidence');
 const bindings=JSON.parse((await run('docker',['inspect','--format','{{json .NetworkSettings.Ports}}',dockerId!])).stdout);
 const targetPort=new URL(base).port||'80';
 assert.ok(Object.values(bindings).flat().some((binding:any)=>binding?.HostPort===targetPort),'LOAD_API_ORIGIN must use the measured Docker app published port');
 const checkedSourceFiles=['artifacts/api-server/src/lib/signal-matching.ts','artifacts/api-server/src/lib/skill-evidence.ts','artifacts/api-server/src/lib/assessment-bank.ts','artifacts/api-server/src/lib/assessment-managed.ts','artifacts/api-server/src/routes/signal-employer-matching.ts'];
 const checkedSourceHashes=Object.fromEntries(await Promise.all(checkedSourceFiles.map(async file=>{const expected=createHash('sha256').update(await readFile(file)).digest('hex');const actual=(await run('docker',['exec',dockerId!,'sha256sum',`/app/${file}`])).stdout.trim().split(/\s+/)[0];assert.equal(actual,expected,`${file} differs between fixture generator and measured app image`);return[file,expected];})));
 const passwordHash=await hashPassword(`Unused-scale-password-${randomUUID()}`), candidates:Array<{id:number;program:'backend-python'|'frontend-typescript';grade:'Junior'|'Middle'|'Senior'}>=[];
 // Real relationships and immutable generated forms; oracle-produced answers are
 // explicit load-fixture construction, not independent validation or humans.
 const date=new Date('2026-10-05T20:00:00Z');
 for(let offset=0;offset<fixture.candidates;offset+=100){
  const batch=await db.insert(users).values(Array.from({length:Math.min(100,fixture.candidates-offset)},(_,k)=>({email:`signal-scale-${id}-${offset+k}@example.test`,passwordHash,role:'candidate' as const,displayName:`Synthetic scale ${id} ${offset+k}`,emailVerified:true,demoMode:false}))).returning();
  captured.push(...batch.map(u=>u.id));await writeFile(fixturePath,JSON.stringify({id,createdUserIds:captured,cleanup:'pending'},null,2));
  const profileRows: Array<typeof profiles.$inferInsert>=[], attemptRows:Array<typeof attempts.$inferInsert>=[], snapshots:any[]=[];
  batch.forEach((user,k)=>{
   const n=offset+k,program=n%4===0||n%40===9?'frontend-typescript':'backend-python',grade=n%10===9?'Junior':n%10>=7?'Senior':'Middle',contextId=program==='backend-python'?'api-platform':'frontend-product';
   const form=assembleManagedAttempt(program,grade,`${fixture.seed}:${n}`,{contextId});
   const answers=form.cases.map((c,slot)=>({caseId:c.id,answer:n%2===0&&slot===(grade==='Senior'?2:4)?'intentional synthetic incorrect answer':form.oracles[c.id]!.answer}));
   const result=scoreAttempt(form.cases,form.oracles,answers);assert.ok(result.score>=83&&result.criticalComplete);
   const verifiedSkills=verifiedSkillsForAttempt(form.cases,form.oracles,result.evidence);
   candidates.push({id:user.id,program,grade});
   profileRows.push({userId:user.id,professionalAlias:`Synthetic scale ${String(n).padStart(4,'0')}`,specialization:programSpecialization(program)!,assumedGrade:grade,verifiedGrade:grade,verifiedScore:result.score,verifiedSkills,stack:program==='backend-python'?['Python','SQL']:['TypeScript','Accessibility'],skills:verifiedSkills,yearsExperience:n%9,workFormat:n%5===0?'Гибрид':'Удалённо',salaryMin:160000+(n%7)*10000,salaryMax:240000+(n%7)*10000,salaryPeriod:'month',salaryType:'gross',consentMatching:true,visibility:'pseudonymous',latestAssessmentAt:date,verifiedGradeChangedAt:date,contactEmail:user.email});
   attemptRows.push({userId:user.id,programId:program,grade,status:'submitted',cases:form.cases,oracles:form.oracles,answers,score:result.score,verified:true,gradeChanged:true,startedAt:new Date(date.getTime()-20*60000),submittedAt:date,dueAt:new Date(date.getTime()+25*60000)});
   snapshots.push(snapshotForProfile(contextId,grade));
  });
  await db.insert(profiles).values(profileRows);const saved=await db.insert(attempts).values(attemptRows).returning({id:attempts.id,userId:attempts.userId});
  const contextByUser=new Map(attemptRows.map((row,k)=>[row.userId,snapshots[k]]));
  await db.insert(contexts).values(saved.map(row=>({attemptId:row.id,snapshot:contextByUser.get(row.userId)!})));
  await db.insert(resumes).values(batch.map(user=>({userId:user.id,summary:'Explicit synthetic load fixture with linked immutable assessment history; no human measurement.'})));
 }
 async function sessionCookie(userId:number){const token=randomBytes(32).toString('base64url');await db.insert(sessionRows).values({userId,tokenHash:createHash('sha256').update(token).digest('hex'),demoMode:false,expiresAt:new Date(Date.now()+3600000)});return `fsp_signal_session=${token}`;}
 for(const candidate of candidates.slice(0,fixture.candidateSessions)){sessions.push({cookie:await sessionCookie(candidate.id),routes:[{label:'profile',path:'/me/candidate-profile'},{label:'pdf',path:'/me/resume/pdf'},{label:'profile',path:'/me/candidate-profile'}]});}
 for(let n=0;n<fixture.employers;n++){
  const [user]=await db.insert(users).values({email:`signal-scale-${id}-employer-${n}@example.test`,passwordHash,role:'employer',displayName:`Synthetic scale employer ${n}`,emailVerified:true,demoMode:false}).returning();assert.ok(user);captured.push(user.id);await writeFile(fixturePath,JSON.stringify({id,createdUserIds:captured,cleanup:'pending'},null,2));await ensureEmployerCompany(user);
  const [company]=await db.select().from(companies).where(eq(companies.ownerUserId,user.id));assert.ok(company);
  const program=n%4===0?'frontend-typescript':'backend-python',grade=n%4===3?'Senior':'Middle',requiredSkills=program==='backend-python'?['Python','SQL']:['TypeScript','Accessibility'];
  const need={companyId:company.id,title:`Synthetic scale need ${n}`,specialization:programSpecialization(program)!,grade:grade as 'Middle'|'Senior',requiredSkills,desirableSkills:program==='backend-python'?['Architecture']:['Frontend state'],description:'Synthetic local scale verification',workFormat:'Удалённо',salaryMin:180000,salaryMax:280000,salaryPeriod:'month' as const,salaryType:'gross' as const};
  const [savedNeed]=await db.insert(needs).values(need).returning();assert.ok(savedNeed);
  await db.insert(jobs).values({...need,skills:requiredSkills,status:'published',publishedAt:date});
  const candidate=candidates.find(c=>c.program===program&&c.grade===grade)!;assert.ok(candidate);
  const cookie=await sessionCookie(user.id),matchPath=`/matches?needId=${savedNeed.id}`;
  const r=await request(matchPath,cookie);assert.equal(r.status,200);const matched:any=await r.json();assert.ok(Array.isArray(matched)&&matched.length>=100,`Need ${n} must have at least100 valid candidates`);
  sessions.push({cookie,routes:[{label:'catalogue',path:`/employer/candidates?specialization=${encodeURIComponent(need.specialization)}`},{label:'matching',path:matchPath},{label:'explanation',path:`/matches/explanation?needId=${savedNeed.id}&candidateId=${candidate.id}`},{label:'catalogue',path:'/employer/candidates'},{label:'matching',path:matchPath}]});
 }
 async function phase(seconds:number,record:boolean) {
  const end=performance.now()+seconds*1000;
  await Promise.all(sessions.map(async s=>{let n=0;while(performance.now()<end){const route=s.routes[n++%s.routes.length]!;const t=performance.now();let status='timeout';try{const r=await request(route.path,s.cookie);status=String(r.status);await r.arrayBuffer();}catch{status='network_error';}if(record){const item=metrics[route.label]??={durations:[],errors:0,statuses:{}};item.durations.push(performance.now()-t);item.statuses[status]=(item.statuses[status]||0)+1;if(status!=='200')item.errors++;}await delay(fixture.thinkMs);}}));
 }
 const machine={platform:os.platform(),release:os.release(),cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model,memoryBytes:os.totalmem(),node:process.version};
 const beforeDataset=await datasetSnapshot();
 await sample();
 assert.ok(samples.some(value=>typeof value.CPUPerc==='string'&&typeof value.MemUsage==='string'),'CPU/RAM telemetry must succeed before measurement');
 const preflight={recordedAt:new Date().toISOString(),apiOrigin:base,fixture,limits,imageId,machine,dataset:beforeDataset,checkedSourceHashes,scriptHash:createHash('sha256').update(await readFile('scripts/load-scale.ts')).digest('hex'),fixtureHash:createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),firstTelemetry:samples[0],expectedRoutes:['catalogue','matching','explanation','profile','pdf'],fixtureProvenance:'Team/AI constructed synthetic DB records and bank-oracle answers for load only; no participant or assessment-validity evidence'};
 const preflightPath=`${output}/load-scale-preflight-${id}.json`;await writeFile(preflightPath,JSON.stringify(preflight,null,2));
 samples.length=0;
 await phase(fixture.warmupSeconds,false); await sample(); sampleTimer=setInterval(()=>void sample(),5000);
 const measureStart=performance.now(); await phase(fixture.measuredSeconds,true); const elapsed=(performance.now()-measureStart)/1000;clearInterval(sampleTimer);sampleTimer=undefined;await sample();
 const results=Object.fromEntries(Object.entries(metrics).map(([route,m])=>{const values=m.durations.sort((a,b)=>a-b);const p=(q:number)=>Math.round(values[Math.min(values.length-1,Math.ceil(values.length*q)-1)]!*100)/100;const p95=p(.95),p99=p(.99);return[route,{requests:values.length,errors:m.errors,statuses:m.statuses,p50Ms:p(.5),p95Ms:p95,p99Ms:p99,passed:values.length>=limits.minRequestsPerRoute&&m.errors===0&&p95<=(route==='pdf'?limits.pdfP95Ms:limits.jsonP95Ms)&&p99<=limits.p99Ms}];}));
 const total=Object.values(results).reduce((n,r)=>n+r.requests,0);
 const afterDataset=await datasetSnapshot(),datasetStable=beforeDataset.sha256===afterDataset.sha256;
 const successfulTelemetry=samples.filter(value=>typeof value.CPUPerc==='string'&&typeof value.MemUsage==='string').length;
 const finalImageId=(await run('docker',['inspect','--format','{{.Image}}',dockerId!])).stdout.trim();
 const memoryBytes=(text:string)=>{const match=text.split('/')[0]!.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);assert.ok(match,'Docker memory usage must be parseable');const multiplier=({B:1,KiB:1024,MiB:1024**2,GiB:1024**3,kB:1000,MB:1000**2,GB:1000**3} as Record<string,number>)[match[2]!];assert.ok(multiplier,'Known Docker memory unit required');return Number(match[1])*multiplier;};
 const peakAppMemoryBytes=Math.max(...samples.filter(s=>typeof s.MemUsage==='string').map(s=>memoryBytes(String(s.MemUsage))));
 const report=finalReport={startedAt:started.toISOString(),measuredAt:new Date().toISOString(),scope:'1000 linked synthetic profiles on a local machine; not production capacity',preflightPath,preflight,fixture,limits,fixtureHash:preflight.fixtureHash,scriptHash:preflight.scriptHash,imageId,machine,dataset:beforeDataset,datasetStable,successfulTelemetry,telemetryComplete:successfulTelemetry>=limits.minimumValidTelemetrySamples,imageStable:imageId===finalImageId,elapsedSeconds:elapsed,totalRequests:total,requestsPerSecond:total/elapsed,results,dockerSamples:samples,peakAppMemoryBytes,memoryPassed:peakAppMemoryBytes<=limits.maxAppMemoryBytes,passed:Object.keys(results).length===5&&Object.values(results).every(r=>r.passed)&&datasetStable&&successfulTelemetry>=limits.minimumValidTelemetrySamples&&imageId===finalImageId&&peakAppMemoryBytes<=limits.maxAppMemoryBytes};
 await writeFile(`${output}/load-scale-${id}.json`,JSON.stringify(report,null,2));await writeFile(`${output}/load-scale.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,totalRequests:total,peakAppMemoryBytes,results},null,2)); if(!report.passed)process.exitCode=1;
} catch(error) {
 finalReport={...(finalReport||{}),startedAt:started.toISOString(),imageId,fixture,limits,scope:'local synthetic load',passed:false,failure:error instanceof Error?error.message:String(error)};process.exitCode=1;
} finally {
 if(sampleTimer)clearInterval(sampleTimer);
 if(samplePromise)await samplePromise;
 if(captured.length)await db.delete(users).where(inArray(users.id,captured));
 const remaining=captured.length?(await db.select({id:users.id}).from(users).where(inArray(users.id,captured))).length:0;assert.equal(remaining,0);
 await writeFile(fixturePath,JSON.stringify({id,createdUserIds:captured,cleanup:'complete'},null,2));
 if(finalReport){finalReport.cleanup='complete';finalReport.createdSyntheticUsers=captured.length;finalReport.remainingSyntheticUsers=remaining;await writeFile(`${output}/load-scale-${id}.json`,JSON.stringify(finalReport,null,2));await writeFile(`${output}/load-scale.json`,JSON.stringify(finalReport,null,2));}
 await pool.end();
}

