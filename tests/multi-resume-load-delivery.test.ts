import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {candidateRelative,readDeliveryCandidate,copyDeliverySnapshot,assertDeliverySnapshot}=createRequire(import.meta.url)('../scripts/lib/multi-resume-load-delivery.cjs');
const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'signal-load-delivery-tests-'));
  const dist=path.join(root,'artifacts/api-server/dist');fs.mkdirSync(dist,{recursive:true});
  const files=['index.mjs','index.mjs.map','pino-file.mjs','pino-file.mjs.map','pino-pretty.mjs','pino-pretty.mjs.map','pino-worker.mjs','pino-worker.mjs.map','thread-stream-worker.mjs','thread-stream-worker.mjs.map','quality-public-report.json'];
  for(const name of files)fs.writeFileSync(path.join(dist,name),Buffer.from(`exact original ${name}\r\nРусский🙂\n`));
  const source='artifacts/api-server/src/index.ts';fs.mkdirSync(path.dirname(path.join(root,source)),{recursive:true});fs.writeFileSync(path.join(root,source),'source');
  const buildInputs=['artifacts/api-server/build.mjs','artifacts/api-server/build-portability.mjs'];
  for(const relative of buildInputs)fs.writeFileSync(path.join(root,relative),relative);
  const candidate={schemaVersion:1,applicationVersion:'0.5.0',bundleSHA:hash(path.join(dist,'index.mjs')),sourceHashes:Object.fromEntries([source,...buildInputs].map(relative=>[relative,hash(path.join(root,relative))])),distFiles:Object.fromEntries(files.sort().map(name=>[name,hash(path.join(dist,name))]))};
  const candidatePath=path.join(root,candidateRelative);fs.mkdirSync(path.dirname(candidatePath),{recursive:true});
  const write=()=>fs.writeFileSync(candidatePath,JSON.stringify(candidate));write();
  const runtime=path.join(root,'artifacts/api-server/.load-runtime/aabbccddeeff');fs.mkdirSync(runtime,{recursive:true});
  const cleanup=()=>{assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'signal-load-delivery-tests-')));fs.rmSync(root,{recursive:true,force:true});};
  return {root,dist,source,candidate,candidatePath,write,runtime,cleanup};
}
test('delivery snapshot copies exact normal bundle, all adjacent assets and accepted source identity',()=>{
  const f=fixture();try {
    const accepted=readDeliveryCandidate(f.root,[f.source]);const copied=copyDeliverySnapshot(f.root,f.runtime,accepted);
    assert.equal(hash(copied.apiPath),f.candidate.bundleSHA);assert.deepEqual(copied.deliveryFiles,f.candidate.distFiles);
    for(const name of Object.keys(copied.deliveryFiles))assert.deepEqual(fs.readFileSync(path.join(f.runtime,'server',name)),fs.readFileSync(path.join(f.dist,name)));
    assertDeliverySnapshot({runtimeKind:'normal-delivery',...copied,sourceHashes:f.candidate.sourceHashes,apiSha256:f.candidate.bundleSHA},f.root);
    assert.throws(()=>copyDeliverySnapshot(f.root,f.runtime,accepted),/Never overwrite/);
  }finally{f.cleanup();}
});
test('delivery attestation rejects stale source, stale normal bundle, invalid schema and missing checked source',()=>{
  const f=fixture();try {
    assert.throws(()=>readDeliveryCandidate(f.root,['missing.ts']),/attestation|attested/);
    const portabilityHash=f.candidate.sourceHashes['artifacts/api-server/build-portability.mjs'];delete f.candidate.sourceHashes['artifacts/api-server/build-portability.mjs'];f.write();assert.throws(()=>readDeliveryCandidate(f.root,[f.source]),/attestation|attested/);f.candidate.sourceHashes['artifacts/api-server/build-portability.mjs']=portabilityHash;f.write();
    fs.appendFileSync(path.join(f.root,'artifacts/api-server/build-portability.mjs'),'drift');assert.throws(()=>readDeliveryCandidate(f.root,[f.source]),/Source differs/);fs.writeFileSync(path.join(f.root,'artifacts/api-server/build-portability.mjs'),'artifacts/api-server/build-portability.mjs');
    fs.writeFileSync(path.join(f.root,f.source),'changed');assert.throws(()=>readDeliveryCandidate(f.root,[f.source]),/Source differs/);fs.writeFileSync(path.join(f.root,f.source),'source');
    fs.appendFileSync(path.join(f.dist,'index.mjs'),'changed');assert.throws(()=>readDeliveryCandidate(f.root,[f.source]),/Normal delivery bundle/);
    f.candidate.schemaVersion=2;f.write();assert.throws(()=>readDeliveryCandidate(f.root,[f.source]));
  }finally{f.cleanup();}
});
test('delivery attestation rejects path traversal, absolute paths and incomplete dist inventory',()=>{
  const f=fixture();try {
    for(const unsafe of ['../outside.ts','artifacts/../outside.ts','C:/outside.ts','artifacts\\outside.ts']) {
      (f.candidate.sourceHashes as Record<string,string>)[unsafe]='a'.repeat(64);f.write();assert.throws(()=>readDeliveryCandidate(f.root,[f.source]));delete (f.candidate.sourceHashes as Record<string,string>)[unsafe];
    }
    f.write();fs.writeFileSync(path.join(f.dist,'unexpected.json'),'extra');assert.throws(()=>readDeliveryCandidate(f.root,[f.source]),/complete normal dist/);
  }finally{f.cleanup();}
});
test('copy refuses changes after attestation and unexpected nested dist directories',()=>{
  const f=fixture();try {
    const accepted=readDeliveryCandidate(f.root,[f.source]);fs.appendFileSync(path.join(f.dist,'pino-worker.mjs'),'race');
    assert.throws(()=>copyDeliverySnapshot(f.root,f.runtime,accepted),/changed after attestation/);
    fs.mkdirSync(path.join(f.dist,'nested'));assert.throws(()=>readDeliveryCandidate(f.root,[f.source]));
    assert.throws(()=>copyDeliverySnapshot(f.root,path.join(f.root,'outside'),accepted),/owned exact runtime/);
  }finally{f.cleanup();}
});
test('frozen delivery identity rejects modified assets, extra files and later candidate reassignment',()=>{
  const f=fixture();try {
    const accepted=readDeliveryCandidate(f.root,[f.source]),copied=copyDeliverySnapshot(f.root,f.runtime,accepted);
    const runtime={runtimeKind:'normal-delivery',...copied,sourceHashes:f.candidate.sourceHashes,apiSha256:f.candidate.bundleSHA};
    fs.appendFileSync(path.join(f.runtime,'server','pino-worker.mjs'),'changed');assert.throws(()=>assertDeliverySnapshot(runtime,f.root),/asset changed/);
    fs.copyFileSync(path.join(f.dist,'pino-worker.mjs'),path.join(f.runtime,'server','pino-worker.mjs'));
    fs.writeFileSync(path.join(f.runtime,'server','extra.json'),'extra');assert.throws(()=>assertDeliverySnapshot(runtime,f.root),/asset set changed/);fs.unlinkSync(path.join(f.runtime,'server','extra.json'));
    (f.candidate as unknown as Record<string,unknown>).builtAt='another candidate';f.write();assert.throws(()=>assertDeliverySnapshot(runtime,f.root),/accepted final candidate/);
  }finally{f.cleanup();}
});
