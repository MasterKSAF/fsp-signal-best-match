import {readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const rows=JSON.parse(readFileSync('outputs/verification/full-audit-a01-a11-20261008/bank/public-only-scenarios-draft.json','utf8')).rows;const results=[];
for(const r of rows){if(r.n!==5||!r.flag||r.skill!=='typescript'||!['Junior','Middle'].includes(r.level))continue;const stem=r.prompt.split('Часть B')[0];const code=stem.match(/```typescript\n([\s\S]*?)\n```/)?.[1];if(!code)continue;
const ast=ts.createSourceFile('public.ts',code,ts.ScriptTarget.ESNext,true);const outputs:any[]=[];const pending:Promise<any>[]=[];
const script=ast.statements.map(st=>{const text=st.getText(ast);if(ts.isExpressionStatement(st)&&(/^(?:String|Number|read\(|apply\(|Object\.entries|xs\.filter|log\.join|p\.)/.test(text))){const expression=st.expression.getText(ast);return expression.startsWith('log.join')?`queueMicrotask(()=>capture(${expression}));`:`capture(${expression});`;}return text;}).join('\n');
const capture=(v:any)=>{const index=outputs.length;outputs.push(undefined);if(v?.then)pending.push(Promise.resolve(v).then(x=>outputs[index]=String(x)));else outputs[index]=String(v);};
const js=ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(js,{capture,queueMicrotask,Promise,console:{log:capture}},{timeout:500});await Promise.all(pending);await new Promise<void>(resolve=>queueMicrotask(resolve));results.push({key:r.key,semanticDecision:outputs.join('|'),method:'Independent TS AST/transpile+isolated VM public snippet, await declared microtask/promise observation',source:code});}
writeFileSync('outputs/verification/full-audit-a01-a11-20261008/bank/reference-primary-typescript.json',JSON.stringify({compiler:ts.version,rows:results},null,2));console.log(results.length);
