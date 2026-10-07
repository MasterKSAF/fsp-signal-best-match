import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { assembleManagedAttempt, exposedTemplateIds, managedTemplates, type ProgramId } from "../artifacts/api-server/src/lib/assessment-managed.ts";
import { assembleAttempt, assessmentBankVersion, isCurrentKalibrAttempt, requiredScore, scoreAttempt, type AssessmentGrade, type AttemptOracle } from "../artifacts/api-server/src/lib/assessment-bank.ts";

// No DB runtime, fetch, production endpoint, feature flag or credential dependency.
const directory = "outputs/research/confirmation-v1";
const protocolBytes = readFileSync(`${directory}/protocol.json`);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const protocolHash = sha(protocolBytes);
const frozenHash = readFileSync(`${directory}/protocol.sha256`, "utf8").trim();
assert.equal(protocolHash, frozenHash, "Protocol changed after freeze");
assert.equal(protocolHash, "278fdc8ef232dd2e2bc65c82c246535b5dfca85a8f2c55f6c420754fed12651c", "Unexpected protocol version");
const freeze = JSON.parse(readFileSync(`${directory}/freeze.json`, "utf8"));
assert.equal(freeze.frozenBeforeAnyExperimentRun, true); assert.equal(freeze.protocolSha256, protocolHash);
type Validity = "valid" | "known_defect" | "scoring_failure" | "revoked";
type Episode = { id: string; story: string; labelNeedsClarification: boolean; a: number[]; b: number[]; third?: number[]; days?: number; aGrade?: AssessmentGrade; bProgram?: ProgramId; aGenerator?: "legacy"; bValidity?: Validity; thirdValidity?: Validity; sameAttempt?: boolean; resumeCopies?: number };
type Protocol = { version: string; selection: { maximumIntervalDays: number; minimumScoreDelta: number }; outcome: { maximumDeltaFromLatest: number }; episodes: Episode[] };
const protocol = JSON.parse(protocolBytes.toString("utf8")) as Protocol;
assert.equal(protocol.episodes.length, freeze.episodeCount);
type Observation = {
  attemptId: string; candidateId: number; resumeId: number; programId: ProgramId; grade: AssessmentGrade; version: string;
  measuredAt: string; validity: Validity; form: ReturnType<typeof assembleManagedAttempt>; answers: { caseId: string; answer: string }[];
};
type Evaluation = { valid: true; score: number; verified: boolean; criticalComplete: boolean; rubric: string } | { valid: false; reason: string };
function observation(episode: Episode, index: number, label: "a" | "b" | "third", exposures: string[] = []): Observation {
  const programId = label === "a" ? "backend-python" : episode.bProgram ?? "backend-python";
  const grade = label === "a" ? episode.aGrade ?? "Middle" : "Middle";
  const seed = `${protocol.version}:${episode.id}:${label}`;
  const form = label === "a" && episode.aGenerator === "legacy" ? assembleAttempt(grade, seed)
    : assembleManagedAttempt(programId, grade, seed, label === "third" ? { previousTemplateIds: exposures } : { forcedVariant: label === "a" ? 0 : 1 });
  const validity = label === "b" ? episode.bValidity ?? "valid" : label === "third" ? episode.thirdValidity ?? "valid" : "valid";
  // Known defective-form control: intentionally contradictory presentation,
  // flagged by a simulated operator; not inferred from candidate performance.
  if (validity === "known_defect") form.cases[0]!.prompt += "\n[SYNTHETIC DEFECT] Ignore the stated contract and return both success and failure for the same call.";
  const passed = new Set(episode[label] ?? []);
  return { attemptId: `${episode.id}:${label}`, candidateId: index + 1000, resumeId: label === "a" ? 1 : 2,
    programId, grade, version: assessmentBankVersion(form.cases, form.oracles),
    measuredAt: new Date(Date.UTC(2026, 9, 1) + (label === "a" ? 0 : label === "b" ? episode.days ?? 1 : (episode.days ?? 1) + 1) * 86_400_000).toISOString(), validity, form,
    answers: form.cases.map((item, slot) => ({ caseId: item.id, answer: passed.has(slot) ? form.oracles[item.id]!.answer : "__synthetic_unsolved__" })) };
}
function proofFingerprint(value: Observation) {
  const { resumeId: _resumeId, ...proof } = value; return sha(JSON.stringify(proof));
}
function rubric(value: Observation) {
  return sha(JSON.stringify(value.form.cases.map(item => {
    const b = (value.form.oracles as AttemptOracle)[item.id]!.blueprint;
    return { family: b.family, grade: b.grade, programId: value.programId, version: b.version, templateVersion: b.templateVersion ?? null, critical: b.critical, responseType: b.responseType, partialCredit: b.partialCredit, weight: 1 / 6 };
  }).sort((a, b) => a.family.localeCompare(b.family))));
}
function evaluate(value: Observation): Evaluation {
  try {
    if (value.validity === "scoring_failure") throw new Error("synthetic evaluator failure");
    if (value.validity !== "valid") return { valid: false, reason: value.validity };
    if (!isCurrentKalibrAttempt(value.form.cases, value.form.oracles)) return { valid: false, reason: "incomplete_form" };
    if (assessmentBankVersion(value.form.cases, value.form.oracles) !== value.version) return { valid: false, reason: "version_context_mismatch" };
    const evaluated = scoreAttempt(value.form.cases, value.form.oracles, value.answers);
    return { valid: true, score: evaluated.score, verified: evaluated.score >= requiredScore(value.grade) && evaluated.criticalComplete, criticalComplete: evaluated.criticalComplete, rubric: rubric(value) };
  } catch { return { valid: false, reason: "scoring_failure" }; }
}
type Selection = { comparable: boolean; selected: boolean; reason: string; unique: Observation[]; evaluations: Evaluation[] };
function select(raw: Observation[]): Selection {
  const distinct = new Map<string, Observation>();
  for (const item of raw) {
    const previous = distinct.get(item.attemptId);
    if (previous && proofFingerprint(previous) !== proofFingerprint(item)) return { comparable: false, selected: false, reason: "conflicting_copies_of_one_proof", unique: [...distinct.values()], evaluations: [] };
    distinct.set(item.attemptId, item);
  }
  const unique = [...distinct.values()].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt) || a.attemptId.localeCompare(b.attemptId));
  const evaluations = unique.map(evaluate);
  const reject = (reason: string): Selection => ({ comparable: false, selected: false, reason, unique, evaluations });
  if (unique.length !== 2) return reject("two_distinct_attempts_required");
  const [a, b] = unique as [Observation, Observation]; const [av, bv] = evaluations as [Evaluation, Evaluation];
  if (!av.valid || !bv.valid) return reject(`invalid_source:${!av.valid ? av.reason : !bv.valid ? bv.reason : "unknown"}`);
  if (a.candidateId !== b.candidateId) return reject("different_candidates");
  if (a.programId !== b.programId) return reject("different_programs");
  if (a.grade !== b.grade) return reject("different_grades");
  if (a.version !== b.version || av.rubric !== bv.rubric) return reject("different_saved_version_or_rubric");
  const interval = (Date.parse(b.measuredAt) - Date.parse(a.measuredAt)) / 86_400_000;
  if (interval < 0 || interval > protocol.selection.maximumIntervalDays) return reject("outside_declared_interval");
  const selected = av.verified !== bv.verified && (Math.abs(av.score - bv.score) >= protocol.selection.minimumScoreDelta || av.criticalComplete !== bv.criticalComplete);
  return { comparable: true, selected, reason: selected ? "decision_disagreement_with_score_or_critical_difference" : "rule_not_triggered", unique, evaluations };
}
class ConfirmationGuard {
  private used = new Set<string>();
  private confirmationAttemptIds = new Set<string>();
  claim(candidateId: number, sourceIds: string[], _resumeId: number, _episodeAlias: string) {
    if (sourceIds.some(id => this.confirmationAttemptIds.has(JSON.stringify([candidateId, id])))) return false;
    const key = JSON.stringify([candidateId, [...sourceIds].sort()]);
    if (this.used.has(key)) return false;
    this.used.add(key); return true;
  }
  recordConfirmation(candidateId: number, attemptId: string) { this.confirmationAttemptIds.add(JSON.stringify([candidateId, attemptId])); }
}
const guard = new ConfirmationGuard();
const rawEpisodes = protocol.episodes.map((episode, index) => {
  const a = observation(episode, index, "a");
  const raw = episode.sameAttempt ? Array.from({ length: episode.resumeCopies ?? 5 }, (_, resumeId) => ({ ...structuredClone(a), resumeId: resumeId + 1 })) : [a, observation(episode, index, "b")];
  return { episode, index, raw };
});
const before = sha(JSON.stringify(rawEpisodes));
const rows: Record<string, unknown>[] = []; let additionalAttempts = 0; let additionalTasks = 0; let freshTemplateTasks = 0; let freshCaseTasks = 0; let changedPromptTasks = 0;
let repeatDenied = 0; let chainDenied = 0;
for (const { episode, index, raw } of rawEpisodes) {
  const selection = select(raw);
  let outcome: "consistent" | "uncertain" | "invalid" | null = null; let thirdScore: number | null = null;
  let novelty: Record<string, number> | null = null;
  if (selection.selected) {
    const [a, b] = selection.unique as [Observation, Observation]; const latest = selection.evaluations[1]!;
    assert.ok(guard.claim(a.candidateId, [a.attemptId, b.attemptId], 1, episode.id));
    const exposures = selection.unique.flatMap(item => exposedTemplateIds(item.form.oracles));
    const third = observation(episode, index, "third", exposures); const evaluated = evaluate(third);
    guard.recordConfirmation(a.candidateId, third.attemptId);
    additionalAttempts++; additionalTasks += third.form.cases.length;
    const sourceTemplates = new Set(exposures); const sourceCases = new Set(selection.unique.flatMap(item => item.form.cases.map(c => c.id))); const prompts = new Set(selection.unique.flatMap(item => item.form.cases.map(c => c.prompt)));
    const templates = exposedTemplateIds(third.form.oracles);
    novelty = { tasks: third.form.cases.length, freshTemplateIds: templates.filter(id => !sourceTemplates.has(id)).length, freshCaseIds: third.form.cases.filter(c => !sourceCases.has(c.id)).length, changedPrompts: third.form.cases.filter(c => !prompts.has(c.prompt)).length };
    freshTemplateTasks += novelty.freshTemplateIds!; freshCaseTasks += novelty.freshCaseIds!; changedPromptTasks += novelty.changedPrompts!;
    if (!evaluated.valid || !latest.valid || third.programId !== b.programId || third.grade !== b.grade || third.version !== b.version || evaluated.rubric !== latest.rubric) outcome = "invalid";
    else {
      thirdScore = evaluated.score;
      outcome = evaluated.verified === latest.verified && evaluated.criticalComplete === latest.criticalComplete && Math.abs(evaluated.score - latest.score) <= protocol.outcome.maximumDeltaFromLatest ? "consistent" : "uncertain";
    }
    // Changing the displayed resume or alias cannot generate a second observation.
    assert.equal(guard.claim(a.candidateId, [b.attemptId, a.attemptId], 5, `${episode.id}-new-resume`), false); repeatDenied++;
    assert.equal(guard.claim(a.candidateId, [b.attemptId, third.attemptId], 3, `${episode.id}-chain`), false); chainDenied++;
  }
  rows.push({ id: episode.id, story: episode.story, syntheticLabelNeedsClarification: episode.labelNeedsClarification, rawViews: raw.length, uniqueSourceAttempts: selection.unique.length,
    comparable: selection.comparable, selected: selection.selected, reason: selection.reason,
    sources: selection.unique.map((observation, i) => ({ attemptId: observation.attemptId, programId: observation.programId, grade: observation.grade, version: observation.version, evaluated: selection.evaluations[i]?.valid ? { score: (selection.evaluations[i] as Extract<Evaluation, { valid: true }>).score, verified: (selection.evaluations[i] as Extract<Evaluation, { valid: true }>).verified, criticalComplete: (selection.evaluations[i] as Extract<Evaluation, { valid: true }>).criticalComplete } : { invalidReason: (selection.evaluations[i] as Extract<Evaluation, { valid: false }>)?.reason ?? null } })),
    confirmationOutcome: outcome, confirmationScore: thirdScore, novelty });
}
assert.equal(sha(JSON.stringify(rawEpisodes)), before, "Original observations were mutated");
const groups = new Map<string, number>();
for (const template of managedTemplates) { const key = JSON.stringify([template.programId, template.grade, template.competency]); groups.set(key, (groups.get(key) ?? 0) + 1); }
assert.equal(Math.min(...groups.values()), 2); assert.equal(Math.max(...groups.values()), 2);
function confusion(cases: Record<string, unknown>[]) {
  const tp = cases.filter(r => r.selected && r.syntheticLabelNeedsClarification).length;
  const fp = cases.filter(r => r.selected && !r.syntheticLabelNeedsClarification).length;
  const fn = cases.filter(r => !r.selected && r.syntheticLabelNeedsClarification).length;
  const tn = cases.filter(r => !r.selected && !r.syntheticLabelNeedsClarification).length;
  return { cases: cases.length, truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn,
    precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, falseAlertRate: fp + tn ? fp / (fp + tn) : null };
}
const report = {
  status: "PASS", protocolVersion: protocol.version, protocolSha256: protocolHash,
  protocolMtimeUtc: statSync(`${directory}/protocol.json`).mtime.toISOString(), generatedAt: new Date().toISOString(), syntheticOnly: true,
  independentHumanParticipants: 0, runtimeDatabaseAccess: false, runtimeNetworkAccess: false, productionRoutesAdded: 0,
  originalSourceObjectsUnchanged: true, sourceObjectsSha256: before, repeatedConfirmationDenied: repeatDenied, confirmationChainsDenied: chainDenied,
  bankFacts: { totalManagedTemplates: managedTemplates.length, programGradeCompetencyGroups: groups.size, minimumTemplatesPerCompetency: Math.min(...groups.values()), maximumTemplatesPerCompetency: Math.max(...groups.values()),
    additionalTasksWithUnseenTemplateId: freshTemplateTasks, additionalTasksWithNewCaseId: freshCaseTasks, additionalTasksWithDifferentPrompt: changedPromptTasks },
  observations: { rawResumeViews: rawEpisodes.reduce((n, e) => n + e.raw.length, 0), uniqueSourceAttempts: rows.reduce((n, r) => n + Number(r.uniqueSourceAttempts), 0),
    oneProofFiveResumes: rows.find(r => r.id === "one-proof-five-resumes") },
  metrics: { allEpisodes: confusion(rows), comparableEpisodes: confusion(rows.filter(r => r.comparable)), excludedEpisodes: rows.filter(r => !r.comparable).length,
    additionalAttempts, additionalAssignedTasks: additionalTasks, unnecessaryAdditionalAttemptsOnPredeclaredStableOrTrainingScenarios: rows.filter(r => r.selected && !r.syntheticLabelNeedsClarification).length,
    unnecessaryAdditionalAssignedTasks: rows.filter(r => r.selected && !r.syntheticLabelNeedsClarification).length * 6,
    outcomes: { consistent: rows.filter(r => r.confirmationOutcome === "consistent").length, uncertain: rows.filter(r => r.confirmationOutcome === "uncertain").length, invalid: rows.filter(r => r.confirmationOutcome === "invalid").length } },
  episodes: rows,
  conclusion: "Данных недостаточно для рабочей политики или утверждения эффективности на людях. Нужны непоказанные содержательные формы и измеренная сопоставимость; допускается обсуждение отдельного добровольного исследовательского пилота после подготовки этих условий.",
  limitations: ["Only manually specified synthetic scenarios; labels are not independent human expertise or empirical ability observations.", "Thresholds 25/17/7 days are preregistered hypotheses, not measured confidence or significance.", "The current bank has exactly two templates per competency. After two complete forms the third reuses templates: new seeds/case IDs do not establish independent assessment content.", "Parameter changes do not establish equal human difficulty, resistance to memorization or anticheating accuracy.", "A consistent third result is agreement with the latest measurement, not proof that it is true or that a working grade should change.", "One false alert after legitimate training and one missed borderline uncertainty remain visible; thresholds were not tuned after results.", "No participant minutes, cheating prevalence, real-world validity or production safeguard regression is inferred from this script."]
};
writeFileSync(`${directory}/results.json`, JSON.stringify(report, null, 2));
const table = rows.map(r => `| ${r.id} | ${r.comparable ? "да" : "нет"} | ${r.selected ? "да" : "нет"} | ${r.confirmationOutcome ?? "—"} | ${r.reason} |`).join("\n");
const markdown = `# Уточняющая попытка: синтетическое исследование v1\n\nПротокол SHA-256: ${protocolHash}. Зафиксирован до запуска, параметры после результатов не менялись. Людей: 0. DB/API/сеть: не используются. Исходные объекты неизменны.\n\n17 сценариев; сопоставимых ${report.metrics.comparableEpisodes.cases}, исключено ${report.metrics.excludedEpisodes}. Назначено ${additionalAttempts} дополнительных попыток / ${additionalTasks} заданий. Исходы: согласованный ${report.metrics.outcomes.consistent}, неопределённость ${report.metrics.outcomes.uncertain}, недействительный ${report.metrics.outcomes.invalid}.\n\nСреди сопоставимых сценариев TP ${report.metrics.comparableEpisodes.truePositive}, FP ${report.metrics.comparableEpisodes.falsePositive}, FN ${report.metrics.comparableEpisodes.falseNegative}, TN ${report.metrics.comparableEpisodes.trueNegative}. Precision/recall относятся только к заранее указанным синтетическим меткам. Законное обучение получило лишнюю форму (${report.metrics.unnecessaryAdditionalAssignedTasks} заданий), пограничная нестабильность пропущена. Это ограничения выбранного правила, а не обвинения людей.\n\nБанк: ${managedTemplates.length} шаблонов; **2 на каждую компетенцию/программу/грейд**. У третьих форм непоказанных template IDs ${freshTemplateTasks}/${additionalTasks}; новых case IDs ${freshCaseTasks}/${additionalTasks}; изменённых текстов ${changedPromptTasks}/${additionalTasks}. Новый seed не даёт третью непоказанную инженерную задачу.\n\nОдин результат в пяти резюме: пять представлений, одно наблюдение. Повторное назначение с другим resumeId отклонено ${repeatDenied}/${additionalAttempts} раз. Рабочие грейды, consent, matching и cooldown не меняются.\n\n| Сценарий | Сопоставим | Доп. форма | Исход | Основание |\n|---|---|---|---|---|\n${table}\n\n**Вывод:** ${report.conclusion}\n\nРеального пилота, измеренной человеческой сложности и доказанной защиты от списывания нет. Нейтральное приглашение и согласие для возможного будущего пилота описаны в протоколе; участие/отказ/прерывание не влияют на рабочую квалификацию.\n\nПовтор: \`node --import tsx scripts/confirmation-research-v1.ts\`. Полные фактические данные: \`results.json\`; исходный протокол и hash сохранены рядом.\n`;
writeFileSync(`${directory}/results.md`, markdown);
console.info(JSON.stringify({ status: report.status, protocolSha256: protocolHash, episodes: rows.length, comparable: report.metrics.comparableEpisodes.cases, additionalAttempts, additionalTasks, outcomes: report.metrics.outcomes, additionalUnseenTemplates: freshTemplateTasks, report: `${directory}/results.json` }));
