import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { assembleAttempt, assessmentBankVersion, isCurrentKalibrAttempt, requiredScore, scoreAttempt, type AssessmentGrade } from "../artifacts/api-server/src/lib/assessment-bank";
import { assembleManagedAttempt, exposedTemplateIds, managedTemplates, selectManagedTemplates, verifiedSkillsForAttempt, ManagedBankUnavailableError, type ProgramId } from "../artifacts/api-server/src/lib/assessment-managed";
import { emptyResume, frontendResumeQuestions, recommendResumeGrade, SaveResumeSchema } from "../artifacts/api-server/src/lib/signal-resume-contract";
import { selectContextForNeed, listAssessmentContexts } from "../artifacts/api-server/src/lib/assessment-context";

const grades: AssessmentGrade[] = ["Junior", "Middle", "Senior"];
const programs: ProgramId[] = ["backend-python", "frontend-typescript"];
const solved = (form: ReturnType<typeof assembleManagedAttempt>) => form.cases.map(item => ({ caseId: item.id, answer: form.oracles[item.id]!.answer }));

test("managed bank: 108 registered templates, three semantic scenarios per competency/grade; 600 valid forms", () => {
  assert.equal(managedTemplates.length, 108);
  assert.equal(new Set(managedTemplates.map(item => item.id)).size, 108);
  for (const program of programs) for (const grade of grades) {
    const available = managedTemplates.filter(item => item.programId === program && item.grade === grade);
    for (let slot = 0; slot < 6; slot++) assert.equal(new Set(available.filter(item => item.slot === slot).map(item => item.scenario)).size, 3);
    for (let index = 0; index < 100; index++) {
      const form = assembleManagedAttempt(program, grade, `managed-${index}`);
      assert.equal(isCurrentKalibrAttempt(form.cases, form.oracles), true);
      assert.equal(assessmentBankVersion(form.cases, form.oracles), program === "backend-python" ? "signal-backend-python-v7" : "signal-frontend-typescript-v3");
      assert.equal(scoreAttempt(form.cases, form.oracles, solved(form)).score, 100);
      assert.equal(scoreAttempt(form.cases, form.oracles, solved(form)).criticalComplete, true);
      assert.deepEqual(form.cases.map(item => item.responseType), ["text", "text", "choice", "text", "choice", "text"]);
      assert.doesNotMatch(JSON.stringify(form.cases), /"answer"|"blueprint"|"templateId"|"seed"/);
      for (const index of grade === "Senior" ? [0, 1, 3, 4] : [0, 1, 3]) {
        const answers = solved(form); answers[index]!.answer = "incorrect";
        const result = scoreAttempt(form.cases, form.oracles, answers);
        assert.equal(result.criticalComplete, false);
      }
      const evidence = scoreAttempt(form.cases, form.oracles, solved(form)).evidence;
      assert.equal(evidence.every((item, slot) => item.programId === program && typeof item.templateId === "string" && item.templateVersion === (grade === "Senior" && slot === 4 ? 2 : 1) && item.criterionId), true);
      const verified = verifiedSkillsForAttempt(form.cases, form.oracles, evidence);
      assert.equal(verified.includes(program === "backend-python" ? "Python" : "TypeScript"), true);
      for (const unsupported of ["FastAPI", "PostgreSQL", "React", "JavaScript", "HTML", "CSS"]) assert.equal(verified.includes(unsupported), false);
    }
  }
});

test("managed bank: exposure chooses unseen scenarios, disabled templates never recur, exhausted slot fails explicitly", () => {
  for (const program of programs) for (const grade of grades) {
    const first = assembleManagedAttempt(program, grade, "same-seed");
    const previousTemplateIds = exposedTemplateIds(first.oracles);
    const second = assembleManagedAttempt(program, grade, "same-seed", { previousTemplateIds });
    assert.equal(exposedTemplateIds(second.oracles).some(id => previousTemplateIds.includes(id)), false);
    for (let slot = 0; slot < 6; slot++) assert.notEqual(first.cases[slot]!.title, second.cases[slot]!.title);
    assert.deepEqual(assembleManagedAttempt(program, grade, "same-seed", { disabledTemplateIds: previousTemplateIds }), second);
    const saved = JSON.stringify(first);
    selectManagedTemplates(program, grade, "new-seed", { disabledTemplateIds: previousTemplateIds });
    assert.equal(JSON.stringify(first), saved, "Availability must never rewrite a previously issued snapshot");
    const disabledTemplateIds = managedTemplates.filter(item => item.programId === program && item.grade === grade && item.slot === 0).map(item => item.id);
    assert.throws(() => assembleManagedAttempt(program, grade, "exhausted", { disabledTemplateIds }), ManagedBankUnavailableError);
  }
});

test("managed bank: position/length/filler and copied rows from A or another seed cannot verify any grade", () => {
  for (const program of programs) for (const grade of grades) for (let index = 0; index < 30; index++) {
    const a = assembleManagedAttempt(program, grade, `attack-${index}`, { forcedVariant: 0 });
    const b = assembleManagedAttempt(program, grade, `attack-${index}`, { forcedVariant: 1 });
    const c = assembleManagedAttempt(program, grade, `holdout-${index}`, { forcedVariant: 1 });
    const attacks = [
      b.cases.map((item, slot) => ({ caseId: item.id, answer: a.oracles[a.cases[slot]!.id]!.answer })),
      b.cases.map((item, slot) => ({ caseId: item.id, answer: c.oracles[c.cases[slot]!.id]!.answer })),
      b.cases.map(item => ({ caseId: item.id, answer: item.options[1] ?? "1" })),
      b.cases.map(item => ({ caseId: item.id, answer: [...item.options].sort((x, y) => y.length - x.length)[0] ?? "результат" })),
      b.cases.map(item => ({ caseId: item.id, answer: [...item.options].sort((x, y) => x.length - y.length)[0] ?? "1" })),
      solved(a), // Old IDs cannot be submitted for a new form.
    ];
    for (const answers of attacks) {
      const result = scoreAttempt(b.cases, b.oracles, answers);
      assert.equal(result.criticalComplete && result.score >= requiredScore(grade), false, `${program}/${grade}/${index}`);
    }
  }
});

test("v4 saved forms retain original rubric; new managed versions never rewrite them", () => {
  const old = assembleAttempt("Senior", "persisted-v4"); const snapshot = JSON.parse(JSON.stringify(old));
  const answers = old.cases.map(item => ({ caseId: item.id, answer: old.oracles[item.id]!.answer }));
  const before = scoreAttempt(old.cases, old.oracles, answers);
  for (const program of programs) assembleManagedAttempt(program, "Senior", "future-bank");
  assert.deepEqual(old, snapshot);
  assert.equal(assessmentBankVersion(snapshot.cases, snapshot.oracles), "kalibr-backend-python-v4");
  assert.deepEqual(scoreAttempt(snapshot.cases, snapshot.oracles, answers), before);
  assert.equal(before.evidence.every(item => item.templateId === null && item.templateVersion === null), true);
});

test("v5/v1 saved Senior snapshots retain their original decision; v6/v2 require architecture without changing thresholds", () => {
  for (const program of programs) {
    const form = assembleManagedAttempt(program, "Senior", "historical-v5-v1", {programVersion:program === "backend-python" ? "signal-backend-python-v6" : "signal-frontend-typescript-v2"});
    const current = JSON.parse(JSON.stringify(form)) as typeof form;
    const oldVersion = program === "backend-python" ? "signal-backend-python-v5" : "signal-frontend-typescript-v1";
    // A fixed synthetic historical snapshot has the actual old public identifiers
    // and old rubric flags. No existing database attempt is rewritten by this test.
    const historical = { cases: form.cases.map(item => ({ ...item, id: item.id.replace(/signal-backend-python-v6|signal-frontend-typescript-v2/, oldVersion) })), oracles: Object.fromEntries(form.cases.map((item, slot) => [item.id.replace(/signal-backend-python-v6|signal-frontend-typescript-v2/, oldVersion), { ...form.oracles[item.id]!, blueprint: { ...form.oracles[item.id]!.blueprint, version: oldVersion, critical: [0, 1, 3].includes(slot), templateVersion: 1 } }])) };
    const frozen = JSON.stringify(historical);
    assert.equal(isCurrentKalibrAttempt(historical.cases, historical.oracles), true);
    assert.equal(assessmentBankVersion(historical.cases, historical.oracles), oldVersion);
    const withoutArchitecture = (attempt: typeof form) => solved(attempt).map((answer,slot)=>slot===4?{...answer,answer:""}:answer);
    const before = scoreAttempt(historical.cases, historical.oracles, withoutArchitecture(historical));
    const after = scoreAttempt(current.cases, current.oracles, withoutArchitecture(current));
    assert.deepEqual([before.score,before.criticalComplete],[83,true]);
    assert.deepEqual([after.score,after.criticalComplete],[83,false]);
    assert.equal(requiredScore("Senior"),83);
    assert.equal(JSON.stringify(historical),frozen);
    // Do not reinterpret a malformed old snapshot with new flags as a valid one.
    historical.oracles[historical.cases[4]!.id]!.blueprint.critical=true;
    assert.equal(isCurrentKalibrAttempt(historical.cases,historical.oracles),false);
  }
});

test("Frontend questionnaire and contexts are complete and cannot certify React or a different program", () => {
  const resume = emptyResume("Frontend / TypeScript");
  assert.equal(frontendResumeQuestions.length, 6);
  assert.equal(SaveResumeSchema.safeParse(resume).success, true);
  resume.questionnaire.answers = { typescript: 2, state: 2, accessibility: 2, performance: 2, architecture: 2, ownership: 2 };
  assert.equal(recommendResumeGrade(resume.questionnaire).grade, "Middle");
  const mismatch = { ...resume, questionnaire: { ...resume.questionnaire, version: "backend-python-v1" } };
  assert.equal(SaveResumeSchema.safeParse(mismatch).success, false);
  assert.equal(listAssessmentContexts("frontend-typescript").length, 3);
  const need = { title: "Доступные формы", description: "Клавиатура и фокус", specialization: "Frontend / TypeScript", grade: "Middle" as const, requiredSkills: ["TS", "React", "Accessibility"], desirableSkills: [] };
  assert.deepEqual(selectContextForNeed(need).unsupportedRequirements, ["React"]);
  assert.equal(selectContextForNeed(need).context.id, "frontend-accessibility");
  const forms = (['frontend-product', 'frontend-platform', 'frontend-accessibility'] as const).map(contextId => assembleManagedAttempt('frontend-typescript', 'Middle', 'frontend-roles', { contextId }));
  assert.equal(new Set(forms.map(form => `${form.cases[2]!.title}/${form.cases[4]!.title}`)).size, 3);
  for (const slot of [0, 1, 3, 5]) assert.deepEqual(forms.map(form => form.cases[slot]), Array(3).fill(forms[0]!.cases[slot]));
});

test("Independent TypeScript runtime validates all executable frontend traces for 120 new held-out forms", () => {
  // Execute the SHOWN TypeScript, never the generator's formula. No production answers, IO or network.
  // These programs are authored local fixtures, not candidate-supplied source.
  for (const grade of grades) for (const variant of [0, 1] as const) for (let index = 0; index < 20; index++) {
    const form = assembleManagedAttempt("frontend-typescript", grade, `runtime-heldout-${index}`, { forcedVariant: variant });
    for (const slot of [0, 1, 5]) {
      const item = form.cases[slot]!;
      const source = item.prompt.match(/```typescript\n([\s\S]*?)\n```/)?.[1];
      assert.ok(source);
      const instrumented = slot === 1 ? `${source}\n__out.push(String(${variant === 0 ? "state.count" : "total"}));` : source.split("\n").map(line => /^(label|read|receive|settle)\(/.test(line) ? `__out.push(String(${line.replace(/;$/, "")}));` : line).join("\n");
      const javascript = ts.transpile(instrumented, { target: ts.ScriptTarget.ES2022 });
      const context = { __out: [] as string[] };
      vm.runInNewContext(javascript, context, { timeout: 500 });
      assert.equal(context.__out.join("|"), form.oracles[item.id]!.answer, `${grade}/${variant}/${index}/${slot}`);
    }
  }
});
