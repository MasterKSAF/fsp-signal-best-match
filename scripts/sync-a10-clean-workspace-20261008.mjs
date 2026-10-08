import { readdir,readFile,copyFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
assert.ok(root.replaceAll('\\','/').endsWith('/signal-ui-refinement-workspace-20261008'));
const target=path.join(root,'outputs/verification/full-audit-a01-a11-20261008/clean-workspace');
const files=[];
async function walk(relative) {
  for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
    if(['node_modules','dist','.git','clean-workspace'].includes(entry.name)||entry.name.endsWith('.tsbuildinfo')) continue;
    const next=relative+'/'+entry.name;
    if(next==='outputs/verification/full-audit-a01-a11-20261008/clean-source-manifest.json') continue;
    if(entry.isDirectory()) await walk(next); else if(entry.isFile()) files.push(next);
  }
}
for(const directory of ['artifacts','lib','scripts','tests','docs','outputs/quality','outputs/verification/history','outputs/verification/full-audit-a01-a11-20261008']) await walk(directory);
files.push('outputs/verification/multi-resume/load-comparison-cf5f76e84655.json');
for(const name of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','.npmrc','.env.example','README.md','LICENSE','Dockerfile','compose.yaml','.dockerignore','.gitattributes','.gitignore']) {
  try {await readFile(path.join(root,name));files.push(name);}catch(error){if(error.code!=='ENOENT')throw error;}
}
const manifest=[];
for(const relative of [...new Set(files)].sort()) {
 const bytes=await readFile(path.join(root,relative));
 await mkdir(path.dirname(path.join(target,relative)),{recursive:true});
 await copyFile(path.join(root,relative),path.join(target,relative));
 const copied=await readFile(path.join(target,relative));assert.ok(bytes.equals(copied));
 manifest.push({path:relative,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
}
const result={at:new Date().toISOString(),sourceRoot:root,targetRoot:target,fileCount:manifest.length,files:manifest};
await writeFile(path.join(root,'outputs/verification/full-audit-a01-a11-20261008/clean-source-manifest.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({fileCount:manifest.length,verifiedByteForByte:true,target}));
