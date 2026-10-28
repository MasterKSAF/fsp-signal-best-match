import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSkillAttempt, scoreSkillAttempt, skillBaseScenarioFixture, skillModuleRegistry, skillModuleTemplates, skillScenarioFixture } from './skill-module-bank';
import type { BankCheck } from './skill-bank-manifest';

/** Trusted authored fixtures only. This is NOT the candidate code execution sandbox. */
export async function checkBankContent(python = process.env.SIGNAL_AUDIT_PYTHON ?? 'python'): Promise<BankCheck[]> {
  let variants = 0; let valid = true;
  const pythonTasks: { code: string; expected: string }[] = [];
  const tsTasks: { code: string; expected: string }[] = [];
  for (const t of skillModuleTemplates) for (let n = 5; n <= 9; n++) for (const flag of [false, true]) {
    const task = skillScenarioFixture(t.skillId, t.level, t.competencyIndex, t.scenarioIndex, n, flag);
    variants++;
    valid &&= Boolean(task.title.trim() && task.prompt.trim() && task.explanation.trim() && task.answer.trim());
    if (task.options) valid &&= new Set(task.options).size === task.options.length && task.options.filter(o => o === task.answer).length === 1;
    if (task.responseType === 'integer') valid &&= /^[+-]?\d+$/.test(task.answer);
    if (t.level !== 'Senior') {
      const base = skillBaseScenarioFixture(t.skillId, t.level, t.competencyIndex, t.scenarioIndex, n, flag);
      const block = /```(?:python|typescript)\n([\s\S]*?)```/.exec(base.prompt)?.[1];
      if (block) (t.skillId === 'python' ? pythonTasks : tsTasks).push({ code: block, expected: base.answer });
    }
  }
  const py = spawnSync(python, ['-c', `import json,sys,io,contextlib
tasks=json.load(sys.stdin); result=[]
for task in tasks:
 output=io.StringIO()
 try:
  with contextlib.redirect_stdout(output): exec(compile(task['code'],'<authored-bank>','exec'),{})
  result.append('|'.join(output.getvalue().strip().splitlines())==task['expected'])
 except Exception: result.append(False)
print(json.dumps(result))`], { input: JSON.stringify(pythonTasks), encoding: 'utf8', timeout: 30_000, maxBuffer: 2_000_000 });
  const pythonResults: boolean[] = py.status === 0 ? JSON.parse(py.stdout) : [];
  let tsPassed = 0;
  for (const task of tsTasks) {
    const source = ts.createSourceFile('fixture.ts', task.code, ts.ScriptTarget.Latest, true);
    const body: string[] = []; const deferred: string[] = [];
    for (const statement of source.statements) {
      if (ts.isExpressionStatement(statement)) {
        const text = statement.expression.getText(source);
        if (ts.isBinaryExpression(statement.expression) || /\.(?:sort|push)\(/.test(text) || text.startsWith('Promise.resolve(')) body.push(statement.getText(source));
        else deferred.push(`__readers.push(()=>(${text}));`);
      } else body.push(statement.getText(source));
    }
    try {
      const js = ts.transpileModule(`const __readers:any[]=[];\n${body.join('\n')}\n${deferred.join('\n')}\n__readers`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
      const readers = vm.runInNewContext(js, {}, { timeout: 1000 }) as (() => unknown)[];
      await Promise.resolve(); await Promise.resolve();
      if ((await Promise.all(readers.map(r => r()))).map(String).join('|') === task.expected) tsPassed++;
    } catch { /* Failed fixture prevents attestation. */ }
  }
  let grading = 0; let gradingPassed = true;
  for (const module of skillModuleRegistry) for (const level of module.availableLevels) for (const seed of ['boundary-a', 'boundary-b', 'boundary-c', 'boundary-d']) {
    const form = buildSkillAttempt(module.id, level, seed);
    const correct = Object.fromEntries(Object.entries(form.oracles).map(([id, oracle]) => [id, oracle.expected]));
    gradingPassed &&= scoreSkillAttempt(form.cases, form.oracles, correct, form.policy).passed;
    gradingPassed &&= !scoreSkillAttempt(form.cases, form.oracles, {}, form.policy).passed;
    for (const c of form.cases.filter(c => c.critical)) gradingPassed &&= !scoreSkillAttempt(form.cases, form.oracles, { ...correct, [c.id]: '__incorrect__' }, form.policy).passed;
    grading++;
  }
  return [
    { id: 'all-family-input-domain-and-unique-options', passed: valid, checked: variants },
    { id: 'python-reference-runtime', passed: pythonResults.length === pythonTasks.length && pythonResults.every(Boolean), checked: pythonTasks.length },
    { id: 'typescript-reference-runtime', passed: tsPassed === tsTasks.length, checked: tsTasks.length },
    { id: 'positive-negative-critical-rubric', passed: gradingPassed, checked: grading, limitations: 'Synthetic fixtures; does not establish difficulty or equivalence on people.' },
  ];
}
