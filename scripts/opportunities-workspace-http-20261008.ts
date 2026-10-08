/** Owned ordinary accounts, real HTTP filters/files, 250 scoped temporary publications. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalCompaniesTable as companies, signalJobsTable as jobs,
  signalApplicationsTable as applications, signalJobRequirementsTable as requirements } from '@workspace/db';
const require = createRequire(new URL('../artifacts/api-server/package.json',import.meta.url)), ExcelJS = require('exceljs');
const origin='http://127.0.0.1:4367', output='outputs/verification/candidate-workspace-skill-matrix-20261008/opportunities';
const manifest=JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-independent-ordinary-89221097.json','utf8'));
const database=new URL(process.env.DATABASE_URL || '').pathname.slice(1);
assert.equal(database,'signal_independent_fixes_20261007');assert.equal(manifest.database,database);assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED,'true');
const prefix=`qa-opportunities-${randomUUID().slice(0,8)}`, report:any={synthetic:true,origin,database,prefix,checks:[],files:[],fixtureJobs:250};
const ids:number[]=[];
async function check(name:string, run:()=>Promise<void>) { await run();report.checks.push({name,status:'PASS'}); }
async function request(path:string,init:RequestInit={},cookie?:string) {const response=await fetch(origin+path,{...init,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...init.headers}});return response;}
async function json(path:string,cookie?:string,init:RequestInit={}) {const response=await request(path,init,cookie);const data=await response.json();assert.ok(response.ok,`${path}: ${response.status} ${data.error||''}`);return data;}
async function login(account:any) {const response=await request('/api/auth/login',{method:'POST',body:JSON.stringify({email:account.email,password:account.password})});assert.equal(response.status,200);const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie);return cookie;}
try {
  await mkdir(output,{recursive:true});
  const employer=manifest.accounts.find((account:any)=>account.name==='employer-a'),candidate=manifest.accounts.find((account:any)=>account.role==='candidate');assert.ok(employer&&candidate);
  const [owner]=await db.select({user:users,company:companies}).from(users).innerJoin(companies,eq(companies.ownerUserId,users.id)).where(eq(users.id,employer.id));
  assert.equal(owner.user.email,employer.email);assert.equal(owner.user.demoMode,false);assert.equal(owner.user.reviewScopeId,null);assert.equal(owner.company.id,employer.companyId);
  const employerCookie=await login(employer),candidateCookie=await login(candidate);
  await check('real employer create stores explicit levels and location; omitted levels stay unlevelled',async()=>{
    const body={title:`${prefix} HTTP`,description:'Разработка интерфейса с доступными формами, контролем состояния и ясными контрактами.',specialization:'Frontend / TypeScript',grade:'Junior',skills:['React','TypeScript'],skillRequirements:[{skill:'React',level:'Middle'},{skill:'TypeScript'}],location:'Казань',workFormat:'Гибрид',salaryMin:120000,salaryMax:180000,salaryPeriod:'month',salaryType:'net'};
    const created=await json('/api/employer/jobs',employerCookie,{method:'POST',body:JSON.stringify(body)});ids.push(created.id);assert.deepEqual(created.skillRequirements,body.skillRequirements);assert.equal(created.location,'Казань');
    const {skillRequirements,location,...legacy}=body;await json(`/api/employer/jobs/${created.id}`,employerCookie,{method:'PUT',body:JSON.stringify(legacy)});
    const listed=await json('/api/employer/jobs',employerCookie);assert.deepEqual(listed.find((job:any)=>job.id===created.id).skillRequirements,body.skillRequirements);
  });
  const created=await db.insert(jobs).values(Array.from({length:250},(_,index)=>({ companyId:owner.company.id,title:`${index===0?'=SUM(1,2) ':''}${prefix} Разработчик ${String(index).padStart(3,'0')}`,description:`Синтетическая публикация для проверки фильтра и экспорта. ${prefix}`,specialization:'Frontend / TypeScript',grade:'Middle',skills:['React','TypeScript'],workFormat:index%2?'Гибрид':'Удалённо',salaryMin:100000+index*1000,salaryMax:140000+index*1000,salaryPeriod:'month' as const,salaryType:'net' as const,status:'published' as const,publishedAt:new Date(Date.UTC(2026,9,8,10,0,index===1?0:index))}))).returning({id:jobs.id});
  const fixtureIds=created.map(row=>row.id);ids.push(...fixtureIds);
  await db.insert(requirements).values(fixtureIds.map((id,index)=>({jobId:id,location:'Казань',skillRequirements:[{skill:'React',level:'Middle' as const},{skill:'TypeScript',level:index%3===0?'Middle' as const:'Junior' as const}]})));
  const query=new URLSearchParams({q:prefix,location:'Казань',sort:'salary_desc',skills:JSON.stringify([{skill:'React',level:'Middle'}]),pageSize:'100'});
  let all:any[]=[];
  await check('server filters and stable pagination cover 250 results beyond old first 200',async()=>{
    for(let page=1;page<=3;page++){const response=await json(`/api/public/jobs/search?${query}&page=${page}`,candidateCookie);assert.equal(response.total,250);assert.equal(response.pageCount,3);all.push(...response.items);}
    assert.equal(all.length,250);assert.equal(new Set(all.map(job=>job.id)).size,250);assert.equal(all[0].id,fixtureIds[249]);assert.equal(all[249].id,fixtureIds[0]);
    // Repeated query values are invalid rather than silently changing the filter.
    const repeated=await request(`/api/public/jobs/search?${query}&skills=${encodeURIComponent(JSON.stringify([{skill:'React',level:'Senior'}]))}`,{},candidateCookie);
    assert.equal(repeated.status,400);
  });
  const stronger=new URLSearchParams(query);stronger.set('skills',JSON.stringify([{skill:'React',level:'Senior'}]));
  await check('explicit unavailable requirement level and exact skill names do not fallback',async()=>{
    assert.equal((await json(`/api/public/jobs/search?${stronger}`,candidateCookie)).total,0);
    stronger.set('skills',JSON.stringify([{skill:'PostgreSQL'}]));assert.equal((await json(`/api/public/jobs/search?${stronger}`,candidateCookie)).total,0);
  });
  await check('publication date sorting uses stable IDs when two timestamps are equal',async()=>{
    const chronological=new URLSearchParams(query);chronological.set('sort','oldest');const response=await json(`/api/public/jobs/search?${chronological}`,candidateCookie);
    assert.equal(response.items[0].id,fixtureIds[0]);assert.equal(response.items[1].id,fixtureIds[1]);
  });
  await check('CSV exports all 250 filtered rows with same order and formula-safe Cyrillic cells',async()=>{
    const response=await request(`/api/public/jobs/export?${query}&format=csv`,{},candidateCookie);assert.equal(response.status,200);assert.equal(response.headers.get('X-Export-Row-Count'),'250');
    const bytes=Buffer.from(await response.arrayBuffer());const text=bytes.toString('utf8');assert.equal(bytes[0],239);assert.ok(text.includes('Казань'));assert.ok(text.includes('React — Middle'));assert.ok(text.includes("'=SUM(1,2)"));
    const lines=text.trimEnd().split('\r\n');assert.equal(lines.length,251);assert.ok(lines[1].includes(all[0].title));assert.ok(lines[250].includes(all[249].title));
    await writeFile(`${output}/jobs-250.csv`,bytes);report.files.push('jobs-250.csv');
  });
  await check('XLSX opens as a real workbook with 250 rows, no formula objects, matching order',async()=>{
    const response=await request(`/api/public/jobs/export?${query}&format=xlsx`,{},candidateCookie);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);const sheet=workbook.worksheets[0];assert.equal(sheet.rowCount,251);assert.equal(sheet.getRow(2).getCell(2).value,all[0].title);assert.equal(sheet.getRow(251).getCell(2).value,all[249].title);
    sheet.eachRow((row:any)=>row.eachCell((cell:any)=>assert.equal(typeof cell.value,'string')));assert.equal(sheet.getRow(251).getCell(12).value,'Казань');
    await writeFile(`${output}/jobs-250.xlsx`,bytes);report.files.push('jobs-250.xlsx');
  });
  await check('owned applications use explicit selected resume and repeated submission is idempotent',async()=>{
    const selected=manifest.ids.frontendResumeId;const job=all[0],body={resumeId:selected,companyId:owner.company.id,jobVersion:job.version,message:'Синтетический отклик для проверки конкретного резюме.',consentDisclosure:true};
    const first=await json(`/api/jobs/${job.id}/applications`,candidateCookie,{method:'POST',body:JSON.stringify(body)}),second=await json(`/api/jobs/${job.id}/applications`,candidateCookie,{method:'POST',body:JSON.stringify(body)});
    assert.equal(first.id,second.id);assert.equal(first.resumeId,selected);assert.equal(first.snapshot.location,'Казань');assert.deepEqual(first.snapshot.skillRequirements,job.skillRequirements);
    const result=await json(`/api/me/applications/search?q=${prefix}&resumeId=${selected}`,candidateCookie);assert.equal(result.total,1);assert.equal(result.items[0].resumeId,selected);
    // Cascade-cleaning our own publication removes this exact application grant;
    // do not revoke this company's unrelated historical grants while other QA runs.
  });
  await check('closed publication and invalid resume are rejected without disclosure',async()=>{
    const ownJob=all[1];await db.update(jobs).set({status:'closed'}).where(and(eq(jobs.id,ownJob.id),eq(jobs.companyId,owner.company.id)));
    const body={resumeId:manifest.ids.frontendResumeId,companyId:owner.company.id,jobVersion:ownJob.version,message:'Синтетическая проверка.',consentDisclosure:true};
    assert.equal((await request(`/api/jobs/${ownJob.id}/applications`,{method:'POST',body:JSON.stringify(body)},candidateCookie)).status,404);
    const other=all[2];assert.equal((await request(`/api/jobs/${other.id}/applications`,{method:'POST',body:JSON.stringify({...body,resumeId:2147483647})},candidateCookie)).status,404);
  });
  await check('owned invitation search sorting/context and direct details use current permissions',async()=>{
    const newest=await json('/api/me/invitations/search?sort=newest',candidateCookie),oldest=await json('/api/me/invitations/search?sort=oldest',candidateCookie);assert.equal(newest.total,oldest.total);
    const rows=newest.items;for(let index=1;index<rows.length;index++)assert.ok(rows[index-1].createdAt>rows[index].createdAt||rows[index-1].createdAt===rows[index].createdAt&&rows[index-1].id>rows[index].id);
    if(rows.length){const detail=await json(`/api/me/invitations/${rows[0].id}`,candidateCookie);assert.equal(detail.id,rows[0].id);const filtered=await json(`/api/me/invitations/search?resumeId=${rows[0].resumeId}`,candidateCookie);assert.ok(filtered.items.every((row:any)=>row.resumeId===rows[0].resumeId));}
    const denial=await request('/api/me/invitations/2147483647',{},candidateCookie);assert.equal(denial.status,404);
  });
} catch(error) { report.error=String(error);process.exitCode=1; }
finally {
  if(ids.length) {
    // Captured IDs + exact company + unique run title; this removes only this temporary fixture.
    const employer=manifest.accounts.find((account:any)=>account.name==='employer-a');
    const removed=await db.delete(jobs).where(and(inArray(jobs.id,ids),eq(jobs.companyId,employer.companyId),sql`${jobs.title} like ${`%${prefix}%`}`)).returning({id:jobs.id});report.cleanedJobs=removed.length;
    assert.equal(removed.length,ids.length);
  }
  report.completedAt=new Date().toISOString();await writeFile(`${output}/http-report.json`,JSON.stringify(report,null,2)+'\n');await pool.end();console.info(JSON.stringify({checks:report.checks.length,pass:!report.error,cleanedJobs:report.cleanedJobs,report:`${output}/http-report.json`,error:report.error??null}));
}
