/** C06: create-only manifests after final source sync. SELECT-only database
 * snapshot, exact runtime/byte guards; never a build, test, migration or load.
 * CLI: cleanBundle cleanPid userBundle userPid. Run only after final receipts.
 * Copy the four manifests to clean evidence directly afterwards; do not rerun
 * sync, which would change the clean-source-manifest fingerprint recorded here.
 */
import assert from 'node:assert/strict';
import {access,readdir,readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pool} from '../lib/db/src/index';

const root=process.cwd();
const normal=(value:string)=>value.replaceAll('\\','/');
assert.ok(normal(root).endsWith('/signal-ui-refinement-workspace-20261008'));
const dir=path.join(root,'outputs/verification/correction-01-20261008');
const cleanRoot=path.join(dir,'clean-workspace');
const historicalDir=path.join(root,'outputs/verification/full-audit-a01-a11-20261008');
const historicalSha='c19afa3d2f9b29f6153431171658303c82f992fd7e2b5ad09fbafbd9566aee60';
const [cleanBundle,cleanPid,userBundle,userPid,...extra]=process.argv.slice(2);
assert.equal(extra.length,0);assert.ok(cleanBundle&&userBundle);assert.ok(cleanPid&&userPid);assert.match(cleanPid,/^[1-9]\d*$/);assert.match(userPid,/^[1-9]\d*$/);
const cleanFile=await realpath(cleanBundle),userFile=await realpath(userBundle);
assert.equal(normal(cleanFile).toLowerCase(),normal(path.join(cleanRoot,'artifacts/api-server/dist/index.mjs')).toLowerCase());
const userRelative=normal(path.relative(path.join(root,'outputs/runtime'),userFile));
assert.match(userRelative,/^[^/]+\/dist\/index\.mjs$/,'User runtime must be an immutable owned output directory');
assert.ok(!path.isAbsolute(userRelative)&&!userRelative.startsWith('..'));
const database=new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_full_audit_a10_20261008');
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
async function fingerprint(file:string){const bytes=await readFile(file);return {path:normal(file),sha256:sha(bytes),bytes:bytes.length};}
const excluded=new Set(['node_modules','dist','.git','clean-workspace']);
async function walk(base:string,relative=''):Promise<string[]>{
  const files:string[]=[];
  for(const entry of await readdir(path.join(base,relative),{withFileTypes:true})){
    if(excluded.has(entry.name)||entry.name.endsWith('.tsbuildinfo'))continue;
    const next=path.join(relative,entry.name);
    if(entry.isDirectory())files.push(...await walk(base,next));else if(entry.isFile())files.push(next);
  }
  return files;
}
async function walkBuild(base:string,relative=''):Promise<string[]>{
  const files:string[]=[];
  for(const entry of await readdir(path.join(base,relative),{withFileTypes:true})){
    const next=path.join(relative,entry.name);
    if(entry.isDirectory())files.push(...await walkBuild(base,next));else if(entry.isFile())files.push(next);
  }
  return files;
}
for(const name of ['source-manifest.json','runtime-manifest.json','evidence-manifest.json']){
  try{await access(path.join(dir,name));assert.fail(`Refusing to overwrite ${name}`);}catch(error:any){if(error.code!=='ENOENT')throw error;}
}

const sourceNames:string[]=[];
for(const folder of ['artifacts','lib','scripts','tests','docs'])for(const file of await walk(path.join(root,folder)))sourceNames.push(path.join(folder,file));
for(const file of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','.npmrc','.env.example','README.md','LICENSE','Dockerfile','compose.yaml','.dockerignore','.gitattributes','.gitignore']){
  try{await readFile(path.join(root,file));sourceNames.push(file);}catch(error:any){if(error.code!=='ENOENT')throw error;}
}
const source=[];
for(const file of [...new Set(sourceNames)].sort()){const item=await fingerprint(path.join(root,file));source.push({...item,path:normal(file)});}

// A final sync must already include this writer and the final documents. Every
// manifest source file is independently tied to the corresponding clean copy.
const cleanSource=await fingerprint(path.join(dir,'clean-source-manifest.json'));
const copied=JSON.parse(await readFile(cleanSource.path,'utf8'));
assert.equal(copied.phase,'final-source-copy');assert.equal(normal(copied.sourceRoot),normal(root));assert.equal(normal(copied.targetRoot),normal(cleanRoot));
assert.equal(copied.fileCount,copied.files.length);
const copiedByPath=new Map<string,{path:string;sha256:string;bytes:number}>(copied.files.map((file:{path:string;sha256:string;bytes:number})=>[normal(file.path),file]));
for(const item of source){const entry=copiedByPath.get(item.path);assert.ok(entry,`Final clean source copy lacks ${item.path}`);assert.equal(entry.sha256,item.sha256);assert.equal(entry.bytes,item.bytes);const actual=await fingerprint(path.join(cleanRoot,item.path));assert.equal(actual.sha256,item.sha256);}

const declaredPackageManager=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).packageManager;
assert.equal(declaredPackageManager,'pnpm@11.25.0');
const actualPackageManager=execFileSync('corepack.cmd',['pnpm','--version'],{cwd:cleanRoot,encoding:'utf8',shell:true,windowsHide:true,timeout:30000}).trim();
assert.equal(actualPackageManager,'11.25.0','Check corepack pnpm, not the unrelated inherited pnpm.cmd11.19');
const packageExecutionFile=await fingerprint(path.join(dir,'package-manager-execution.json'));
const packageExecution=JSON.parse(await readFile(packageExecutionFile.path,'utf8'));
assert.equal(packageExecution.declared,declaredPackageManager);assert.equal(packageExecution.outerActual,actualPackageManager);assert.equal(packageExecution.nestedActual,actualPackageManager);
const lock=await fingerprint(path.join(root,'pnpm-lock.yaml'));assert.equal(packageExecution.unchangedLockSha.toLowerCase(),lock.sha256);

const ps="$taskPorts=@(4313,4314,4371,4372,4383,4384,4393,4394);$taskRows=foreach($taskPort in $taskPorts){$taskIds=@(Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique);foreach($taskId in $taskIds){$taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$taskId);@{port=$taskPort;pid=$taskId;processName=$taskProcess.Name;commandLine=$taskProcess.CommandLine}}};ConvertTo-Json -InputObject @($taskRows) -Compress";
const processes=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000})) as {port:number;pid:number;processName:string;commandLine:string}[];
function running(port:number,pid:string,file:string){
  const rows=processes.filter(process=>process.port===port);assert.equal(rows.length,1);assert.equal(rows[0]!.pid,Number(pid));
  assert.ok(normal(rows[0]!.commandLine).toLowerCase().includes(normal(file).toLowerCase()));
  // Verify raw command internally, store its hash and the checked entry path.
  // A newly appearing unrelated listener cannot leak command-line credentials.
  return {port,pid:Number(pid),processName:rows[0]!.processName,checkedEntryFile:normal(file),commandLineSha256:sha(rows[0]!.commandLine),entryPathAndPidVerified:true};
}
const cleanApi=await fingerprint(cleanFile),userApi=await fingerprint(userFile);
assert.equal(cleanApi.sha256,userApi.sha256,'User API differs from the checked current clean API');assert.notEqual(cleanApi.sha256,historicalSha,'C19 must remain historical, not masquerade as the correction build');
const cleanProcess=running(4393,cleanPid,cleanFile),userProcess=running(4371,userPid,userFile);
const ports=[4313,4314,4371,4372,4383,4384,4393,4394].map(port=>({port,listeners:processes.filter(row=>row.port===port).map(row=>({pid:row.pid,processName:row.processName,commandLineSha256:sha(row.commandLine),ownedWorkspacePathObserved:normal(row.commandLine).toLowerCase().includes(normal(root).toLowerCase())}))}));

// Only SELECTs inside a repeatable READ ONLY transaction; no migrations,
// sessions, fixture cleanup, configuration changes or protected database use.
const client=await pool.connect();let identity:any,migrations:any,counts:any;
try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  identity=(await client.query("select current_database() as database,inet_server_port() as port,current_setting('transaction_read_only') as read_only")).rows[0];
  assert.equal(identity.database,'signal_full_audit_a10_20261008');assert.equal(identity.port,5432);assert.equal(identity.read_only,'on');
  migrations=await client.query('select * from drizzle.__drizzle_migrations order by created_at');assert.equal(migrations.rows.length,15);
  counts=await client.query("select relname as table_name,n_live_tup::int as estimated_rows from pg_stat_user_tables where schemaname='public' and relname like 'signal_%' order by relname");
  await client.query('COMMIT');
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
const migrationFiles=[];for(const file of (await walk(path.join(root,'lib/db/migrations'))).filter(file=>file.endsWith('.sql')).sort())migrationFiles.push(await fingerprint(path.join(root,'lib/db/migrations',file)));
assert.equal(migrationFiles.length,15);
const frontendRoot=path.join(cleanRoot,'artifacts/fsp-signal/dist/public'),frontend=[];
for(const file of (await walkBuild(frontendRoot)).sort())frontend.push({...await fingerprint(path.join(frontendRoot,file)),relativePath:normal(file)});
assert.ok(frontend.some(file=>file.relativePath==='index.html'));
const apiBuildRoot=path.dirname(cleanFile),apiBuild=[];for(const file of (await walkBuild(apiBuildRoot)).sort())apiBuild.push({...await fingerprint(path.join(apiBuildRoot,file)),relativePath:normal(file)});
const historicalBundles=[];
for(const file of [path.join(historicalDir,'clean-workspace/artifacts/api-server/dist/index.mjs'),path.join(root,'outputs/runtime/ui-refinement-correction01-iteration07/dist/index.mjs')]){const item=await fingerprint(file);assert.equal(item.sha256,historicalSha);historicalBundles.push(item);}
const historicalManifests=[];for(const name of ['source-manifest.json','runtime-manifest.json','evidence-manifest.json'])historicalManifests.push(await fingerprint(path.join(historicalDir,name)));

const at=new Date().toISOString();
const runtime={at,stage:'correction-01-20261008',node:process.version,packageManagerDeclared:declaredPackageManager,packageManagerActual:`pnpm@${actualPackageManager}`,packageManagerCommand:'corepack pnpm --version',packageManagerExecutionReceipt:packageExecutionFile,
  cleanApi:{...cleanApi,...cleanProcess},userApi:{...userApi,...userProcess},ports,
  cleanDatabase:{host:database.hostname,externalPort:Number(database.port),internalPort:identity.port,name:identity.database,readOnlySnapshot:true,migrations:migrations.rows,tableCountsEstimated:counts.rows},migrationFiles,
  cleanSourceManifest:cleanSource,apiBuildFiles:apiBuild,frontendBuild:frontend,
  flags:{workspace:process.env.SIGNAL_WORKSPACE_ENABLED,modules:process.env.SIGNAL_SKILL_MODULES_ENABLED},origins:{publicUrl:process.env.PUBLIC_URL,cors:process.env.CORS_ORIGIN},
  historical:{scope:'Preserved prior A01-A11 result, not the current correction runtime or package manager execution',apiSha256:historicalSha,bundles:historicalBundles,manifests:historicalManifests,ports:[4383,4384]},
  limits:['Native clean install/build is not Docker Compose validation.','Historical c19 and negative receipts remain unchanged.','Actual correction build uses corepack pnpm11.25.0; historical host pnpm.cmd11.19.0 is not relabelled.','Own QA fixture rows remain in the isolated databases; table counts are estimates, not business-row preservation hashes.','Raw command lines and private env/credentials are not emitted; exact PID/path guards are checked internally.']};
await mkdir(dir,{recursive:true});
await writeFile(path.join(dir,'source-manifest.json'),JSON.stringify({at,stage:runtime.stage,root:normal(root),fileCount:source.length,cleanSourceManifest:cleanSource,files:source},null,2)+'\n',{flag:'wx'});
await writeFile(path.join(dir,'runtime-manifest.json'),JSON.stringify(runtime,null,2)+'\n',{flag:'wx'});
const evidence=[];
for(const file of (await walk(dir)).filter(file=>normal(file)!=='evidence-manifest.json').sort()){const item=await fingerprint(path.join(dir,file));evidence.push({...item,path:normal(file)});}
await writeFile(path.join(dir,'evidence-manifest.json'),JSON.stringify({at,stage:runtime.stage,files:evidence},null,2)+'\n',{flag:'wx'});
await pool.end();
console.log(JSON.stringify({sourceFiles:source.length,evidenceFiles:evidence.length,apiSha:cleanApi.sha256,migrations:migrations.rows.length,packageManager:`pnpm@${actualPackageManager}`,portsObserved:ports.map(port=>({port:port.port,listeners:port.listeners.length}))}));
