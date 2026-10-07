import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { and, eq, inArray } from 'drizzle-orm';

const base = process.env.LOAD_API_ORIGIN || 'http://127.0.0.1:4310';
for (const url of [base, process.env.DATABASE_URL || '']) assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname), 'Load test is local only');
const { db, pool, signalUsersTable: users, signalCandidateProfilesTable: profiles, signalCompaniesTable: companies, signalNeedsTable: needs } = await import('../lib/db/src/index.ts');
const { hashPassword, ensureCandidateProfile, ensureEmployerCompany } = await import('../artifacts/api-server/src/lib/signal-auth.ts');
const run = promisify(execFile);
const id = randomUUID().slice(0,8), captured: number[] = [];
const output = 'outputs/verification'; await mkdir(output,{recursive:true});
const fixturePath = `${output}/load-fixtures-${id}.json`;
const fixture = { sessions:24, candidates:12, employers:12, specialization:'Backend / Python', grade:'Middle', requiredSkills:['Python','SQL'], warmupSeconds:10, measuredSeconds:60, thinkMs:100, timeoutMs:10000 };
const limits = { jsonP95Ms:1000, pdfP95Ms:2000, p99Ms:5000, errors:0, minRequestsPerRoute:20 };
const metrics: Record<string,{durations:number[];errors:number;statuses:Record<string,number>}> = {};
const samples: Array<Record<string,unknown>> = [];
type Session = { cookie:string; routes:Array<{label:string;path:string}> };
const sessions:Session[]=[];
let sampleTimer:ReturnType<typeof setInterval>|undefined, samplePromise:Promise<void>|undefined;
const started = new Date(); let imageId:string|null=null, dockerId:string|null=null;
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
 const candidateRows=await db.select({userId:profiles.userId,specialization:profiles.specialization,grade:profiles.verifiedGrade,score:profiles.verifiedScore,skills:profiles.verifiedSkills,consent:profiles.consentMatching,visibility:profiles.visibility,format:profiles.workFormat,salaryMin:profiles.salaryMin,salaryMax:profiles.salaryMax,salaryPeriod:profiles.salaryPeriod,salaryType:profiles.salaryType,latestAssessmentAt:profiles.latestAssessmentAt,fsp:profiles.hasFspHistory}).from(profiles).innerJoin(users,eq(users.id,profiles.userId)).where(eq(users.demoMode,false)).orderBy(profiles.userId);
 const needRows=await db.select({id:needs.id,grade:needs.grade,requiredSkills:needs.requiredSkills,desirableSkills:needs.desirableSkills,specialization:needs.specialization,salaryMin:needs.salaryMin,salaryMax:needs.salaryMax,salaryPeriod:needs.salaryPeriod,salaryType:needs.salaryType,workFormat:needs.workFormat}).from(needs).innerJoin(companies,eq(companies.id,needs.companyId)).where(inArray(companies.ownerUserId,captured)).orderBy(needs.id);
 return {nonDemoCandidateProfiles:candidateRows.length,visibleVerifiedCandidateProfiles:candidateRows.filter(row=>row.consent&&row.visibility!=='private'&&row.grade).length,loadOwnedNeeds:needRows.length,sha256:createHash('sha256').update(JSON.stringify({candidateRows,needRows})).digest('hex'),privacy:'Only counts and a digest are exported; no candidate IDs, names or contacts are exposed.'};
}
try {
 try { dockerId=(await run('docker',['compose','ps','-q','app'])).stdout.trim(); if(dockerId) imageId=(await run('docker',['inspect','--format','{{.Image}}',dockerId])).stdout.trim(); } catch {}
 assert.ok(dockerId&&imageId,'A running local Docker app and its image identity are required for CPU/RAM evidence');
 const bindings=JSON.parse((await run('docker',['inspect','--format','{{json .NetworkSettings.Ports}}',dockerId!])).stdout);
 const targetPort=new URL(base).port||'80';
 assert.ok(Object.values(bindings).flat().some((binding:any)=>binding?.HostPort===targetPort),'LOAD_API_ORIGIN must use the measured Docker app published port');
 const password=`Load-${randomUUID()}`, passwordHash=await hashPassword(password), candidates:number[]=[];
 for(let n=0;n<fixture.sessions;n++) {
  const role=n<fixture.candidates?'candidate':'employer';
  const [user]=await db.insert(users).values({email:`signal-load-${id}-${n}@example.test`,passwordHash,role,displayName:`Нагрузочная проверка ${id} ${n}`,emailVerified:true,demoMode:false}).returning(); captured.push(user!.id);
  await writeFile(fixturePath,JSON.stringify({id,createdUserIds:captured,cleanup:'pending'},null,2));
  if(role==='candidate') {await ensureCandidateProfile(user!); await db.update(profiles).set({professionalAlias:`Нагрузочный профиль ${id} ${n}`,specialization:fixture.specialization,verifiedGrade:'Middle',verifiedScore:100,verifiedSkills:['Python','SQL'],stack:['Python','SQL'],skills:['Python','SQL'],consentMatching:true,visibility:'pseudonymous',salaryMin:180000,salaryMax:250000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо',latestAssessmentAt:new Date()}).where(eq(profiles.userId,user!.id));candidates.push(user!.id);}
  else await ensureEmployerCompany(user!);
  const login=await request('/auth/login','','POST',{email:user!.email,password}); assert.equal(login.status,200,'Synthetic account login'); const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '); await login.arrayBuffer(); assert.ok(cookie);
  if(role==='candidate') sessions.push({cookie,routes:[{label:'profile',path:'/me/candidate-profile'},{label:'pdf',path:'/me/resume/pdf'},{label:'profile',path:'/me/candidate-profile'}]});
  else {
   const [company]=await db.select().from(companies).where(eq(companies.ownerUserId,user!.id));
   const [need]=await db.insert(needs).values({companyId:company!.id,title:`Нагрузка ${id} ${n}`,specialization:fixture.specialization,grade:'Middle',requiredSkills:fixture.requiredSkills,desirableSkills:[],description:'Синтетическая локальная нагрузочная проверка',workFormat:'Удалённо',salaryMin:180000,salaryMax:250000,salaryPeriod:'month',salaryType:'gross'}).returning();
   sessions.push({cookie,routes:[{label:'catalogue',path:'/employer/candidates'},{label:'matching',path:`/matches?needId=${need!.id}`},{label:'explanation',path:`/matches/explanation?needId=${need!.id}&candidateId=${candidates[n%12]}`},{label:'catalogue',path:'/employer/candidates'},{label:'matching',path:`/matches?needId=${need!.id}`}]});
  }
 }
 async function phase(seconds:number,record:boolean) {
  const end=performance.now()+seconds*1000;
  await Promise.all(sessions.map(async s=>{let n=0;while(performance.now()<end){const route=s.routes[n++%s.routes.length]!;const t=performance.now();let status='timeout';try{const r=await request(route.path,s.cookie);status=String(r.status);await r.arrayBuffer();}catch{status='network_error';}if(record){const item=metrics[route.label]??={durations:[],errors:0,statuses:{}};item.durations.push(performance.now()-t);item.statuses[status]=(item.statuses[status]||0)+1;if(status!=='200')item.errors++;}await delay(fixture.thinkMs);}}));
 }
 const machine={platform:os.platform(),release:os.release(),cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model,memoryBytes:os.totalmem(),node:process.version};
 const beforeDataset=await datasetSnapshot();
 await sample();
 assert.ok(samples.some(value=>typeof value.CPUPerc==='string'&&typeof value.MemUsage==='string'),'CPU/RAM telemetry must succeed before measurement');
 const preflight={recordedAt:new Date().toISOString(),apiOrigin:base,fixture,limits,imageId,machine,dataset:beforeDataset,scriptHash:createHash('sha256').update(await readFile('scripts/load-test.ts')).digest('hex'),fixtureHash:createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),firstTelemetry:samples[0],expectedRoutes:['catalogue','matching','explanation','profile','pdf']};
 const preflightPath=`${output}/load-preflight-${id}.json`;await writeFile(preflightPath,JSON.stringify(preflight,null,2));
 samples.length=0;
 await phase(fixture.warmupSeconds,false); await sample(); sampleTimer=setInterval(()=>void sample(),5000);
 const measureStart=performance.now(); await phase(fixture.measuredSeconds,true); const elapsed=(performance.now()-measureStart)/1000;clearInterval(sampleTimer);sampleTimer=undefined;await sample();
 const results=Object.fromEntries(Object.entries(metrics).map(([route,m])=>{const values=m.durations.sort((a,b)=>a-b);const p=(q:number)=>Math.round(values[Math.min(values.length-1,Math.ceil(values.length*q)-1)]!*100)/100;const p95=p(.95),p99=p(.99);return[route,{requests:values.length,errors:m.errors,statuses:m.statuses,p50Ms:p(.5),p95Ms:p95,p99Ms:p99,passed:values.length>=limits.minRequestsPerRoute&&m.errors===0&&p95<=(route==='pdf'?limits.pdfP95Ms:limits.jsonP95Ms)&&p99<=limits.p99Ms}];}));
 const total=Object.values(results).reduce((n,r)=>n+r.requests,0);
 const afterDataset=await datasetSnapshot(),datasetStable=beforeDataset.sha256===afterDataset.sha256;
 const successfulTelemetry=samples.filter(value=>typeof value.CPUPerc==='string'&&typeof value.MemUsage==='string').length;
 const finalImageId=(await run('docker',['inspect','--format','{{.Image}}',dockerId!])).stdout.trim();
 const report={startedAt:started.toISOString(),measuredAt:new Date().toISOString(),scope:'local synthetic load; not production capacity',preflightPath,preflight,fixture,limits,fixtureHash:preflight.fixtureHash,scriptHash:preflight.scriptHash,imageId,machine,dataset:beforeDataset,datasetStable,successfulTelemetry,telemetryComplete:successfulTelemetry>=2,imageStable:imageId===finalImageId,elapsedSeconds:elapsed,totalRequests:total,requestsPerSecond:total/elapsed,results,dockerSamples:samples,passed:Object.keys(results).length===5&&Object.values(results).every(r=>r.passed)&&datasetStable&&successfulTelemetry>=2&&imageId===finalImageId};
 await writeFile(`${output}/load-test-${id}.json`,JSON.stringify(report,null,2));await writeFile(`${output}/load-test.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,totalRequests:total,results},null,2)); if(!report.passed)process.exitCode=1;
} finally {
 if(sampleTimer)clearInterval(sampleTimer);
 if(samplePromise)await samplePromise;
 if(captured.length)await db.delete(users).where(inArray(users.id,captured));
 await writeFile(fixturePath,JSON.stringify({id,createdUserIds:captured,cleanup:'complete'},null,2));await pool.end();
}

