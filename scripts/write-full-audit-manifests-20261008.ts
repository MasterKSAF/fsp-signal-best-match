import assert from 'node:assert/strict';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pool} from '../lib/db/src/index';
const root=process.cwd();assert.ok(root.replaceAll('\\','/').endsWith('/signal-ui-refinement-workspace-20261008'));
const dir=path.join(root,'outputs/verification/full-audit-a01-a11-20261008');
const [cleanBundle,cleanPid,uiBundle,uiPid]=process.argv.slice(2);assert.ok(cleanBundle&&uiBundle);assert.match(cleanPid,/^\d+$/);assert.match(uiPid,/^\d+$/);
const database=new URL(process.env.DATABASE_URL!);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_full_audit_a10_20261008');
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function fingerprint(file:string){const bytes=await readFile(file);return {path:file,sha256:sha(bytes),bytes:bytes.length};}
async function walk(base:string,relative=''):Promise<string[]>{const files:string[]=[];for(const e of await readdir(path.join(base,relative),{withFileTypes:true})){if(['node_modules','dist','.git','clean-workspace'].includes(e.name)||e.name.endsWith('.tsbuildinfo'))continue;const n=path.join(relative,e.name);if(e.isDirectory())files.push(...await walk(base,n));else if(e.isFile())files.push(n);}return files;}
const sourceFiles:string[]=[];for(const d of ['artifacts','lib','scripts','tests','docs'])for(const f of await walk(path.join(root,d)))sourceFiles.push(path.join(d,f));
for(const f of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','.npmrc','.env.example','README.md','LICENSE','Dockerfile','compose.yaml','.dockerignore','.gitattributes','.gitignore'])try{await readFile(path.join(root,f));sourceFiles.push(f);}catch(e:any){if(e.code!=='ENOENT')throw e;}
const source=[];for(const f of [...new Set(sourceFiles)].sort()){const item=await fingerprint(path.join(root,f));source.push({...item,path:f.replaceAll('\\','/')});}
const ps="$taskPorts = @(4313,4314,4371,4372,4383,4384); $taskRows = foreach ($taskPort in $taskPorts) { $taskIds = @(Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); foreach ($taskId in $taskIds) { $taskProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $taskId); @{port=$taskPort;pid=$taskId;commandLine=$taskProcess.CommandLine} } }; $taskRows | ConvertTo-Json -Compress";
const processes=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8'}));
function running(port:number,pid:string,file:string){const p=processes.filter((r:any)=>r.port===port);assert.equal(p.length,1);assert.equal(p[0].pid,Number(pid));assert.ok(p[0].commandLine.replaceAll('\\','/').toLowerCase().includes(file.replaceAll('\\','/').toLowerCase()));return p[0];}
const cleanApi=await fingerprint(cleanBundle),userApi=await fingerprint(uiBundle);assert.equal(cleanApi.sha256,userApi.sha256,'User API differs from actually checked clean API');
const migrations=await pool.query('select * from drizzle.__drizzle_migrations order by created_at');
assert.equal(migrations.rows.length,15);
const migrationFiles=[];for(const f of (await walk(path.join(root,'lib/db/migrations'))).filter(f=>f.endsWith('.sql')).sort())migrationFiles.push(await fingerprint(path.join(root,'lib/db/migrations',f)));
const counts=await pool.query("select relname as table_name,n_live_tup::int as estimated_rows from pg_stat_user_tables where schemaname='public' and relname like 'signal_%' order by relname");
const buildRoot=path.join(dir,'clean-workspace/artifacts/fsp-signal/dist/public');
async function walkBuild(relative=''):Promise<string[]>{const out:string[]=[];for(const e of await readdir(path.join(buildRoot,relative),{withFileTypes:true})){const n=path.join(relative,e.name);if(e.isDirectory())out.push(...await walkBuild(n));else if(e.isFile())out.push(n);}return out;}
const frontend=[];for(const f of (await walkBuild()).sort())frontend.push(await fingerprint(path.join(buildRoot,f)));
const runtime={at:new Date().toISOString(),node:process.version,packageManagerActual:execFileSync('pnpm.cmd',['--version'],{encoding:'utf8',shell:true}).trim(),cleanApi:{...cleanApi,...running(4383,cleanPid,cleanBundle)},userApi:{...userApi,...running(4371,uiPid,uiBundle)},processes,cleanDatabase:{host:database.hostname,port:database.port,name:database.pathname.slice(1),migrations:migrations.rows,tableCountsEstimated:counts.rows},migrationFiles,frontendBuild:frontend,flags:{workspace:process.env.SIGNAL_WORKSPACE_ENABLED,modules:process.env.SIGNAL_SKILL_MODULES_ENABLED},origins:{publicUrl:process.env.PUBLIC_URL,cors:process.env.CORS_ORIGIN},limits:['Native fresh install/build, not Docker Compose validation.','QA fixture ledgers contain only own marked records and remain in the isolated databases.','Runtime process commands contain only file paths; credentials are in private env files.']};
await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'source-manifest.json'),JSON.stringify({at:runtime.at,root,fileCount:source.length,files:source},null,2)+'\n',{flag:'wx'});await writeFile(path.join(dir,'runtime-manifest.json'),JSON.stringify(runtime,null,2)+'\n',{flag:'wx'});
const evidence=[];for(const f of (await walk(dir)).filter(f=>!f.endsWith('evidence-manifest.json')).sort()){const item=await fingerprint(path.join(dir,f));evidence.push({...item,path:f.replaceAll('\\','/')});}
await writeFile(path.join(dir,'evidence-manifest.json'),JSON.stringify({at:runtime.at,files:evidence},null,2)+'\n',{flag:'wx'});
await pool.end();console.log(JSON.stringify({sourceFiles:source.length,evidenceFiles:evidence.length,apiSha:cleanApi.sha256,migrations:migrations.rows.length}));
