/** C02/C03 staged live regression; exact isolated DB/runtime, own synthetic actors only. */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {eq,inArray} from 'drizzle-orm';
import {db,pool,signalUsersTable as users,signalCandidateProfilesTable as profiles,signalCandidateResumesTable as resumes,signalCompaniesTable as companies,signalSkillAttemptsTable as attempts,signalSkillEvidenceTable as evidence} from '../lib/db/src/index';
import {hashPassword} from '../artifacts/api-server/src/lib/signal-auth';
import {emptyResume} from '../artifacts/api-server/src/lib/signal-resume-contract';
import {correctSkillEvidence} from '../artifacts/api-server/src/lib/skill-module-service';

const target=new URL(process.env.DATABASE_URL!);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55435');assert.equal(target.pathname,'/signal_ui_refinement_20261008');assert.equal(process.env.PORT,'4371');assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED,'true');assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED,'true');
const [mode,bundlePath,expectedSha,expectedPid]=process.argv.slice(2);
assert.ok(['prepare','resume-prepare','alias','name','middle','correction','inspect','cleanup'].includes(mode));
assert.ok(bundlePath?.replaceAll('\\','/').startsWith('C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008/outputs/runtime/'));assert.match(expectedSha??'',/^[a-f0-9]{64}$/);assert.match(expectedPid??'',/^\d+$/);
const sha256=createHash('sha256').update(await readFile(bundlePath)).digest('hex');assert.equal(sha256,expectedSha);
const ps="$ProgressPreference='SilentlyContinue'; $taskListeners=@(Get-NetTCPConnection -LocalPort 4371 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if($taskListeners.Count -ne 1){throw 'Expected one API process'}; $taskApi=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$taskListeners[0]); @{pid=$taskApi.ProcessId;commandLine=$taskApi.CommandLine}|ConvertTo-Json -Compress";
const running=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',timeout:15000}));assert.equal(running.pid,Number(expectedPid));
assert.equal(process.cwd().replaceAll('\\','/'),'C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008');
const runningCommand=running.commandLine.replaceAll('\\','/').toLowerCase(),relativeBundle=path.relative(process.cwd(),bundlePath).replaceAll('\\','/').toLowerCase();
assert.ok(runningCommand.includes(bundlePath.replaceAll('\\','/').toLowerCase())||runningCommand.endsWith(' '+relativeBundle)||runningCommand.endsWith(' "'+relativeBundle+'"'));
const directory='outputs/verification/ui-refinement-correction01-20261008/documents/live';
const manifestPath='C:/Users/Misha/.codex/private/signal-document-freshness-correction01-20261008.json';
const origin='http://127.0.0.1:4371',appOrigin='http://localhost:4372';
type Actor={id:number;email:string;password:string;cookie:string;role:'candidate'|'employer'};
type Manifest={prefix:string;actors:Actor[];anonymousId:number;publicId:number;versions:Record<string,string>;skillEvidenceIds:number[];aggregate:unknown;protectedHistory:unknown;initialCvHashes:unknown;stage:string};
let state:Manifest|undefined,failure:string|undefined;const checks:string[]=[],requests:{method:string;path:string;status:number;actorId:number}[]=[];
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function request(actor:Actor,path:string,method='GET',body?:unknown){const response=await fetch(origin+'/api'+path,{method,headers:{Origin:appOrigin,...(actor.cookie?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const bytes=Buffer.from(await response.arrayBuffer());const json=response.headers.get('content-type')?.includes('json')&&bytes.length?JSON.parse(bytes.toString('utf8')):undefined;requests.push({method,path,status:response.status,actorId:actor.id});return{status:response.status,bytes,json,headers:response.headers};}
async function ok(actor:Actor,path:string,method='GET',body?:unknown,status=200){const result=await request(actor,path,method,body);assert.equal(result.status,status,`${method} ${path}: ${result.json?.error??''}`);return result;}
async function cvHashes(){return(await pool.query('SELECT id,md5(to_jsonb(r)::text) hash FROM signal_candidate_resumes r WHERE id=ANY($1::int[]) ORDER BY id',[[state!.anonymousId,state!.publicId]])).rows;}
async function aggregate(){return(await pool.query('SELECT id,revision,verified_grade,verified_score,verified_skills,latest_assessment_at,qualification_attempt_id FROM signal_candidate_resumes WHERE id=ANY($1::int[]) ORDER BY id',[[state!.anonymousId,state!.publicId]])).rows;}
async function protectedHistory(){return(await pool.query("SELECT 'attempt' kind,id,md5(to_jsonb(a)::text) hash FROM signal_assessment_attempts a WHERE id<=7 UNION ALL SELECT 'user',id,md5(to_jsonb(u)::text) FROM signal_users u WHERE id=997 ORDER BY kind,id")).rows;}
async function persist(){await mkdir('C:/Users/Misha/.codex/private',{recursive:true});await writeFile(manifestPath,JSON.stringify(state,null,2));}
async function createActor(role:'candidate'|'employer'):Promise<Actor>{const email=state!.prefix+'-'+role+'@example.test',password='Signal!'+randomBytes(18).toString('base64url');const [user]=await db.insert(users).values({email,passwordHash:await hashPassword(password),role,displayName:role==='candidate'?'Игорь Сергеевич Документов':'Проверка свежести документов',emailVerified:true,demoMode:false}).returning();const actor={id:user.id,email,password,cookie:'',role};state!.actors.push(actor);await persist();if(role==='candidate')await db.insert(profiles).values({userId:user.id,professionalAlias:'Анонимный инженер до изменения',contactEmail:email,phone:'+79991234567'});else await db.insert(companies).values({ownerUserId:user.id,name:'Синтетическая проверка свежести',contactEmail:email});const login=await ok(actor,'/auth/login','POST',{email,password});actor.cookie=login.headers.get('set-cookie')!.split(';')[0];await persist();return actor;}
async function completePython(level:'Junior'|'Middle'){
  const owner=state!.actors.find(a=>a.role==='candidate')!;
  const matrix=(await ok(owner,'/me/skill-matrix')).json;
  const started=(await ok(owner,'/me/skill-attempts','POST',{resumeId:state!.anonymousId,skillId:'python',level,programVersion:matrix.bankVersion},201)).json.attempt;
  assert.equal(started.level,level);assert.equal(started.skillId,'python');assert.ok(!JSON.stringify(started).includes('oracles'));
  const [row]=await db.select().from(attempts).where(eq(attempts.id,started.id));assert.equal(row.userId,owner.id);
  // Saved private oracle is used only for this mechanical regression, never sent by active DTO.
  const answers=Object.fromEntries(Object.entries(row.oracles).map(([id,value])=>[id,value.expected]));
  const submitted=(await ok(owner,`/me/skill-attempts/${row.id}/submit`,'POST',{revision:started.revision,answers})).json.attempt;assert.equal(submitted.decision.passed,true);
  const [proof]=await db.select().from(evidence).where(eq(evidence.attemptId,row.id));assert.equal(proof.userId,owner.id);state!.skillEvidenceIds.push(proof.id);await persist();
  checks.push(`Ordinary issued/submitted Python ${level} creates own proof ${proof.id}; active DTO has no oracle`);
}
async function readDocument(id:number){const employer=state!.actors.find(a=>a.role==='employer')!;const preview=await ok(employer,`/resumes/${id}/document-preview`);assert.match(preview.json.projectionVersion,/^signal-document-v1:[a-f0-9]{64}$/);assert.match(preview.headers.get('cache-control')??'',/no-store/);const again=await ok(employer,`/resumes/${id}/document-preview`);assert.equal(again.json.projectionVersion,preview.json.projectionVersion,'Poll must be stable without source changes');return preview.json;}
async function inspectFiles(stage:string,id:number){
  const employer=state!.actors.find(a=>a.role==='employer')!,preview=await readDocument(id),paths:string[]=[];
  for(const format of ['pdf','docx'] as const){const result=await ok(employer,`/resumes/${id}/document.${format}`);assert.equal(result.headers.get('x-signal-document-version'),preview.projectionVersion);assert.match(result.headers.get('cache-control')??'',/no-store/);assert.equal(result.bytes.subarray(0,format==='pdf'?5:2).toString(),format==='pdf'?'%PDF-':'PK');const file=`${directory}/${stage}-${id}.${format}`;await writeFile(file,result.bytes);paths.push(file);}
  const inline=await ok(employer,`/resumes/${id}/preview.pdf`);assert.equal(inline.headers.get('x-signal-document-version'),preview.projectionVersion);
  await writeFile(`${directory}/${stage}-${id}.json`,JSON.stringify(preview,null,2));
  const req=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url)),nested=createRequire(req.resolve('docx')),zip=await nested('jszip').loadAsync(await readFile(paths[1]));const xml=(await Promise.all(Object.values(zip.files).filter((part:any)=>part.name.endsWith('.xml')||part.name.endsWith('.rels')).map((part:any)=>part.async('string')))).join('\n');
  const pdfCode='import sys,io,json; from pypdf import PdfReader; r=PdfReader(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({"text":"\\n".join(p.extract_text() or "" for p in r.pages),"pages":len(r.pages),"metadata":{str(k):str(v.get_object() if hasattr(v,"get_object") else v) for k,v in (r.metadata or {}).items()},"links":[str(a.get_object().get("/A",{}).get("/URI","")) for p in r.pages for a in p.get("/Annots",[]) if a.get_object().get("/A")]},ensure_ascii=False))';
  const pdf=JSON.parse(execFileSync('C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-X','utf8','-c',pdfCode],{input:await readFile(paths[0]),encoding:'utf8',maxBuffer:2_000_000,timeout:15000}));
  assert.ok(xml.includes(preview.name));assert.ok(pdf.text.includes(preview.name));
  for(const text of preview.sections.flatMap((section:any)=>section.paragraphs.map((p:any)=>p.text)))assert.ok(xml.includes(text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')),`DOCX lacks ${text}`);
  for(const forbidden of [state!.actors.find(a=>a.role==='candidate')!.email,'79991234567','https://private.example.test'])assert.ok(!xml.includes(forbidden)&&!JSON.stringify(pdf).includes(forbidden));
  assert.equal(pdf.metadata['/Author'],'Signal');assert.equal(pdf.links.length,0);assert.ok(!xml.includes('Target="https://'));
  checks.push(`${stage} final JSON/PDF/DOCX name and permitted content agree; headers/version/no-store and contact/link redaction hold`);
  return preview;
}
try{
  await mkdir(directory,{recursive:true});
  if(mode==='prepare'){
    await assert.rejects(readFile(manifestPath),'Retained fixture already exists; do not create duplicates');
    state={prefix:'document-freshness-'+randomUUID(),actors:[],anonymousId:0,publicId:0,versions:{},skillEvidenceIds:[],aggregate:null,protectedHistory:await protectedHistory(),initialCvHashes:null,stage:'prepare'};await persist();
    const owner=await createActor('candidate');await createActor('employer');
    const legacy={specialization:'Backend / Python',grade:'Middle' as const,score:88,skills:['Python','SQL'],assessedAt:'2026-10-01T00:00:00Z',gradeChangedAt:'2026-10-01T00:00:00Z',attemptId:null,limitation:'Synthetic imported historical fixture; not a new qualification.'};
    const base={...emptyResume(),userId:owner.id,stack:['Python','SQL'],skills:[],assumedGrade:'Middle' as const,verifiedGrade:'Middle' as const,verifiedScore:88,verifiedSkills:['Python','SQL'],latestAssessmentAt:new Date(legacy.assessedAt),verifiedGradeChangedAt:new Date(legacy.gradeChangedAt),legacyQualification:legacy,consentCatalog:true,consentMatching:false,title:'Backend-разработчик',salaryMin:1234567,salaryMax:8765432,salaryPeriod:'year' as const};
    const [anonymous,publicResume]=await db.insert(resumes).values([{...base,isPrimary:true,visibility:'pseudonymous' as const},{...base,isPrimary:false,visibility:'public' as const}]).returning();state.anonymousId=anonymous.id;state.publicId=publicResume.id;await persist();
    await completePython('Junior');await ok(owner,'/me/resumes');state.aggregate=await aggregate();state.initialCvHashes=await cvHashes();await persist();
    for(const id of [state.anonymousId,state.publicId]){const document=await inspectFiles('junior-initial',id);assert.ok(JSON.stringify(document).includes('Python - Junior'));state.versions[String(id)]=document.projectionVersion;}
    checks.push('Two own synthetic CVs retain historical Middle + partial Junior; pseudonymous/public identity contexts ready for UI');
  }else{
    state=JSON.parse(await readFile(manifestPath,'utf8'));assert.ok(state);assert.ok(state.prefix.startsWith('document-freshness-'));const rows=await db.select({id:users.id,email:users.email}).from(users).where(inArray(users.id,state.actors.map(a=>a.id)));assert.equal(rows.length,state.actors.length);assert.ok(rows.every(r=>r.email.startsWith(state!.prefix)));
    const owner=state.actors.find(a=>a.role==='candidate')!;
    if(mode==='resume-prepare'){
      assert.equal(state.stage,'prepare');assert.equal(state.skillEvidenceIds.length,1);
      const [proof]=await db.select().from(evidence).where(eq(evidence.id,state.skillEvidenceIds[0]));assert.equal(proof.userId,owner.id);assert.equal(proof.skillId,'python');assert.equal(proof.level,'Junior');
      // The first failed inspector run preceded persisting these local baselines.
      // Recover its saved aggregate receipt, without issuing or modifying anything.
      if(state.aggregate===null){const failed=JSON.parse(await readFile(`${directory}/http-prepare.json`,'utf8'));assert.equal(failed.status,'FAIL');assert.ok(failed.aggregate);state.aggregate=failed.aggregate;}
      assert.equal(sha(await aggregate()),sha(state.aggregate));
      if(state.initialCvHashes===null)state.initialCvHashes=await cvHashes();else assert.deepEqual(await cvHashes(),state.initialCvHashes);
      for(const id of [state.anonymousId,state.publicId]){const document=await inspectFiles('junior-prepared',id);assert.ok(JSON.stringify(document).includes('Python - Junior'));state.versions[String(id)]=document.projectionVersion;}
      assert.deepEqual(await cvHashes(),state.initialCvHashes);
      checks.push('Resumed inspector after metadata/baseline harness errors; no new actors, CVs or attempts; stored aggregate matches the first failed receipt and CV rows remain unchanged through inspection');
    }else if(mode==='alias'||mode==='name'){
      const before=await cvHashes(),account=(await ok(owner,'/me/account')).json;
      const body=mode==='alias'?{displayName:account.displayName,expectedDisplayName:account.displayName,professionalAlias:'Новый псевдоним инженера',expectedProfessionalAlias:account.professionalAlias}:{displayName:'Игорь Александрович Обновлённый',expectedDisplayName:account.displayName};
      await ok(owner,'/me/account','PATCH',body);assert.deepEqual(await cvHashes(),before,'Identity update must not fake a CV edit');
      const changedId=mode==='alias'?state.anonymousId:state.publicId,document=await inspectFiles(mode,changedId);assert.notEqual(document.projectionVersion,state.versions[String(changedId)]);assert.equal(document.name,mode==='alias'?'Новый псевдоним инженера':'Игорь Александрович Обновлённый');state.versions[String(changedId)]=document.projectionVersion;
      const unchangedId=mode==='alias'?state.publicId:state.anonymousId;assert.equal((await readDocument(unchangedId)).projectionVersion,state.versions[String(unchangedId)]);
      checks.push(`${mode} ordinary account update changes only the exposed identity context, with exact CV rows unchanged`);
    }else if(mode==='middle'||mode==='correction'){
      const before=await aggregate();
      if(mode==='middle')await completePython('Middle');else{for(const id of state.skillEvidenceIds){const [proof]=await db.select().from(evidence).where(eq(evidence.id,id));assert.equal(proof.userId,owner.id);await correctSkillEvidence(id,'synthetic document freshness regression','Own disposable proof correction to validate stale projection rejection.');}}
      await ok(owner,'/me/resumes');assert.deepEqual(await aggregate(),before);assert.equal(sha(await aggregate()),sha(state.aggregate));
      for(const id of [state.anonymousId,state.publicId]){const document=await inspectFiles(mode,id);assert.notEqual(document.projectionVersion,state.versions[String(id)]);const text=JSON.stringify(document);assert.ok(text.includes('Грейд: Middle'));assert.ok(text.includes(mode==='middle'?'Python - Middle':'Python · заявлен'));state.versions[String(id)]=document.projectionVersion;}
      checks.push(`${mode}: stored aggregate and CV revision remain exact; current skill proof changes both document versions`);
    }else if(mode==='inspect'){
      for(const id of [state.anonymousId,state.publicId])await inspectFiles('inspect',id);
      const stats=(await ok(owner,'/me/resumes')).json.resumes;for(const id of [state.anonymousId,state.publicId]){const row=stats.find((r:any)=>r.id===id);assert.equal(row.analytics.views,0);assert.equal(row.analytics.downloads,1);}checks.push('Repeated inline previews create no views/downloads; both file formats/stages deduplicate to one employer download per CV');
    }else if(mode==='cleanup'){
      assert.deepEqual(await protectedHistory(),state.protectedHistory);await db.delete(users).where(inArray(users.id,state.actors.map(a=>a.id)));assert.equal((await db.select({id:users.id}).from(users).where(inArray(users.id,state.actors.map(a=>a.id)))).length,0);await unlink(manifestPath);checks.push('Own fixture actors cascaded to zero; original seven attempts and user997 hashes unchanged');
    }
  }
  assert.deepEqual(await protectedHistory(),state!.protectedHistory);if(mode!=='cleanup'){state!.stage=mode;await persist();}
}catch(error){failure=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally{
  const receipt={checkedAt:new Date().toISOString(),status:failure?'FAIL':'PASS',mode,checks,failure,runtime:{origin,bundlePath,sha256,pid:running.pid},actors:state?.actors.map(a=>({id:a.id,role:a.role})),resumes:state?{anonymous:state.anonymousId,public:state.publicId}:undefined,versions:state?.versions,aggregate:state?.aggregate,requests,privateManifest:mode==='cleanup'?null:manifestPath,limitations:['Synthetic imported historical Middle is a fixture, not a newly awarded proof. New Python module results use ordinary API and private oracle-assisted answers for mechanics only.','Named correction service touches only this fixture; saved original proof/attempt snapshots stay immutable until own-fixture cleanup.','Viewer refresh itself is verified separately through UI on the next ordinary poll.','Native Word pagination not validated; DOCX XML/text/links and real PDF content are checked.']};await mkdir(directory,{recursive:true});await writeFile(`${directory}/http-${mode}.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:receipt.status,mode,checks:checks.length,failure,actorIds:state?.actors.map(a=>a.id),resumes:receipt.resumes}));await pool.end();
}
