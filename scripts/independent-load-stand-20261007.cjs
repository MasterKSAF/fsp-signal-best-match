const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const {randomBytes}=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');
const guard=require('./lib/independent-load-guard-20261007.cjs');
const root=path.resolve(__dirname,'..'), privateDir=path.join(root,'outputs/local-backup/independent-load-20261007');
const manifestPath=path.join(privateDir,'stand.json'), envPath='C:/Users/Misha/.codex/private/signal-independent-load-20261007.env';
const sourceEnvPath='C:/Users/Misha/.codex/private/signal-independent-fixes-20261007.env';
const formsPath='C:/Users/Misha/.codex/private/signal-independent-load-20261007-forms.json';
const pwsh='C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe';
const exec=(exe,args,options={})=>execFileSync(exe,args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,...options});
const requireApi=createRequire(path.join(root,'artifacts/api-server/package.json'));
const esbuild=requireApi('esbuild');
function readEnv(file) {return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).filter(v=>/^[A-Z0-9_]+=/.test(v)).map(v=>{const n=v.indexOf('=');return[v.slice(0,n),v.slice(n+1).replace(/^['"]|['"]$/g,'')];}));}
function listener(port) {return Number(exec(pwsh,['-NoLogo','-NoProfile','-Command',`$p=Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if($p){$p|Select-Object -First 1 -ExpandProperty OwningProcess}; exit 0`]).trim())||null;}
function identity(pid) {return JSON.parse(exec(pwsh,['-NoLogo','-NoProfile','-Command',`$p=Get-Process -Id ${pid};$w=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';[pscustomobject]@{Id=$p.Id;StartTime=$p.StartTime;ProcessName=$p.ProcessName;CommandLine=$w.CommandLine}|ConvertTo-Json -Compress`]));}
function containerInfo(){const value=JSON.parse(exec('docker',['inspect',guard.target.container]))[0];guard.assertContainer(value);return value;}
function query(sql,database='postgres'){const c=containerInfo(),env=new Map(c.Config.Env.map(v=>{const n=v.indexOf('=');return[v.slice(0,n),v.slice(n+1)];}));return exec('docker',['exec',guard.target.container,'psql','-X','-v','ON_ERROR_STOP=1','-U',env.get('POSTGRES_USER'),'-d',database,'-Atqc',sql]).trim();}
function checkOwner(manifest){assert.equal(manifest.owner,'qa01_control');assert.equal(manifest.database,guard.target.database);assert.equal(manifest.containerId,containerInfo().Id);assert.equal(query(`SELECT oid FROM pg_database WHERE datname='${guard.target.database}'`),String(manifest.databaseOid));}
function checkLive(manifest,checkHarness=true){checkOwner(manifest);guard.assertAssets(JSON.parse(fs.readFileSync(manifest.runtimeManifestPath,'utf8')),{checkHarness});guard.assertProcess({...manifest.identity,apiPath:manifest.apiPath},identity(manifest.pid),listener(4369));}
const banner="import {createRequire as __independentCreateRequire} from 'node:module';import __independentPath from 'node:path';import {fileURLToPath as __independentFileURLToPath} from 'node:url';globalThis.require=__independentCreateRequire(import.meta.url);globalThis.__filename=__independentFileURLToPath(import.meta.url);globalThis.__dirname=__independentPath.dirname(globalThis.__filename);";
const options={platform:'node',bundle:true,format:'esm',external:['pdfkit','nodemailer','pino','pino-http','pg-native','*.node'],alias:{'@workspace/db':path.join(root,'lib/db/src/index.ts'),'@workspace/api-zod':path.join(root,'lib/api-zod/src/index.ts')},sourcemap:'linked',banner:{js:banner},logLevel:'silent'};
async function main(){
 assert.ok(!process.env.NODE_OPTIONS?.trim());assert.equal(process.env.SIGNAL_INDEPENDENT_PERF_ACCEPTANCE,'1');
 fs.mkdirSync(privateDir,{recursive:true});fs.mkdirSync(path.join(root,'outputs/verification/independent-performance-20261007'),{recursive:true});
 const action=process.argv[2];assert.ok(['prepare','start-baseline','start-current','run','run-profile','cache-check','stop','ready'].includes(action));
 if(action==='prepare'){
  assert.equal(listener(4369),null);assert.equal(listener(4370),null);
  const info=containerInfo(),exists=query(`SELECT count(*) FROM pg_database WHERE datname='${guard.target.database}'`)==='1';
  let owner;
  if(exists){assert.ok(fs.existsSync(manifestPath),'Never adopt an existing unowned DB');owner=JSON.parse(fs.readFileSync(manifestPath,'utf8'));checkOwner(owner);}
  else {query(`CREATE DATABASE ${guard.target.database}`);owner={owner:'qa01_control',database:guard.target.database,containerId:info.Id,databaseOid:Number(query(`SELECT oid FROM pg_database WHERE datname='${guard.target.database}'`)),createdAt:new Date().toISOString()};fs.writeFileSync(manifestPath,JSON.stringify(owner,null,2));}
  const env=readEnv(sourceEnvPath);const u=new URL(env.DATABASE_URL);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55435');u.pathname='/'+guard.target.database;
  Object.assign(env,{DATABASE_URL:u.toString(),PORT:'4369',HOST:'127.0.0.1',PUBLIC_URL:guard.target.origin,CORS_ORIGIN:guard.target.origin,LOAD_API_ORIGIN:'http://127.0.0.1:4369',INTEGRATION_APP_ORIGIN:guard.target.origin,SIGNAL_INDEPENDENT_PERF_ACCEPTANCE:'1',DEMO_MODE:'false',MICROTASK_WORKER_ENABLED:'false',SIGNAL_LOAD_PROFILE_DIAGNOSTICS:'1',NODE_ENV:'production',NODE_OPTIONS:''});
  guard.validateEnvironment(env);fs.writeFileSync(envPath,Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
  // All migrations, only on the newly manifest-owned database. No seed or reset.
  exec(process.execPath,['--import','tsx','scripts/migrate.ts'],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  const frozen=path.join(privateDir,'frozen-form-source/artifacts/api-server/src/lib');
  const generator=path.join(privateDir,'forms-generator.ts');
  fs.writeFileSync(generator,`import {assembleManagedAttempt,verifiedSkillsForAttempt} from ${JSON.stringify(path.join(frozen,'assessment-managed.ts').replaceAll('\\','/'))};import {assessmentBankVersion,scoreAttempt} from ${JSON.stringify(path.join(frozen,'assessment-bank.ts').replaceAll('\\','/'))};import {writeFileSync} from 'node:fs';const forms={};for(const program of ['backend-python','frontend-typescript'])for(const grade of ['Junior','Middle','Senior']){const form=assembleManagedAttempt(program,grade,'signal-multi-resume-scale-2026-10-06:'+program+':'+grade,{contextId:program==='backend-python'?'api-platform':'frontend-product'});const answers=form.cases.map(item=>({caseId:item.id,answer:form.oracles[item.id].answer}));const result=scoreAttempt(form.cases,form.oracles,answers);if(result.score!==100)throw new Error('Frozen oracle fixture mismatch');forms[program+'/'+grade]={...form,result,verifiedSkills:verifiedSkillsForAttempt(form.cases,form.oracles,result.evidence),programVersion:assessmentBankVersion(form.cases,form.oracles)};}writeFileSync(${JSON.stringify(formsPath)},JSON.stringify({synthetic:true,sourceArchiveSha256:'9258a60cded242bc283847f4b2d1173220a010193db21e4ceecf334712c6792f',seed:'signal-multi-resume-scale-2026-10-06',forms}));`);
  await esbuild.build({...options,entryPoints:[generator],outfile:path.join(privateDir,'forms-generator.mjs')});
  exec(process.execPath,[path.join(privateDir,'forms-generator.mjs')]);
  owner.formsSha256=guard.sha(formsPath);owner.formsPath=formsPath;owner.envPath=envPath;owner.migrated=true;fs.writeFileSync(manifestPath,JSON.stringify(owner,null,2));
  console.log(JSON.stringify({prepared:true,database:owner.database,databaseOid:owner.databaseOid,forms:6,formsSha256:owner.formsSha256,seeded:false}));return;
 }
 const owner=JSON.parse(fs.readFileSync(manifestPath,'utf8'));checkOwner(owner);
 if(action==='stop'){
  if(listener(4369)===null){console.log(JSON.stringify({stopped:true,alreadyAbsent:true}));return;}
  checkLive(owner,false);process.kill(owner.pid,'SIGTERM');for(let n=0;n<25&&listener(4369);n++)await new Promise(r=>setTimeout(r,250));assert.equal(listener(4369),null);owner.stoppedAt=new Date().toISOString();fs.writeFileSync(manifestPath,JSON.stringify(owner,null,2));console.log(JSON.stringify({stopped:true,ownedPid:owner.pid}));return;
 }
 if(action==='run'||action==='run-profile'||action==='cache-check'||action==='ready'){
  checkLive(owner);if(action==='ready'){console.log(JSON.stringify({ready:true,pid:owner.pid,apiSha256:owner.apiSha256}));return;}
  assert.equal(query("SELECT count(*) FROM signal_users WHERE email LIKE 'independent-perf-%@example.test'",guard.target.database),'0','Exact owned cleanup required before next run');
  const runtime=JSON.parse(fs.readFileSync(owner.runtimeManifestPath,'utf8')),env=readEnv(envPath);guard.validateEnvironment(env);
  assert.equal(Boolean(owner.inspector),action==='run-profile','Acceptance must run without inspector; profiling is separate diagnostic');
  if(action==='cache-check'){assert.equal(guard.sha(runtime.cacheFixturePath),runtime.cacheFixtureSha256);}
  const args=action==='run-profile'?['--diagnostic','--profile-expanded']:[];
  const child=spawn(process.execPath,[action==='cache-check'?runtime.cacheFixturePath:runtime.fixturePath,...args],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,...env,NODE_OPTIONS:'',SIGNAL_LOAD_APP_PID:String(owner.pid),SIGNAL_LOAD_RUNTIME_MANIFEST:owner.runtimeManifestPath,SIGNAL_INDEPENDENT_FORMS_PATH:formsPath,SIGNAL_INDEPENDENT_CPU_PROFILE_PATH:'C:/Users/Misha/.codex/private/signal-independent-expanded-'+owner.buildId+'.cpuprofile'}});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});checkLive(owner);assert.equal(query("SELECT count(*) FROM signal_users WHERE email LIKE 'independent-perf-%@example.test'",guard.target.database),'0','Post-run exact cleanup');process.exitCode=Number(code);return;
 }
 assert.equal(listener(4369),null,'Do not stop another process to start this stand');assert.equal(query("SELECT count(*) FROM signal_users WHERE email LIKE 'independent-perf-%@example.test'",guard.target.database),'0');
 const baseline=action==='start-baseline',profile=process.argv.includes('--profile');assert.ok(!profile||baseline,'Only baseline diagnostic profiling is permitted');
 const source=baseline?path.join(root,'outputs/local-backup/v060-compiled-runtime-81585ff06a1c/dist'):path.join(root,'artifacts/api-server/dist');
 const historicalProof=path.join(root,'outputs/verification/0.6.0/multi-resume/load-comparison-1320e58d7650.json');
 if(baseline)assert.equal(guard.sha(historicalProof),'5958b3e62553a341425c0a3bf652e090cd3e66733402d9b82a35d7945e23f06a');
 const association=baseline?JSON.parse(fs.readFileSync(historicalProof,'utf8')):JSON.parse(fs.readFileSync(path.join(root,'outputs/verification/independent-performance-20261007/current-build-candidate.json'),'utf8'));
 if(!baseline){
  assert.equal(association.schemaVersion,1);assert.equal(association.applicationVersion,'0.6.1');
  assert.match(process.env.SIGNAL_INDEPENDENT_EXPECTED_API_SHA??'',/^[a-f0-9]{64}$/);
  assert.equal(association.bundleSHA,process.env.SIGNAL_INDEPENDENT_EXPECTED_API_SHA,'Root-released normal bundle SHA must be explicit');
  for(const [relative,hash]of Object.entries(association.sourceHashes)){
   assert.ok(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.includes('..')&&!relative.includes('\\'));
   assert.equal(guard.sha(path.join(root,relative)),hash,'Current candidate source must match before launching');
  }
 }
 const expected=baseline?association.runtimeIdentity.deliveryFiles:association.distFiles,expectedApi=baseline?'e72fc99a9c9177461c10d0c853b3148d78440d90a08e4424ffeec04724ac5793':association.bundleSHA;
 assert.equal(Object.keys(expected).length,11);assert.equal(expected['index.mjs'],expectedApi);assert.deepEqual(fs.readdirSync(source).sort(),Object.keys(expected).sort());
 const buildId=randomBytes(6).toString('hex'),dir=path.join(privateDir,'runtime-'+buildId),server=path.join(dir,'server');fs.mkdirSync(server,{recursive:true});
 fs.symlinkSync(path.join(root,'artifacts/api-server/node_modules'),path.join(dir,'node_modules'),'junction');
 for(const [file,hash]of Object.entries(expected)){assert.equal(guard.sha(path.join(source,file)),hash);fs.copyFileSync(path.join(source,file),path.join(server,file));assert.equal(guard.sha(path.join(server,file)),hash);}
 const fixturePath=path.join(dir,'fixture.mjs');await esbuild.build({...options,entryPoints:[path.join(root,'scripts/independent-load-stage-20261007.ts')],outfile:fixturePath});
 const cacheFixturePath=path.join(dir,'cache-http.mjs');await esbuild.build({...options,entryPoints:[path.join(root,'scripts/independent-cache-http-20261007.ts')],outfile:cacheFixturePath});
 const harnessNames=['scripts/independent-load-stage-20261007.ts','scripts/independent-load-target-20261007.ts','scripts/independent-load-stand-20261007.cjs','scripts/lib/independent-load-guard-20261007.cjs','scripts/independent-cache-http-20261007.ts'];
 const runtime={owner:'qa01_control',database:guard.target.database,apiPort:4369,runtimeKind:'normal-delivery',historicalBaseline:baseline,apiPath:path.join(server,'index.mjs'),apiSha256:expectedApi,deliveryFiles:expected,fixturePath,fixtureSha256:guard.sha(fixturePath),formsPath,formsSha256:owner.formsSha256,harnessSources:Object.fromEntries(harnessNames.map(name=>[path.join(root,name),guard.sha(path.join(root,name))])),sourceHashes:baseline?association.expanded.sourceHashes:association.sourceHashes,candidateManifestSha256:baseline?association.runtimeIdentity.candidateManifestSha256:guard.sha(path.join(root,'outputs/verification/independent-performance-20261007/current-build-candidate.json'))};
 Object.assign(runtime,{applicationVersion:baseline?'0.6.0':association.applicationVersion,cacheFixturePath,cacheFixtureSha256:guard.sha(cacheFixturePath)});
 const runtimeManifestPath=path.join(dir,'manifest.json');fs.writeFileSync(runtimeManifestPath,JSON.stringify(runtime,null,2));guard.assertAssets(runtime);
 const env=readEnv(envPath);guard.validateEnvironment(env);const stdout=fs.openSync(path.join(privateDir,buildId+'.stdout.log'),'a'),stderr=fs.openSync(path.join(privateDir,buildId+'.stderr.log'),'a');
 const child=spawn(process.execPath,['--max-old-space-size=512',...(profile?['--inspect=127.0.0.1:9249']:[]),runtime.apiPath],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',stdout,stderr],env:{...process.env,...env,NODE_OPTIONS:''}});child.unref();fs.closeSync(stdout);fs.closeSync(stderr);
 Object.assign(owner,{buildId,pid:child.pid,apiPath:runtime.apiPath,apiSha256:runtime.apiSha256,runtimeManifestPath,inspector:profile,identity:identity(child.pid),startedAt:new Date().toISOString(),stoppedAt:null});fs.writeFileSync(manifestPath,JSON.stringify(owner,null,2));
 for(let n=0;n<80;n++){try{const result=await fetch('http://127.0.0.1:4369/api/healthz');if(result.ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 checkLive(owner);const health=await fetch('http://127.0.0.1:4369/api/healthz');assert.equal(health.status,200);
 const proof={ready:true,owner:'qa01_control',database:owner.database,databaseOid:owner.databaseOid,pid:owner.pid,processStartedAt:owner.identity.StartTime,apiSha256:owner.apiSha256,deliveryFiles:expected,formsSha256:runtime.formsSha256,historicalBaseline:baseline,inspector:profile,seeded:false,stageUntouched:true};
 fs.writeFileSync(path.join(root,'outputs/verification/independent-performance-20261007/stand-ready-'+buildId+'.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}
main().catch(error=>{console.error(error.name+': '+String(error.message).split('\n')[0].replace(/postgresql:\/\/[^\s]+/g,'[private DB URL]'));process.exitCode=1;});
