// Fixed-path delivery snapshot. No caller-supplied bundle, database or port.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const candidateRelative = 'outputs/verification/release-0.6.0/final-load-candidate.json';
const distRelative = 'artifacts/api-server/dist';
const requiredBuildInputs=['artifacts/api-server/build.mjs','artifacts/api-server/build-portability.mjs'];
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function assertCleanLoadNodeOptions(environment,execArguments=[]) {
  assert.ok(!environment.NODE_OPTIONS||environment.NODE_OPTIONS.trim()==='','Inherited Node options must be empty for the bounded load runtime');
  assert.ok(!execArguments.some(value=>/^--(?:inspect|prof|cpu-prof|heap-prof|import|require|loader|experimental-loader)(?:[=-]|$)/.test(value)),'Inspector, profiler or preload arguments are not allowed in the full load launcher');
}
function assertOwnedLoadProcess(expected,actual,listenerPid) {
  assert.ok(Number.isSafeInteger(expected?.Id)&&expected.Id>0);assert.equal(listenerPid,expected.Id,'Dedicated listener is not our stand');
  assert.equal(actual?.Id,expected.Id);assert.equal(actual.StartTime,expected.StartTime,'Manifest-owned PID was reused');assert.equal(actual.ProcessName,'node');
}
function inside(root, relative) {
  assert.equal(typeof relative, 'string');
  assert.ok(relative.length && !path.isAbsolute(relative) && !relative.includes('\\') && !relative.includes(':') && !relative.includes('\0'));
  assert.ok(relative.split('/').every(part=>part && part!=='.' && part!=='..'),'Only canonical root-relative snapshot paths are permitted');
  const resolved=path.resolve(root,relative), rel=path.relative(root,resolved);
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel),'Snapshot path must remain within the repository');
  if(fs.existsSync(resolved)) {
    const actualRelative=path.relative(fs.realpathSync(root),fs.realpathSync(resolved));
    assert.ok(actualRelative&&!actualRelative.startsWith('..')&&!path.isAbsolute(actualRelative),'Snapshot symlink must not leave the repository');
  }
  return resolved;
}
function readDeliveryCandidate(root, checkedSources) {
  const candidatePath=inside(root,candidateRelative), candidate=JSON.parse(fs.readFileSync(candidatePath,'utf8'));
  assert.equal(candidate.schemaVersion,1);assert.equal(candidate.applicationVersion,'0.6.0');
  assert.match(candidate.bundleSHA??'',/^[a-f0-9]{64}$/);
  const required=[...new Set([...checkedSources,...requiredBuildInputs])];
  assert.ok(candidate.sourceHashes && Object.keys(candidate.sourceHashes).length>=required.length,'A final build/source attestation is required');
  for(const relative of required) assert.match(candidate.sourceHashes[relative]??'',/^[a-f0-9]{64}$/,'Every checked load/build input must be attested');
  for(const [relative, expected] of Object.entries(candidate.sourceHashes)) {
    assert.match(expected,/^[a-f0-9]{64}$/);assert.equal(sha(inside(root,relative)),expected,'Source differs from the final delivery candidate');
  }
  assert.equal(sha(inside(root,`${distRelative}/index.mjs`)),candidate.bundleSHA,'Normal delivery bundle differs from the accepted candidate');
  assert.ok(candidate.distFiles && !Array.isArray(candidate.distFiles));
  for(const [name,expected]of Object.entries(candidate.distFiles)) {
    assert.ok(/^[A-Za-z0-9._-]+\.(mjs|map|json)$/.test(name));assert.match(expected,/^[a-f0-9]{64}$/);
    assert.equal(sha(inside(root,`${distRelative}/${name}`)),expected,'Normal delivery asset differs from the accepted candidate');
  }
  assert.deepEqual(fs.readdirSync(inside(root,distRelative)).sort(),Object.keys(candidate.distFiles).sort(),'The complete normal dist set must be attested');
  return {candidatePath,candidateManifestSha256:sha(candidatePath),candidate};
}
function copyDeliverySnapshot(root,runtime,attestation) {
  const ownedRelative=path.relative(path.resolve(root,'artifacts/api-server/.load-runtime'),runtime);
  assert.ok(/^[a-f0-9]{12}$/.test(ownedRelative),'Only a newly owned exact runtime directory is permitted');
  const source=inside(root,distRelative), destination=path.join(runtime,'server');
  assert.ok(!fs.existsSync(destination),'Never overwrite an existing delivery snapshot');
  const entries=fs.readdirSync(source,{withFileTypes:true});
  assert.deepEqual(entries.map(entry=>entry.name).sort(),Object.keys(attestation.candidate.distFiles).sort());
  assert.ok(entries.length>0&&entries.length<=64);
  const required=['index.mjs','index.mjs.map','pino-file.mjs','pino-pretty.mjs','pino-worker.mjs','thread-stream-worker.mjs','quality-public-report.json'];
  for(const name of required)assert.ok(entries.some(entry=>entry.name===name),'Normal dist must include its adjacent workers/maps/public aggregate');
  fs.mkdirSync(destination);
  const deliveryFiles={};
  for(const entry of entries) {
    assert.ok(entry.isFile()&&!entry.isSymbolicLink()&&/^[A-Za-z0-9._-]+\.(mjs|map|json)$/.test(entry.name),'Only normal flat dist assets may be copied');
    const input=path.join(source,entry.name),output=path.join(destination,entry.name), before=sha(input);
    assert.equal(before,attestation.candidate.distFiles[entry.name],'Delivery changed after attestation read');
    assert.ok(fs.statSync(input).size<=32*1024*1024,'Unexpected delivery asset size');
    fs.copyFileSync(input,output);assert.equal(sha(output),before);assert.equal(sha(input),before,'Delivery asset changed during copy');
    deliveryFiles[entry.name]=before;
  }
  assert.equal(deliveryFiles['index.mjs'],attestation.candidate.bundleSHA);
  assert.equal(sha(attestation.candidatePath),attestation.candidateManifestSha256,'Candidate attestation changed during snapshot');
  assert.deepEqual(fs.readdirSync(source).sort(),Object.keys(deliveryFiles).sort(),'Dist set changed during snapshot');
  for(const [relative,expected]of Object.entries(attestation.candidate.sourceHashes))assert.equal(sha(inside(root,relative)),expected,'Accepted sources changed during delivery copy');
  return {apiPath:path.join(destination,'index.mjs'),deliveryFiles,candidateManifestPath:attestation.candidatePath,candidateManifestSha256:attestation.candidateManifestSha256};
}
function assertDeliverySnapshot(runtime,root) {
  if(runtime.runtimeKind!=='normal-delivery')return;
  assert.equal(path.basename(runtime.apiPath),'index.mjs');
  assert.equal(path.basename(path.dirname(runtime.apiPath)),'server');
  assert.match(runtime.candidateManifestSha256??'',/^[a-f0-9]{64}$/);
  for(const [name,expected]of Object.entries(runtime.deliveryFiles??{})) {
    assert.ok(/^[A-Za-z0-9._-]+\.(mjs|map|json)$/.test(name));
    assert.equal(sha(path.join(path.dirname(runtime.apiPath),name)),expected,'Frozen delivery asset changed');
  }
  assert.deepEqual(fs.readdirSync(path.dirname(runtime.apiPath)).sort(),Object.keys(runtime.deliveryFiles).sort(),'Frozen delivery asset set changed');
  assert.equal(runtime.deliveryFiles?.['index.mjs'],runtime.apiSha256);
  if(root) {
    const current=readDeliveryCandidate(root,Object.keys(runtime.sourceHashes));
    assert.equal(runtime.candidateManifestPath,current.candidatePath);
    assert.equal(runtime.candidateManifestSha256,current.candidateManifestSha256,'Frozen runtime differs from the accepted final candidate');
    assert.deepEqual(runtime.sourceHashes,current.candidate.sourceHashes);
    assert.deepEqual(runtime.deliveryFiles,current.candidate.distFiles);
  }
}
module.exports={candidateRelative,readDeliveryCandidate,copyDeliverySnapshot,assertDeliverySnapshot,assertCleanLoadNodeOptions,assertOwnedLoadProcess};
