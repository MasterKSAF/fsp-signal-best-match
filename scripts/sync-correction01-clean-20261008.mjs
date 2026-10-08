import {readdir,readFile,copyFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
assert.ok(root.replaceAll('\\','/').endsWith('/signal-ui-refinement-workspace-20261008'));
const evidence='outputs/verification/correction-01-20261008';
const target=path.join(root,evidence,'clean-workspace');
const bootstrap=process.argv.includes('--bootstrap');
const files=[];
async function walk(relative){
  for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
    if(['node_modules','dist','.git','clean-workspace'].includes(item.name)||item.name.endsWith('.tsbuildinfo'))continue;
    const next=relative+'/'+item.name;
    if(next===evidence+'/clean-source-manifest.json'||next===evidence+'/dependency-bootstrap-manifest.json')continue;
    if(item.isDirectory())await walk(next);else if(item.isFile())files.push(next);
  }
}
for(const d of ['artifacts','lib','scripts','tests','docs','outputs/quality','outputs/verification/history'])await walk(d);
if(!bootstrap){await mkdir(path.join(root,evidence),{recursive:true});await walk('outputs/verification/full-audit-a01-a11-20261008');await walk(evidence);}
files.push('outputs/verification/multi-resume/load-comparison-cf5f76e84655.json');
for(const name of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','.npmrc','.env.example','README.md','LICENSE','Dockerfile','compose.yaml','.dockerignore','.gitattributes','.gitignore']){
  try{await readFile(path.join(root,name));files.push(name);}catch(error){if(error.code!=='ENOENT')throw error;}
}
const manifest=[];
for(const relative of [...new Set(files)].sort()){
  const bytes=await readFile(path.join(root,relative));
  await mkdir(path.dirname(path.join(target,relative)),{recursive:true});
  await copyFile(path.join(root,relative),path.join(target,relative));
  assert.ok(bytes.equals(await readFile(path.join(target,relative))));
  manifest.push({path:relative,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
}
await mkdir(path.join(root,evidence),{recursive:true});
await writeFile(path.join(root,evidence,bootstrap?'dependency-bootstrap-manifest.json':'clean-source-manifest.json'),JSON.stringify({at:new Date().toISOString(),phase:bootstrap?'dependency-bootstrap-not-final-source':'final-source-copy',sourceRoot:root,targetRoot:target,fileCount:manifest.length,files:manifest},null,2)+'\n');
console.log(JSON.stringify({phase:bootstrap?'bootstrap':'final',fileCount:manifest.length,verifiedByteForByte:true,target}));
