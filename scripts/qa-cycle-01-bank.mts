/** QA-05: isolated local DB + built HTTP runtime. Never allowed on working 4310/55433. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { normalizeSkillSearchToken, canonicalSkillKey } from '../artifacts/api-server/src/lib/skill-catalog';
import { normalizeStoredSkill } from '../artifacts/api-server/src/lib/skill-catalog-sql';

const endpoint=process.env.QA_CYCLE_API_ORIGIN??'http://localhost:4321';
const apiUrl=new URL(endpoint),dbUrl=new URL(process.env.DATABASE_URL??'');
assert.ok(['localhost','127.0.0.1'].includes(apiUrl.hostname)&&apiUrl.port==='4321','This QA script requires isolated HTTP4321; working4310 prohibited');
assert.ok(['localhost','127.0.0.1'].includes(dbUrl.hostname)&&dbUrl.port==='55435','This QA script requires isolated PostgreSQL55435; working55433 prohibited');
assert.ok(/^\/signal(?:[-_]?qa[-_]?cycle[-_]?01)?$/.test(dbUrl.pathname),'Unexpected isolated database name');
const requireDb=createRequire(new URL('../lib/db/package.json',import.meta.url));
const {sql,eq,inArray}=requireDb('drizzle-orm');
const {db,pool,signalUsersTable:users,signalSessionsTable:sessions,signalCandidateProfilesTable:profiles,signalCompaniesTable:companies}=await import('../lib/db/src/index');
const run=`qa05-bank-${randomBytes(5).toString('hex')}`,marker=`Synthetic-${run}`;
const captured:number[]=[],checks:any[]=[];
const paths=['artifacts/api-server/src/routes/signal-candidate-bank.ts','artifacts/api-server/src/lib/skill-catalog.ts','artifacts/api-server/src/lib/skill-catalog-sql.ts','artifacts/api-server/src/lib/signal-matching.ts'];
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
async function sourceHashes(){return Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));}
function runtime(){
  const containerId=execFileSync('docker',['ps','--filter','publish=4321','--format','{{.ID}}'],{encoding:'utf8'}).trim();
  assert.ok(/^[a-f0-9]{12}$/.test(containerId),'Exactly one isolated4321 Docker app required');
  const inside=Object.fromEntries(execFileSync('docker',['exec',containerId,'sha256sum',...paths.map(path=>`/app/${path}`)],{encoding:'utf8'}).trim().split(/\r?\n/).map(line=>{const [hash,path]=line.trim().split(/\s+/);return [path.replace('/app/',''),hash];}));
  return {containerId,image:execFileSync('docker',['inspect','--format','{{.Image}}',containerId],{encoding:'utf8'}).trim(),bundleSha256:execFileSync('docker',['exec',containerId,'sha256sum','/app/artifacts/api-server/dist/index.mjs'],{encoding:'utf8'}).trim().split(/\s+/)[0],sourceHashes:inside};
}
const report:any={qaId:'QA-05',run,startedAt:new Date().toISOString(),method:'Independent explicit Unicode fixtures and ordinary profile HTTP saves, then SQL/pagination filtering in a built isolated runtime. Synthetic prepared verified profiles probe historical catalogue handling, not grading validity.',target:{api:endpoint,databaseHost:dbUrl.hostname,databasePort:dbUrl.port,databaseName:dbUrl.pathname.slice(1),working4310:'untouched',working55433:'untouched'},checks};
async function fixture(role:'candidate'|'employer',name:string,options:any={}){
  const token=randomBytes(32).toString('base64url');
  const [user]=await db.insert(users).values({email:`${run}-${name}@example.test`,passwordHash:'unusable-qa05-local-fixture',role,displayName:`Synthetic QA05 ${name}`,emailVerified:true,demoMode:options.demoMode??false}).returning();
  captured.push(user.id);
  await db.insert(sessions).values({userId:user.id,tokenHash:sha(token),expiresAt:new Date(Date.now()+20*60*1000),demoMode:options.demoMode??false});
  if(role==='employer')await db.insert(companies).values({ownerUserId:user.id,name:`Synthetic ${run}`,contactEmail:user.email});
  if(role==='candidate')await db.insert(profiles).values({userId:user.id,professionalAlias:`${run} ${name}`,specialization:'Backend / Python',assumedGrade:options.grade??'Middle',verifiedGrade:options.grade??'Middle',verifiedScore:100,verifiedSkills:options.verifiedSkills??[marker,'SQL'],stack:options.stack??[],skills:[],workFormat:'Удалённо',salaryMin:140000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross',visibility:options.visibility??'pseudonymous',consentMatching:options.consent??true,latestAssessmentAt:new Date('2026-10-05T12:00:00Z')});
  return {id:user.id,name,async request(path:string,method='GET',body?:unknown,expected=200){
    const r=await fetch(`${endpoint}/api${path}`,{method,headers:{Origin:endpoint,Cookie:`fsp_signal_session=${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const data=await r.json();assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);return data;
  }};
}
async function check(id:string,expectation:string,work:()=>Promise<unknown>){
  try{checks.push({id,expectation,status:'pass',evidence:await work()});console.log(`PASS ${id}`);}
  catch(error:any){checks.push({id,expectation,status:'fail',error:error.message});console.log(`FAIL ${id}: ${error.message}`);}
}
function sameHashes(a:Record<string,string>,b:Record<string,string>){return paths.every(path=>a[path]===b[path]);}
try{
  report.before={runtime:runtime(),sourceHashes:await sourceHashes()};
  assert.ok(sameHashes(report.before.runtime.sourceHashes,report.before.sourceHashes),'Built isolated source inputs must match local fix before verification');
  const employer=await fixture('employer','employer');
  const ordinary=await fixture('candidate','ordinary');
  const bank=async(skill?:string,q=run,page=1)=>employer.request(`/employer/candidates?${new URLSearchParams({q,page:String(page),...(skill===undefined?{}:{skill})})}`);
  await check('postgres-nfkc-whitespace-case-parity','UTF8 PostgreSQL evaluates independent Unicode examples with the same identity as the catalog; no persistent row changes.',async()=>{
    const [{server_encoding:encoding,version}]=(await db.execute(sql`select current_setting('server_encoding') as server_encoding, version()`)).rows;
    assert.equal(encoding,'UTF8');
    const examples=[['Ｐｙｔｈｏｎ','python'],['\u00a0ＰＹＴＨＯＮ\u00a0','python'],['𝑃𝑦𝑡ℎ𝑜𝑛','python'],['\ufeffＰｙｔｈｏｎ\ufeff','python'],['ＡＰＩ\u3000\u3000contracts','api contracts'],[' API\t\r\ncontracts\u2028','api contracts'],['ＡＰＩ－контракты','api-контракты'],['ＰＯＳＴＧＲＥＳ','postgres'],[' ｐｙ ','py'],['Ａ１１Ｙ','a11y'],[' e\u0301ngine\u2003\u2003X ','éngine x'],[' Ｑ－Ｓｔｏｒｅ ','q-store']];
    const rows=[];
    for(const [raw,expected] of examples){const [{value}]=(await db.execute(sql`select ${normalizeStoredSkill(sql`${raw}`)} as value`)).rows;assert.equal(value,expected,raw);assert.equal(value,normalizeSkillSearchToken(raw),raw);rows.push({raw,expected,sql:value});}
    return {serverEncoding:encoding,version,examples:rows};
  });
  await check('ordinary-put-raw-stack-roundtrip','Ordinary profile save preserves fullwidth raw stack; catalogue canonical display and filters agree without rewriting stored text.',async()=>{
    const before=await ordinary.request('/me/candidate-profile');
    const raw=['\u00a0Ｐｙｔｈｏｎ\u00a0','ＡＰＩ\u3000\u3000contracts'];
    const saved=await ordinary.request('/me/candidate-profile','PUT',{...before,stack:raw});assert.deepEqual(saved.stack,raw);
    const q=`${run} ordinary`,unfiltered=await bank(undefined,q),row=unfiltered.candidates.find((r:any)=>r.candidateId===ordinary.id);
    assert.ok(row);assert.deepEqual(row.stack,['Python','API contracts']);
    for(const skill of ['Python','Ｐｙｔｈｏｎ',' py ','API contracts','API-контракты']){const result=await bank(skill,q);assert.equal(result.total,1,skill);assert.equal(result.candidates[0]?.candidateId,ordinary.id,skill);}
    const [stored]=await db.select({stack:profiles.stack,verifiedSkills:profiles.verifiedSkills}).from(profiles).where(eq(profiles.userId,ordinary.id));assert.deepEqual(stored.stack,raw);assert.ok(!stored.verifiedSkills.includes('Python'));
    return {storedRaw:stored.stack,display:row.stack,filtersAgree:true,verifiedSkillsUnchanged:stored.verifiedSkills};
  });
  const historical=await fixture('candidate','historical',{verifiedSkills:[marker,'\ufeffＰｙｔｈｏｎ\ufeff','ＡＰＩ－контракты'],stack:[]});
  await check('historical-verified-values-no-backfill','Existing verified arrays with Unicode spellings are included by catalogue and mandatory matching, without rewriting them or manufacturing quality.',async()=>{
    const before=await db.select().from(profiles).where(eq(profiles.userId,historical.id));
    for(const skill of ['Python','py','API contracts'])assert.ok((await bank(skill,`${run} historical`)).candidates.some((row:any)=>row.candidateId===historical.id));
    const n=await employer.request('/employer/needs','POST',{title:`Synthetic ${run}`,specialization:'Backend / Python',grade:'Middle',requiredSkills:[marker,'Python'],desirableSkills:[],description:'Synthetic local Unicode bank regression',workFormat:'Удалённо',salaryMin:140000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross'},201);
    const matches=await employer.request(`/matches?needId=${n.id}`),m=matches.find((row:any)=>row.candidateId===historical.id);assert.ok(m);assert.equal(m.ranking.qualityScore,null);assert.equal(m.ranking.qualityStatus,'not_measured');
    assert.ok(!matches.some((row:any)=>row.candidateId===ordinary.id),'Self-stated stack alone must not grant a mandatory verified skill');
    const after=await db.select().from(profiles).where(eq(profiles.userId,historical.id));assert.deepEqual(after,before);
    return {historicalIncluded:true,unknownQuality:null,rawUnchanged:true,selfStatedNotVerified:true};
  });
  const unknown=await fixture('candidate','unknown',{verifiedSkills:[marker,'SQL'],stack:[' Ｑ－Ｓｔｏｒｅ ']});
  await check('unknown-punctuation-and-sql-input-boundary','Unknown exact NFKC spelling matches; unlisted punctuation synonym and hostile SQL-looking query do not broaden results.',async()=>{
    const q=`${run} unknown`;
    assert.equal((await bank('Q-Store',q)).candidates[0]?.candidateId,unknown.id);
    assert.equal((await bank('QStore',q)).total,0);
    assert.equal((await bank("Q-Store'); select 'private'; --",q)).total,0);
    assert.notEqual(canonicalSkillKey('Q-Store'),canonicalSkillKey('QStore'));
    return {exact:true,guessedSynonym:false,sqlLookingInputNotExecuted:true};
  });
  const forbidden=[await fixture('candidate','hidden',{visibility:'private',stack:['Ｐｙｔｈｏｎ']}),await fixture('candidate','no-consent',{consent:false,stack:['Ｐｙｔｈｏｎ']}),await fixture('candidate','other-pool',{demoMode:true,stack:['Ｐｙｔｈｏｎ']})];
  await check('existing-privacy-role-and-pool-boundaries','The Unicode correction does not broaden hidden/no-consent/other-pool records or grant candidate access.',async()=>{
    const result=await bank('Python');assert.ok(result.candidates.every((row:any)=>!forbidden.some(f=>f.id===row.candidateId)));
    const r=await ordinary.request('/employer/candidates?skill=Python','GET',undefined,403);assert.ok(r.error);
    return {forbiddenIds:forbidden.map(f=>f.id),candidateAccess:403};
  });
  const pageFixtures:Array<Awaited<ReturnType<typeof fixture>>>=[];
  for(let i=0;i<27;i++)pageFixtures.push(await fixture('candidate',`pages-${String(i).padStart(2,'0')}`,{stack:i%2===0?['Ｐｙｔｈｏｎ']:['\ufeffｐｙ\ufeff']}));
  await check('sql-count-pagination-on-existing-unicode-values','COUNT and LIMIT apply after normalization: 27 historical rows split 24+3 with stable complete IDs; neither page is JS post-filtered.',async()=>{
    const q=`${run} pages-`,p1=await bank('Python',q,1),p2=await bank('Python',q,2),p3=await bank('Python',q,3);
    assert.equal(p1.total,27);assert.equal(p2.total,27);assert.equal(p3.total,27);assert.equal(p1.candidates.length,24);assert.equal(p2.candidates.length,3);assert.equal(p3.candidates.length,0);
    const ids=[...p1.candidates,...p2.candidates].map((r:any)=>r.candidateId);assert.equal(new Set(ids).size,27);assert.deepEqual([...ids].sort((a,b)=>a-b),pageFixtures.map(f=>f.id).sort((a,b)=>a-b));
    assert.deepEqual((await bank('Ｐｙｔｈｏｎ',q,1)).candidates.map((r:any)=>r.candidateId),p1.candidates.map((r:any)=>r.candidateId));
    return {total:27,pageSizes:[24,3,0],uniqueReturned:27,queryNfkcInvariant:true};
  });
}catch(error:any){report.fatal={name:error.name,message:error.message};console.error(`FATAL ${error.message}`);}
finally{
  try{
    const rows=captured.length?await db.select({id:users.id,email:users.email}).from(users).where(inArray(users.id,captured)):[];
    assert.ok(rows.every((row:any)=>captured.includes(row.id)&&row.email.startsWith(`${run}-`)&&row.email.endsWith('@example.test')),'Cleanup requires captured ID and exact namespace ownership');
    if(captured.length)await db.delete(users).where(inArray(users.id,captured));
    const remaining=captured.length?await db.select({id:users.id}).from(users).where(inArray(users.id,captured)):[];
    report.cleanup={capturedIds:captured,ownershipVerified:true,remainingIds:remaining.map((row:any)=>row.id),passed:remaining.length===0};
    report.after={runtime:runtime(),sourceHashes:await sourceHashes()};
    report.runtimeUnchanged=JSON.stringify(report.before?.runtime)===JSON.stringify(report.after.runtime);
    report.sourceUnchanged=report.before?sameHashes(report.before.sourceHashes,report.after.sourceHashes):false;
    report.sourceMatchesRuntime=sameHashes(report.after.runtime.sourceHashes,report.after.sourceHashes);
  }catch(error:any){report.cleanupFatal={name:error.name,message:error.message};}
  report.finishedAt=new Date().toISOString();
  report.summary={groups:checks.length,passed:checks.filter(c=>c.status==='pass').length,failed:checks.filter(c=>c.status==='fail').length};
  report.fixed=true;report.verified=report.summary.groups===6&&report.summary.failed===0&&!report.fatal&&!report.cleanupFatal&&report.cleanup?.passed&&report.runtimeUnchanged&&report.sourceUnchanged&&report.sourceMatchesRuntime;
  report.limitations=['These are synthetic local acceptance scenarios. They do not measure human usability or hiring validity.',
    'Historical verified profiles are prepared fixtures; this checks how the catalogue reads existing data, not whether humans earn the grade.',
    'PostgreSQL uses its configured Unicode lowercase locale; the listed ASCII/Cyrillic/canonical/unknown examples are measured, not every Unicode code point.',
    'The script never reads or mutates working port4310 or database55433. It creates and deletes only captured synthetic rows in the isolated database.'];
  await mkdir('outputs/verification/qa-cycle-01-bank-history',{recursive:true});
  const json=JSON.stringify(report,null,2)+'\n';
  await writeFile(`outputs/verification/qa-cycle-01-bank-history/${run}.json`,json);
  await writeFile('outputs/verification/qa-cycle-01-bank.json',json);
  await pool.end();console.log(JSON.stringify({run,verified:report.verified,...report.summary,cleanup:report.cleanup?.passed,report:'outputs/verification/qa-cycle-01-bank.json'}));
  if(!report.verified)process.exitCode=1;
}
