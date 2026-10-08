/** Restore receipt only: guards/SELECT/GET after session process loss. No load/test/migration. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pool} from '../lib/db/src/index.ts';
const root=process.cwd().replaceAll('\\','/');
assert.ok(root.endsWith('/signal-ui-refinement-workspace-20261008'));
const dir=root+'/outputs/verification/correction-01-20261008';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const dbUrl=new URL(process.env.DATABASE_URL!);assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'55435');assert.equal(dbUrl.pathname,'/signal_full_audit_a10_20261008');
const specs=[
 {port:4393,pid:36488,path:dir+'/clean-workspace/artifacts/api-server/dist/index.mjs',sha:'204583be673763bbe494a8634b7991518a7b1980f8f5c5f2ef712285a40a3f40',kind:'current-clean'},
 {port:4371,pid:20696,path:root+'/outputs/runtime/ui-refinement-correction02-iteration01/dist/index.mjs',sha:'204583be673763bbe494a8634b7991518a7b1980f8f5c5f2ef712285a40a3f40',kind:'current-user'},
 {port:4383,pid:11668,path:root+'/outputs/verification/full-audit-a01-a11-20261008/clean-workspace/artifacts/api-server/dist/index.mjs',sha:'c19afa3d2f9b29f6153431171658303c82f992fd7e2b5ad09fbafbd9566aee60',kind:'historical-c19'}
];
const ps="$taskPorts=@(4313,4314,4371,4372,4383,4384,4393,4394);$taskRows=foreach($taskPort in $taskPorts){foreach($taskId in @(Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique)){$taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$taskId);@{port=$taskPort;pid=$taskId;name=$taskProcess.Name;commandLine=$taskProcess.CommandLine}}};ConvertTo-Json -InputObject @($taskRows) -Compress";
const rows=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true})) as any[];
assert.equal(rows.filter(r=>r.port===4313||r.port===4314).length,0);
const runtimes=[];
for(const spec of specs){const r=rows.filter(r=>r.port===spec.port);assert.equal(r.length,1);assert.equal(r[0].pid,spec.pid);assert.ok(r[0].commandLine.replaceAll('\\','/').toLowerCase().includes(spec.path.toLowerCase()));assert.equal(hash(await readFile(spec.path)),spec.sha);const response=await fetch(`http://127.0.0.1:${spec.port}/api/healthz`);assert.equal(response.status,200);await response.arrayBuffer();runtimes.push({...spec,entryPathAndPidVerified:true,healthStatus:response.status,commandLineSha256:hash(r[0].commandLine)});}
for(const [port,pid] of [[4372,43352],[4394,45748],[4384,18600]]){const r=rows.filter(r=>r.port===port);assert.equal(r.length,1);assert.equal(r[0].pid,pid);assert.ok(r[0].commandLine.replaceAll('"','').includes(`--port ${port}`));assert.ok(r[0].commandLine.replaceAll('\\','/').toLowerCase().includes(root.toLowerCase()));}
const client=await pool.connect();let snapshot:any;
try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const identity=(await client.query("select current_database() as database,current_setting('transaction_read_only') as read_only")).rows[0];assert.equal(identity.database,'signal_full_audit_a10_20261008');assert.equal(identity.read_only,'on');const migrations=(await client.query('select * from drizzle.__drizzle_migrations order by created_at')).rows;assert.equal(migrations.length,15);snapshot={identity,migrations};await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
const ledger=JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-full-audit-a10-fixtures-20261008-correction-01.json','utf8'));
const actor=ledger.actors.find((a:any)=>a.role==='candidate');
const me=await fetch('http://127.0.0.1:4393/api/me',{headers:{Cookie:actor.cookie}});assert.equal(me.status,200);const body=await me.json();assert.equal(body.user.id,actor.id);
const core=JSON.parse(await readFile(dir+'/integration/current-core-http.json','utf8'));assert.equal(core.passed,true);assert.equal(core.runtime.sha256,specs[0].sha);assert.equal(core.runtime.pid,12732);
const load=JSON.parse(await readFile(dir+'/performance/single-retest-report.json','utf8'));assert.equal(load.requests,568);assert.equal(load.apiPid,12732);assert.equal(load.apiRuntime.sha256,specs[0].sha);
const receipt={at:new Date().toISOString(),cause:'Previously owned six native processes absent at manifest preflight after a session boundary; exact external cause not established',preflightFailure:dir+'/manifest-preflight-runtime-loss.json',runtimes,ui:rows.filter(r=>[4372,4384,4394].includes(r.port)).map(r=>({port:r.port,pid:r.pid,commandLineSha256:hash(r.commandLine)})),database:snapshot,ownCandidateMe:{status:me.status,identityMatches:true},checksBeforeRecovery:{corePid:12732,loadPid:12732,bundleSha256:specs[0].sha,retained:true},newRuntimeIsByteIdentical:true,noNewTests:true,noNewLoad:true,noMigration:true,noDatabaseWritesByRecoveryHelper:true,protectedPortsUntouched:true,limits:['Core/load were performed on prior PID12732 with byte-identical204583, not rerun on recovered PIDs.','DB snapshot is SELECT-only; this is not another business-row digest preservation run.','Health and one exact-owned /me GET verify restored runtime; no new qualification/fixture/consent.','No private credentials or cookies copied into evidence.']};
await writeFile(dir+'/runtime-recovery-final.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});await pool.end();console.log(JSON.stringify({runtimes:runtimes.map(r=>({port:r.port,pid:r.pid,sha:r.sha,health:r.healthStatus})),migrations:15,ownMeStatus:200,noNewLoad:true}));
