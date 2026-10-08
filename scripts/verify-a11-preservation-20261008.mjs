import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const sha=b=>createHash('sha256').update(b).digest('hex');
const root=process.cwd();assert.ok(root.replaceAll('\\','/').endsWith('/signal-ui-refinement-workspace-20261008'));
const checks=[];
async function check(file,expected,scope){let actual=null;try{actual=sha(await readFile(file));}catch(error){if(error.code!=='ENOENT')throw error;}checks.push({scope,path:file.replaceAll('\\','/'),expected,actual,matched:actual===expected});}
const protectedRecord=JSON.parse(await readFile('outputs/verification/ui-refinement-correction01-20261008/protected-readback/protected-source-774.json','utf8'));
for(const row of protectedRecord.rows)await check(path.join(protectedRecord.originalProject,row.path),row.acceptedSha256,'protected-source');
for(const stage of ['ui-refinement-20261008','ui-refinement-correction01-20261008']) {
 const prefix=`outputs/verification/${stage}/final-provenance/`;
 const artifact=JSON.parse(await readFile(prefix+'artifact-manifest.json','utf8'));
 for(const kind of ['api','frontendBuild'])for(const row of artifact[kind].files)await check(path.join(artifact[kind].root,row.path),row.sha256,stage+'/'+kind);
 const receipt=JSON.parse(await readFile(prefix+'receipt.json','utf8'));
 const evidence=stage==='ui-refinement-20261008'?receipt.evidence:(JSON.parse(await readFile(prefix+'evidence-manifest.json','utf8'))).files;
 for(const row of evidence)await check(path.join(root,row.path),row.sha256,stage+'/evidence');
 for(const row of receipt.manifests)await check(path.join(root,row.path),row.sha256,stage+'/manifest');
}
await check(path.join(root,'outputs/runtime/ui-refinement-correction01-iteration05/dist/index.mjs'),'2a47de3b721017bace820c989d7e483df76262c48c3358f1a49dcd09fb029edf','immutable-api05');
const historicalMutableFrontend=checks.filter(r=>!r.matched&&r.scope.endsWith('/frontendBuild'));
const report={at:new Date().toISOString(),checked:checks.length,failures:checks.filter(r=>!r.matched&&!r.scope.endsWith('/frontendBuild')),historicalMutableFrontend,limitations:['Two historical frontend manifests point to the same mutable artifacts/fsp-signal/dist/public. Their old chunks were already unavailable before this audit first build; independent audit likewise checked historical API/evidence/manifests, not old shared frontend dist. Current clean build uses its own directory. Historical records remain unchanged; missing old chunks are not reconstructed or represented as preserved.'],checks};
await writeFile('outputs/verification/full-audit-a01-a11-20261008/preservation.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checked:report.checked,failures:report.failures,historicalMutableFrontendDifferences:historicalMutableFrontend.length}));assert.equal(report.failures.length,0);
