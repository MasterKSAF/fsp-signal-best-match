/** Private authored-bank audit. Records aggregate outcomes, never working answer keys. */
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSkillAttempt, skillModuleRegistry, skillScenarioFixture, skillBaseScenarioFixture, skillModuleTemplates, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { assembleManagedAttempt } from '../artifacts/api-server/src/lib/assessment-managed';
const dir = 'outputs/verification/candidate-workspace-skill-matrix-20261008';
const pythonExecutable = process.env.SIGNAL_AUDIT_PYTHON ?? 'C:/Users/Misha/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const pythonTasks: { id: string; code: string; expected: string }[] = []; const tsTasks: { id: string; code: string; expected: string }[] = [];
const variation: Record<string, { distinctAnswers: number; invariant: boolean; mechanism: string }> = {};
// Senior has independent content and its own substantive audit; never feed it into the old base-task helper.
for (const m of skillModuleRegistry) for (const level of m.availableLevels.filter(level => level !== 'Senior')) for (let c=0;c<6;c++) for (let s=0;s<3;s++) {
  const answers = new Set<string>();
  for (let n=5;n<=9;n++) for (const flag of [false,true]) {
    const task=skillScenarioFixture(m.id,level,c,s,n,flag); answers.add(task.answer);
    const base=skillBaseScenarioFixture(m.id,level,c,s,n,flag);
    const block=/```(?:python|typescript)\n([\s\S]*?)```/.exec(base.prompt)?.[1];
    if (block) (m.id==='python'?pythonTasks:tsTasks).push({id:`${m.id}/${level}/${c}/${s}/${n}/${flag}`,code:block,expected:base.answer});
  }
  variation[`${m.id}/${level}/${m.competencies[c]}/s${s+1}`]={distinctAnswers:answers.size,invariant:answers.size===1,mechanism:answers.size===1?'Conceptual invariant: counted as one scenario, not a new question per parameter.':'Changed branch, values, state, event order, or boundary changes the correct outcome.'};
}
const py = spawnSync(pythonExecutable, ['-c', `import sys,json,io,contextlib
tasks=json.load(sys.stdin); results=[]
for t in tasks:
 b=io.StringIO()
 try:
  with contextlib.redirect_stdout(b): exec(compile(t['code'], '<authored-fixture>', 'exec'), {})
  actual='|'.join(b.getvalue().strip().splitlines())
  results.append({'id':t['id'],'pass':actual==t['expected']})
 except Exception as e: results.append({'id':t['id'],'pass':False,'errorType':type(e).__name__})
print(json.dumps(results))`], { input:JSON.stringify(pythonTasks),encoding:'utf8',maxBuffer:5_000_000 });
if (py.status!==0) throw new Error(`Python runtime unavailable: ${py.stderr.slice(0,300)}`);
const pythonResults: {id:string;pass:boolean;errorType?:string}[] = JSON.parse(py.stdout);
const tsResults:{id:string;pass:boolean;errorType?:string}[]=[];
for (const task of tsTasks) {
  try {
    const source=ts.createSourceFile('fixture.ts',task.code,ts.ScriptTarget.Latest,true);
    const deferred:string[]=[]; const body:string[]=[];
    for(const statement of source.statements) {
      if(ts.isExpressionStatement(statement)) {
        const text=statement.expression.getText(source);
        // Deliberate mutation/scheduling statements run now; observable expressions are read after microtasks.
        if(ts.isBinaryExpression(statement.expression)||/\.(?:sort|push)\(/.test(text)||text.startsWith('Promise.resolve(')) body.push(statement.getText(source));
        else deferred.push(`__readers.push(()=>(${text}));`);
      } else body.push(statement.getText(source));
    }
    const js=ts.transpileModule(`const __readers:any[]=[];\n${body.join('\n')}\n${deferred.join('\n')}\n__readers`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const readers=vm.runInNewContext(js,{}, {timeout:1000}) as (()=>unknown)[];
    await Promise.resolve(); await Promise.resolve();
    const actual=(await Promise.all(readers.map(r=>r()))).map(String).join('|'); tsResults.push({id:task.id,pass:actual===task.expected});
  } catch(error) {tsResults.push({id:task.id,pass:false,errorType:error instanceof Error?error.name:'Unknown'});}
}
type Rates={comparisons:number;choiceComparisons:number;numberTransfers:number; textTransfers:number; numericTransfers:number; numericComparisons:number};
const newRates:Rates={comparisons:0,choiceComparisons:0,numberTransfers:0,textTransfers:0,numericTransfers:0,numericComparisons:0};
const oldRates:Rates={...newRates};
for(let seed=0;seed<100;seed++) {
 for(const m of skillModuleRegistry) for(const level of m.availableLevels.filter(level => level !== 'Senior')) {
  const a=buildSkillAttempt(m.id,level,`transfer-a-${seed}`), b=buildSkillAttempt(m.id,level,`transfer-b-${seed}`);
  for(let c=0;c<6;c++) {
   const ca=a.cases[c]!,cb=b.cases[c]!,oa=a.oracles[ca.id]!,ob=b.oracles[cb.id]!;
   newRates.comparisons++;
   if(ca.options&&cb.options) { newRates.choiceComparisons++;const ai=ca.options.findIndex(o=>o.id===oa.expected), bi=cb.options.findIndex(o=>o.id===ob.expected); if(ai===bi)newRates.numberTransfers++; if(ca.options[ai]?.text===cb.options[bi]?.text)newRates.textTransfers++; }
   else {if(oa.expected===ob.expected)newRates.textTransfers++; if(/^-?\d+$/.test(oa.expected)&&/^-?\d+$/.test(ob.expected)){newRates.numericComparisons++;if(oa.expected===ob.expected)newRates.numericTransfers++;}}
  }
 }
 for(const program of ['backend-python','frontend-typescript'] as const) for(const level of ['Junior','Middle'] as const) {
  const a=assembleManagedAttempt(program,level,`transfer-a-${seed}`),b=assembleManagedAttempt(program,level,`transfer-b-${seed}`);
  for(let c=0;c<6;c++) {const ca=a.cases[c]!,cb=b.cases[c]!,oa=a.oracles[ca.id]!.answer,ob=b.oracles[cb.id]!.answer;oldRates.comparisons++; if(ca.responseType==='choice'&&cb.responseType==='choice'){oldRates.choiceComparisons++;if(ca.options.indexOf(oa)===cb.options.indexOf(ob))oldRates.numberTransfers++;if(oa===ob)oldRates.textTransfers++;} else {if(oa===ob)oldRates.textTransfers++;if(/^-?\d+$/.test(oa)&&/^-?\d+$/.test(ob)){oldRates.numericComparisons++;if(oa===ob)oldRates.numericTransfers++;}} }
 }
}
const rate=(r:Rates)=>({...r,textTransferRate:r.textTransfers/r.comparisons,numericTransferRate:r.numericComparisons?r.numericTransfers/r.numericComparisons:null,answerNumberTransferRate:r.choiceComparisons?r.numberTransfers/r.choiceComparisons:null});
const failures=[...pythonResults,...tsResults].filter(r=>!r.pass);
const report={passed:!failures.length,bankVersion:SKILL_BANK_VERSION,coverage:{historicalLevelTemplates:108,newLevelTemplates:skillModuleTemplates.filter(t=>t.level!=='Senior').length,independentScenarioFamilies:108,availableModules:6,auditedLevels:['Junior','Middle'],competenciesPerAttempt:6,seniorPrepared:true,seniorAudit:'skill-senior-v4-probes.json'},runtimeOracleAudit:{python:{checked:pythonResults.length,passed:pythonResults.filter(r=>r.pass).length},typescript:{checked:tsResults.length,passed:tsResults.filter(r=>r.pass).length},failures},variation,answerTransfer:{seedSample:100,historical:rate(oldRates),modules:rate(newRates),comparisonLimitation:'Different programme composition: descriptive synthetic transfer experiment, not causal before/after effectiveness on people.'},limitations:['Some conceptual scenarios deliberately have invariant answers; these are not counted as new scenarios per seed.','Middle/Junior difficulty and equivalence have not been validated by human experts or participants.','Runtime validation covers executable Python/TypeScript; authored SQL/React/engineering expectations require handwritten boundary checks and independent review.','Public repository publication can disclose the authored bank; browser key withholding does not conceal public source.','No anti-cheating accusation, automatic revocation, or guarantee of full protection.'],measuredAt:new Date().toISOString()};
await mkdir(dir,{recursive:true});await writeFile(`${dir}/skill-bank-audit-v4-lower-levels.json`,JSON.stringify({...report,coverage:{...report.coverage,sharedBaseContentFamilies:108,additionalMiddleRequirementFamilies:36,mandatoryMiddlePartsPerCompetency:2}},null,2));
console.log(JSON.stringify({passed:report.passed,python:report.runtimeOracleAudit.python,typescript:report.runtimeOracleAudit.typescript,failures:failures.slice(0,10),report:`${dir}/skill-bank-audit-v2.json`}));if(failures.length)process.exitCode=1;
