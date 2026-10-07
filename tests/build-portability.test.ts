import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {relocatePinoWorkerBase,portablePinoPlugin} from '../artifacts/api-server/build-portability.mjs';
const requireApi=createRequire(path.resolve('artifacts/api-server/package.json'));
const {build}=requireApi('esbuild');

test('Pino worker helper removes only its build-specific base and rejects unexpected upstream shape',()=>{
  const source=(literal:string)=>`function pinoBundlerAbsolutePath(p) { const outputDir = ${literal}; return path.resolve(outputDir,p); }\nconst untouched = "C:\\\\keep\\\\other";`;
  assert.equal(relocatePinoWorkerBase(source('"C:\\\\Windows\\\\dist"')),relocatePinoWorkerBase(source('"/app/dist"')));
  assert.ok(relocatePinoWorkerBase(source('"/app/dist"')).includes('const untouched = "C:\\\\keep\\\\other"'));
  assert.throws(()=>relocatePinoWorkerBase('const outputDir="absent helper";'),/exactly one/);
  assert.throws(()=>relocatePinoWorkerBase(source('"/app/dist"')+'\nconst outputDir = "/second/dist";'),/exactly one/);
  assert.throws(()=>relocatePinoWorkerBase(source('"/app/dist"')+'\nfunction pinoBundlerAbsolutePath(p) {}'),/exactly one/);
});

test('Actual Pino worker uses byte-stable bundles after relocation and a different runtime cwd',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'signal-pino-portability-'));
  try {
    const entry=path.join(temporary,'entry.mjs');
    fs.writeFileSync(entry,`import pino from 'pino';
const transport=pino.transport({target:'pino/file',options:{destination:process.argv[2],sync:false}});
transport.on('error',error=>{console.error(error.message);process.exitCode=1;});
transport.on('ready',()=>{const logger=pino(transport);logger.info({portabilityWitness:'actual-relocated-worker'},'relocation');logger.flush(()=>transport.end());});
`);
    const banner=`import {createRequire as cr} from 'node:module';import path from 'node:path';import {fileURLToPath} from 'node:url';globalThis.require=cr(import.meta.url);globalThis.__filename=fileURLToPath(import.meta.url);globalThis.__dirname=path.dirname(globalThis.__filename);`;
    const first=path.join(temporary,'build-a'),second=path.join(temporary,'build-b');
    for(const output of [first,second])await build({entryPoints:{index:entry},absWorkingDir:temporary,outdir:output,platform:'node',format:'esm',bundle:true,outExtension:{'.js':'.mjs'},external:['supports-color'],alias:{pino:requireApi.resolve('pino')},plugins:[portablePinoPlugin({transports:['pino-pretty']})],banner:{js:banner},logLevel:'silent'});
    const files=fs.readdirSync(first).sort();assert.deepEqual(files,fs.readdirSync(second).sort());
    for(const name of files){assert.deepEqual(fs.readFileSync(path.join(first,name)),fs.readFileSync(path.join(second,name)));assert.ok(!fs.readFileSync(path.join(first,name),'utf8').includes(first));}
    assert.ok(files.includes('pino-worker.mjs'));assert.ok(files.includes('thread-stream-worker.mjs'));
    const moved=path.join(temporary,'relocated','server'),cwd=path.join(temporary,'unrelated-cwd');fs.mkdirSync(path.dirname(moved));fs.mkdirSync(cwd);fs.renameSync(first,moved);fs.rmSync(second,{recursive:true});
    const log=path.join(temporary,'worker-output.jsonl');
    const child=spawnSync(process.execPath,[path.join(moved,'index.mjs'),log],{cwd,encoding:'utf8',timeout:15000,windowsHide:true});
    assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
    const lines=fs.readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.ok(lines.some(row=>row.portabilityWitness==='actual-relocated-worker'));
    assert.equal(fs.existsSync(first),false);assert.equal(fs.existsSync(second),false);
  }finally{
    assert.ok(path.resolve(temporary).startsWith(path.join(os.tmpdir(),'signal-pino-portability-')));fs.rmSync(temporary,{recursive:true,force:true});
  }
});
