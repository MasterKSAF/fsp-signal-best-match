/** Sequential current-release checks. Docker HTTP and isolated local harnesses
 * are recorded separately. This never seals/repackages a source archive. */
import { spawn,execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,readdir,copyFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
process.chdir(root);
const pwsh=process.env.SIGNAL_PWSH_EXE||'pwsh';
const verification='outputs/verification',container='fsp-signal-app-1';
await mkdir(`${verification}/history`,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
const fileSha=async file=>sha(await readFile(file));
async function allSource(folder) {
  return (await Promise.all((await readdir(folder,{withFileTypes:true})).map(entry=>entry.isDirectory()?allSource(`${folder}/${entry.name}`):[`${folder}/${entry.name}`]))).flat();
}
// Competitive evaluator is a local diagnostic CLI/test module, never imported
// by app.ts/routes or the production matcher. Its newer source is checked by
// unit/evaluation, not falsely presented as deployed Docker byte equality.
const diagnosticOnlyPaths=['artifacts/api-server/src/lib/matching-competitive-quality.ts'];
const sourcePaths=[...(await allSource('artifacts/api-server/src')),...(await allSource('lib/db/src')),'pnpm-lock.yaml','lib/api-spec/openapi.yaml'].filter(file=>!diagnosticOnlyPaths.includes(file)).sort();
const localSourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async file=>[file,await fileSha(file)])));
const localDiagnosticHashes=Object.fromEntries(await Promise.all(diagnosticOnlyPaths.map(async file=>[file,await fileSha(file)])));
function identity() {
  const image=execFileSync('docker',['inspect',container,'--format','{{.Image}}'],{encoding:'utf8'}).trim();
  const containerId=execFileSync('docker',['inspect',container,'--format','{{.Id}}'],{encoding:'utf8'}).trim();
  const script=`const fs=require('fs'),c=require('crypto'); console.log(JSON.stringify(Object.fromEntries(${JSON.stringify([...sourcePaths,...diagnosticOnlyPaths])}.map(p=>[p,c.createHash('sha256').update(fs.readFileSync('/app/'+p)).digest('hex')]))));`;
  const allHashes=JSON.parse(execFileSync('docker',['exec',container,'node','-e',script],{encoding:'utf8'}));
  const sourceHashes=Object.fromEntries(sourcePaths.map(file=>[file,allHashes[file]]));
  const diagnosticHashes=Object.fromEntries(diagnosticOnlyPaths.map(file=>[file,allHashes[file]]));
  const differences=sourcePaths.filter(file=>sourceHashes[file]!==localSourceHashes[file]);
  assert.equal(differences.length,0,`Actual production source drift: ${differences.join(', ')}`);
  return {command:`docker inspect --format '{{.Image}}' ${container}`,image,containerId,sourceHashes,diagnosticHashes};
}
const before=identity(),runs=[],started=Date.now();
const apiOrigin='http://127.0.0.1:4310';
const programs=await (await fetch(`${apiOrigin}/api/assessments/programs`)).json();
const programVersions=Object.fromEntries(programs.map(program=>[program.id,program.version]));
for(const file of ['integration.json','opportunities-integration.json','research-http.json']) {
  try {const data=await readFile(`${verification}/${file}`);await copyFile(`${verification}/${file}`,`${verification}/history/${file.replace('.json','')}-${sha(data).slice(0,12)}.json`);}catch(error){if(error.code!=='ENOENT')throw error;}
}
const environment={...process.env,INTEGRATION_API_ORIGIN:apiOrigin,INTEGRATION_APP_ORIGIN:apiOrigin,INTEGRATION_MAILPIT_ORIGIN:'http://127.0.0.1:8026'};
async function run(name,command,scope,details={}) {
  console.log(`RUN ${name}`);const start=Date.now();
  const child=spawn(pwsh,['-NoLogo','-NoProfile','-Command',command],{cwd:root,env:environment,windowsHide:true});
  let output='';child.stdout.on('data',chunk=>output+=chunk.toString());child.stderr.on('data',chunk=>output+=chunk.toString());
  const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  const evidence=`${verification}/${name}-refinement.log`;await writeFile(evidence,output);
  const summary={name,command,scope,exitCode,passed:exitCode===0,durationMs:Date.now()-start,durationBasis:'Wall clock around a full child PowerShell 7 command',evidence,...details};
  if(name==='unit') {
    const last=expression=>[...output.matchAll(expression)].at(-1)?.[1];
    summary.tests=Number(last(/(?:ℹ|#) tests (\d+)/g));summary.passedTests=Number(last(/(?:ℹ|#) pass (\d+)/g));summary.failedTests=Number(last(/(?:ℹ|#) fail (\d+)/g));
    assert.ok(Number.isSafeInteger(summary.tests)&&summary.tests>0,'Unit count missing in actual Node output');
  }
  runs.push(summary);console.log(`${exitCode===0?'PASS':'FAIL'} ${name}${summary.tests?' '+summary.tests+' tests':''}`);
  assert.equal(exitCode,0,`${name} failed; inspect excluded local log ${evidence}`);return summary;
}
let after=null,passed=false,failure=null;
try {
  await run('unit','pnpm test','Current source Node test runner; not Docker');
  await run('typecheck','pnpm typecheck','Current workspace TypeScript library/app checks; not Docker');
  await run('core-http','node --env-file-if-exists=.env --import tsx scripts/integration-test.ts','Actual Docker HTTP + local PostgreSQL/Mailpit; scoped synthetic fixtures',{report:`${verification}/integration.json`,expectedGroups:23});
  await run('opportunities-http','node --env-file-if-exists=.env --import tsx scripts/opportunities-integration.ts','Actual Docker routes plus locally invoked scheduler using real DB and scoped candidate IDs',{report:`${verification}/opportunities-integration.json`,expectedGroups:12});
  await run('research-local','node --env-file-if-exists=.env --import tsx scripts/research-integration.ts','Separate research router on ephemeral loopback HTTP, real sessions/PostgreSQL; NOT Docker; no humans',{report:`${verification}/research-http.json`,expectedGroups:7});
  await run('production-isolation','node --env-file-if-exists=.env --import tsx scripts/production-smoke.ts','Separate app.ts server on ephemeral loopback in production with Demo disabled; NOT Docker',{checks:4});
  after=identity();assert.deepEqual(after,before,'Actual served image/container/source changed during checks');passed=true;
}catch(error){failure={message:error.message};}
const reportFile=async file=>{const data=JSON.parse(await readFile(file,'utf8'));return {file,sha256:await fileSha(file),generatedAt:data.generatedAt,passed:data.passed,groups:Array.isArray(data.groups)?data.groups.length:data.groups,checks:data.checks??data.groups};};
const local={generatedAt:new Date().toISOString(),passed,failure,version:'signal-refinement-2026-10-06',localDate:'2026-10-06',environment:'Windows, PowerShell 7, local Node/pnpm/PostgreSQL',docker:false,currentDockerImageReference:before.image,programVersions,commands:runs.filter(run=>!['core-http','opportunities-http'].includes(run.name)),sourceHashes:localSourceHashes,localDiagnosticHashes,sourceHashScope:'Production API/DB/schema/lock sources; offline competitive evaluator explicitly separated; frontend may receive CSS changes independently and requires root final build/UI protocol',durationMs:Date.now()-started,cleanup:'Every executed HTTP harness cleans exact synthetic IDs in its own finally; ephemeral listeners/pool closed. No working account reset or mails outside local Mailpit.'};
await writeFile(`${verification}/final-tests-local-refinement.json`,JSON.stringify(local,null,2));
const http={generatedAt:new Date().toISOString(),passed,failure,version:'signal-refinement-2026-10-06',localDate:'2026-10-06',image:before.image,apiOrigin,appOrigin:apiOrigin,programVersions,dockerBefore:before,dockerAfter:after,sourceHashes:localSourceHashes,executions:runs.filter(run=>['core-http','opportunities-http'].includes(run.name)),dockerSuites:[],isolatedResearchSuite:null,operatorCliSuite:null,distinctDockerScenarioGroups:0,distinctMainHttpScenarioGroups:0,operatorCliScenarioGroups:0,provenance:'Docker business routes and source equality are separate from ephemeral research and production app.ts configurations; synthetic fixtures only, not user research. Scheduler assertions invoke the local module against the same PostgreSQL, not an external production scheduler.'};
if(passed) {
  for(const file of ['integration.json','opportunities-integration.json','matching-v3-http.json','assessment-managed-http.json'])http.dockerSuites.push(await reportFile(`${verification}/${file}`));
  http.isolatedResearchSuite=await reportFile(`${verification}/research-http.json`);
  http.operatorCliSuite=await reportFile(`${verification}/pilot-cli-http.json`);
  assert.ok(http.dockerSuites.every(suite=>suite.passed)&&http.isolatedResearchSuite.passed&&http.operatorCliSuite.passed);
  http.distinctDockerScenarioGroups=http.dockerSuites.reduce((sum,suite)=>sum+suite.groups,0);
  http.distinctMainHttpScenarioGroups=http.distinctDockerScenarioGroups+http.isolatedResearchSuite.groups;
  http.operatorCliScenarioGroups=http.operatorCliSuite.groups;
  http.reusedExactInputChecks={matching:'5 groups already run by root on the same stable 57cf Docker backend; input hashes equal actual served source',managed:'10 groups already run with before/after image and source attestation in assessment-managed-http.json',operatorCli:'4 independent CLI mechanics groups on current API source in ephemeral harness; reported separately rather than counted twice as research security checks'};
}
await writeFile(`${verification}/final-http-refinement.json`,JSON.stringify(http,null,2));
console.log(JSON.stringify({passed,unitTests:local.commands.find(command=>command.name==='unit')?.tests,dockerGroups:http.distinctDockerScenarioGroups,mainHttpGroups:http.distinctMainHttpScenarioGroups,operatorCliGroups:http.operatorCliScenarioGroups,image:before.image}));
if(!passed)process.exitCode=1;
