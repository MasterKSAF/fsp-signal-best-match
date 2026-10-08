/** Ordinary local workflow. Only own legacy-invalid need is inserted; no grade/attempt presets. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
const origin = process.env.API_ORIGIN ?? "", target = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.SIGNAL_INDEPENDENT_FULL_HTTP, "owned-isolated");
assert.equal(origin, "http://127.0.0.1:4367"); assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "55435"); assert.equal(target.pathname, "/signal_independent_fixes_20261007");
const appOrigin = "http://localhost:4368", mailOrigin = "http://127.0.0.1:8030";
const runtimeKind = process.env.SIGNAL_INDEPENDENT_RUNTIME_KIND ?? "current-source-http";
assert.ok(["current-source-http", "normal-compiled-http"].includes(runtimeKind));
const expectedBundleSha256 = process.env.SIGNAL_INDEPENDENT_BUNDLE_SHA256;
if (runtimeKind === "normal-compiled-http") assert.match(expectedBundleSha256 ?? "", /^[a-f0-9]{64}$/);
const complete = process.argv.includes("--complete");
const inputManifest = process.argv.find(arg => arg.startsWith("--manifest="))?.slice("--manifest=".length);
if (complete) assert.ok(inputManifest && resolve(inputManifest).startsWith(resolve(homedir(), ".codex", "private") + "/") || inputManifest && resolve(inputManifest).startsWith(resolve(homedir(), ".codex", "private") + "\\"), "An absolute owned private manifest is required");
const { db, pool, signalUsersTable: users, signalNeedsTable: needs, signalAssessmentAttemptsTable: attempts,
  signalCandidateResumesTable: resumes, signalCompaniesTable: companies, signalContactGrantsTable: grants } = await import("../lib/db/src/index.ts");
type Account = { role: "candidate" | "employer"; name: string; id: number; email: string; password: string; resumeId?: number; companyId?: number };
type Manifest = { schemaVersion: 1; runId: string; prefix: string; database: string; accounts: Account[];
  phase: string; ids: Record<string, any>; prepareReport?: string; completeReport?: string };
const manifest: Manifest = complete ? JSON.parse(await readFile(inputManifest!, "utf8")) : {
  schemaVersion: 1, runId: randomUUID().slice(0, 8), prefix: "", database: "signal_independent_fixes_20261007", accounts: [], phase: "preparing", ids: {} };
if (!complete) manifest.prefix = `independent-full-${manifest.runId}-`;
assert.equal(manifest.database, target.pathname.slice(1)); assert.ok(/^independent-full-[a-f0-9]{8}-$/.test(manifest.prefix));
const privatePath = inputManifest ?? join(homedir(), ".codex", "private", `signal-independent-ordinary-${manifest.runId}.json`);
const checks: { name: string; passed: true }[] = [], requests: { method: string; path: string; status: number }[] = [];
const report: any = { schemaVersion: 1, status: "FAIL", phase: complete ? "complete" : "prepare-required-skills", startedAt: new Date().toISOString(),
  origin, appOrigin, mailOrigin, database: manifest.database, synthetic: true, runtimeKind, expectedBundleSha256, checks, requests,
  provisioning: "Ordinary public HTTP registration with SMTP delivery to owned Mailpit; no reviewer provisioning",
  qualificationPresetByDb: false, testPasswordsPublished: false, browserAcceptance: "Separate root browser receipt required",
  qualificationStrategy: complete ? "Server-issued real attempt, owner-scoped oracle-assisted synthetic test answer via HTTP; verifies flow, not human competence or independent assessment difficulty" : "No exam started in prepare phase",
  fixturesRetainedForBrowser: true, privateManifestPath: privatePath };
let activeStep = "guard";
async function saveManifest() { await mkdir(dirname(privatePath), { recursive: true }); await writeFile(privatePath, JSON.stringify(manifest, null, 2)); }
async function step(name: string, action: () => Promise<void>) { activeStep = name; await action(); checks.push({ name, passed: true }); }
class Client {
  cookie = "";
  async request(path: string, method = "GET", body?: unknown, accepted = [200]) {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Accept: "application/json", Origin: appOrigin,
      Cookie: this.cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    for (const item of response.headers.getSetCookie()) this.cookie = item.split(";")[0]!;
    const data = response.headers.get("Content-Type")?.includes("json") ? await response.json() : null;
    requests.push({ method, path, status: response.status });
    assert.ok(accepted.includes(response.status), `${method} ${path}: ${response.status} ${data?.error ?? ""}`);
    return data;
  }
  async login(account: Account) { return this.request("/auth/login", "POST", { email: account.email, password: account.password }); }
}
async function mailCode(email: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200); const result: any = await response.json();
    for (const item of result.messages ?? []) {
      const response = await fetch(`${mailOrigin}/api/v1/message/${encodeURIComponent(item.ID)}`, { signal: AbortSignal.timeout(5000) });
      const message: any = await response.json();
      if (!(message.To ?? item.To ?? []).some((recipient: any) => recipient.Address?.toLowerCase() === email)) continue;
      const code = String(message.Text ?? message.HTML ?? "").match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await delay(250);
  }
  throw new Error("Verification message did not reach the owned local test mailbox");
}
async function register(role: Account["role"], name: string) {
  const client = new Client(), email = `${manifest.prefix}${name}@example.test`, password = `Local-${randomBytes(18).toString("hex")}-aA1!`;
  const registration = await client.request("/auth/register", "POST", { email, password, role,
    displayName: `Синтетическая проверка · ${name} · ${manifest.runId}`, consentTerms: true, consentPrivacy: true }, [201]);
  assert.equal(registration.demoVerificationCode, undefined); assert.equal(registration.verificationCode, undefined);
  const [user] = await db.select().from(users).where(eq(users.email, email)); assert.ok(user);
  assert.equal(user.demoMode, false); assert.equal(user.reviewScopeId, null);
  const account: Account = { role, name, id: user.id, email, password }; manifest.accounts.push(account); await saveManifest();
  await client.request("/auth/login", "POST", { email, password }, [403]);
  const code = await mailCode(email), verified = await client.request("/auth/verify-email", "POST", { email, code });
  assert.equal(verified.user.id, user.id); assert.equal(verified.user.demoMode, false); assert.equal(verified.user.reviewMode, false);
  await client.request("/auth/verify-email", "POST", { email, code }, [400]);
  if (role === "candidate") {
    const initial = await client.request("/me/resumes"); assert.equal(initial.count, 1); account.resumeId = initial.resumes[0].id;
    assert.equal(initial.resumes[0].verifiedGrade, null);
  } else {
    const own = await client.request("/employer/company"); account.companyId = own.company.id;
  }
  await saveManifest(); return { account, client };
}
const needInput = { title: `Синтетическая роль · ${manifest.runId}`, specialization: "Backend / Python", grade: "Middle",
  requiredSkills: ["Python", "SQL"], desirableSkills: ["API contracts"], description: "Синтетическая задача работодателя: учебные интеграции на Python и SQL без доступа к реальным системам.",
  workFormat: "Удалённо", salaryMin: 180000, salaryMax: 250000, salaryPeriod: "month", salaryType: "gross" };
async function companyNeedsCount(companyId: number) { return Number((await pool.query("select count(*)::int n from signal_needs where company_id=$1", [companyId])).rows[0].n); }
async function requirementsCheck(employer: { account: Account; client: Client }) {
  const invalid = [[], [""], [" "], ["\u00a0"], ["\uFEFF"], ["\u2007"], ["\u202F"], ["Python", ""], ["Python", "\u00a0"],
    ["x".repeat(101)], Array.from({ length: 41 }, (_, n) => `Custom required ${n}`), ["\uFB03".repeat(34)]];
  for (const [index, requiredSkills] of invalid.entries()) {
    await step(`required skills rejection ${index + 1} happens before any partial need row`, async () => {
      const before = await companyNeedsCount(employer.account.companyId!);
      const error = await employer.client.request("/employer/needs", "POST", { ...needInput, title: `Invalid requirement ${index} · ${manifest.runId}`, requiredSkills }, [400]);
      assert.equal(error.code, "INVALID_REQUIRED_SKILLS"); assert.ok(error.error.length > 10);
      assert.equal(await companyNeedsCount(employer.account.companyId!), before);
    });
  }
  await step("meaningful aliases and permissible whitespace are canonicalized predictably", async () => {
    const result = await employer.client.request("/employer/needs", "POST", { ...needInput, requiredSkills: ["\u00a0py\u00a0", " SQL ", "PYTHON"] }, [201]);
    assert.deepEqual(result.requiredSkills, ["Python", "SQL"]); assert.deepEqual(result.requirements.map((row: any) => row.id), ["python", "sql"]);
    manifest.ids.needId = result.id; await saveManifest();
  });
  await step("unknown requirement persists with unsupported coverage; conservative Java/JavaScript and SQL/PostgreSQL remain distinct", async () => {
    const unknown = "Обработка учебных платежей";
    const result = await employer.client.request("/employer/needs", "POST", { ...needInput, title: `Unknown requirement · ${manifest.runId}`, requiredSkills: [unknown] }, [201]);
    assert.deepEqual(result.requiredSkills, [unknown]); assert.equal(result.coverage[0].supported, false); assert.equal(result.coverage[0].action, "review_requirement");
    const status = await employer.client.request(`/employer/needs/${result.id}/matching-status`); assert.equal(status.status, "unsupported_requirements");
    assert.deepEqual(await employer.client.request(`/matches?needId=${result.id}`), []);
    const distinct = await employer.client.request("/employer/needs", "POST", { ...needInput, title: `Distinct requirements · ${manifest.runId}`,
      requiredSkills: ["Java", "JavaScript", "SQL", "postgres"] }, [201]);
    assert.deepEqual(distinct.requiredSkills, ["Java", "JavaScript", "SQL", "PostgreSQL"]);
    assert.equal(distinct.requirements[0].id, null); assert.equal(distinct.requirements[1].id, "javascript");
    assert.notEqual(distinct.requirements[2].id, distinct.requirements[3].id);
  });
  await step("100 characters and40 requirements are accepted;41 and101 rejected above", async () => {
    const boundary = await employer.client.request("/employer/needs", "POST", { ...needInput, title: `Boundary40 · ${manifest.runId}`,
      requiredSkills: ["x".repeat(100), ...Array.from({ length: 39 }, (_, n) => `Custom skill ${n}`)] }, [201]);
    assert.equal(boundary.requiredSkills.length, 40); assert.equal(boundary.requiredSkills[0].length, 100);
  });
  await step("historical malformed needs remain stored, visibly invalid and unable to admit anyone", async () => {
    const stored: number[] = [];
    for (const requiredSkills of [[], [""], ["\u00a0"], ["Python", "\uFEFF"]]) {
      const [row] = await db.insert(needs).values({ ...needInput, grade: "Middle", salaryPeriod: "month", salaryType: "gross",
        companyId: employer.account.companyId!, title: `Owned historical invalid · ${manifest.runId}`, requiredSkills }).returning();
      stored.push(row!.id);
      assert.deepEqual(await employer.client.request(`/matches?needId=${row!.id}`), []);
      const status = await employer.client.request(`/employer/needs/${row!.id}/matching-status`);
      assert.equal(status.status, "invalid_requirements"); assert.equal(status.eligibleCount, 0); assert.ok(status.note.includes("сохранится"));
    }
    const list = await employer.client.request("/employer/needs"); assert.ok(stored.every(id => list.some((row: any) => row.id === id)));
    manifest.ids.historicalInvalidNeedIds = stored; await saveManifest();
  });
  report.needWritePaths = "POST /employer/needs is the sole implemented writer; no edit route exists in this revision";
}
const backendQuestionnaire = { version: "backend-python-v1", industry: "Учебные финансовые сервисы / custom", specialization: "Backend / Python",
  answers: { python: 2, databases: 2, api: 2, testing: 2, reliability: 2, ownership: 2 } };
const resumeInput = { summary: "Синтетическое резюме для независимой проверки обычного пользовательского потока. Все работодатели, контакты и решения учебные.",
  softSkills: ["Объяснение инженерных решений", "Точное описание условий"], experience: [], projects: [], education: [], portfolio: [], questionnaire: backendQuestionnaire };
function profileInput(account: Account) {
  return { displayName: `Синтетический инженер · ${manifest.runId}`, professionalAlias: `Audit · Backend · ${manifest.runId}`,
    specialization: "Backend / Python", assumedGrade: "Middle", stack: ["Python", "SQL", "Java", "JavaScript", "PostgreSQL", "Учебная observability"],
    skills: ["Python", "SQL", "API contracts", "Учебная observability"], yearsExperience: 4, workFormat: "Удалённо",
    salaryMin: 180000, salaryMax: 230000, salaryPeriod: "month", salaryType: "gross", visibility: "private", consentMatching: false,
    phone: "+79990000001", contactEmail: account.email };
}
async function ownedAnswers(attemptId: number, account: Account) {
  assert.ok(manifest.accounts.some(row => row.id === account.id && row.email === account.email && row.email.startsWith(manifest.prefix)));
  const [attempt] = await db.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.userId, account.id)));
  assert.ok(attempt); assert.equal(attempt.status, "in_progress");
  return attempt.cases.map(item => ({ caseId: item.id, answer: attempt.oracles[item.id]!.answer }));
}
async function validateManifestOwnership() {
  for (const account of manifest.accounts) {
    const [user] = await db.select().from(users).where(eq(users.id, account.id));
    assert.ok(user && user.email === account.email && account.email.startsWith(manifest.prefix));
    assert.equal(user.demoMode, false); assert.equal(user.reviewScopeId, null); assert.equal(user.role, account.role);
  }
}
try {
  assert.equal((await pool.query("select current_database() as name")).rows[0].name, manifest.database);
  if (!complete) {
    let candidate!: { account: Account; client: Client }, employerA!: { account: Account; client: Client }, employerB!: { account: Account; client: Client };
    await step("ordinary candidate HTTP registration, delivered SMTP mail and single-use verification", async () => { candidate = await register("candidate", "candidate"); });
    await step("ordinary employerA HTTP registration, delivered SMTP mail and single-use verification", async () => { employerA = await register("employer", "employer-a"); });
    await step("ordinary employerB HTTP registration, delivered SMTP mail and single-use verification", async () => { employerB = await register("employer", "employer-b"); });
    await requirementsCheck(employerA);
    await step("own profile dictionary choices and custom text survive save and login; no self-declared grade award", async () => {
      const current = await candidate.client.request(`/me/candidate-profile?resumeId=${candidate.account.resumeId}`);
      await candidate.client.request(`/me/candidate-profile?resumeId=${candidate.account.resumeId}`, "PUT", { ...profileInput(candidate.account), resumeId: current.resumeId, revision: current.revision, identityRevision: current.identityRevision });
      await candidate.client.request(`/me/resumes/${candidate.account.resumeId}`, "PUT", resumeInput);
      await candidate.client.request("/auth/logout", "POST"); await candidate.client.login(candidate.account);
      const profile = await candidate.client.request(`/me/candidate-profile?resumeId=${candidate.account.resumeId}`);
      assert.deepEqual(profile.stack, profileInput(candidate.account).stack); assert.equal(profile.verifiedGrade, null);
      const saved = await candidate.client.request(`/me/resumes/${candidate.account.resumeId}`);
      assert.deepEqual(saved.questionnaire, backendQuestionnaire); assert.equal(saved.recommendation.grade, "Middle");
      assert.equal(saved.qualification.verifiedGrade, null);
    });
    manifest.phase = "prepared-awaiting-final-bank";
  } else {
    await validateManifestOwnership(); assert.equal(manifest.phase, "prepared-awaiting-final-bank");
    const candidateAccount = manifest.accounts.find(row => row.role === "candidate")!,
      employerAccount = manifest.accounts.find(row => row.name === "employer-a")!, otherEmployerAccount = manifest.accounts.find(row => row.name === "employer-b")!;
    const candidate = new Client(), employer = new Client(), otherEmployer = new Client();
    await candidate.login(candidateAccount); await employer.login(employerAccount); await otherEmployer.login(otherEmployerAccount);
    const primaryId = candidateAccount.resumeId!, needId = manifest.ids.needId;
    let backendAttempt: any, backendResult: any, secondaryId = 0, frontendId = 0, copyId = 0, fifthId = 0;
    await step("real Backend Middle attempt starts with explicit purpose and declared grade; owner-private draft survives logout/login", async () => {
      backendAttempt = await candidate.request("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true,
        programId: "backend-python", grade: "Middle", resumeId: primaryId, contextId: "api-platform" }, [201]);
      assert.equal(backendAttempt.purpose, "signal_qualification"); assert.ok(backendAttempt.cases.length >= 6); assert.equal(backendAttempt.oracles, undefined);
      const answers = await ownedAnswers(backendAttempt.id, candidateAccount);
      await candidate.request(`/assessments/attempts/${backendAttempt.id}/answers`, "PUT", { answers: [answers[0]] });
      await candidate.request("/auth/logout", "POST"); await candidate.login(candidateAccount);
      const resumed = await candidate.request(`/assessments/attempts/${backendAttempt.id}`);
      assert.equal(resumed.cases[0].savedAnswer, answers[0]!.answer);
      const exact = await candidate.request("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true,
        programId: "backend-python", grade: "Middle", resumeId: primaryId, contextId: "api-platform" });
      assert.equal(exact.id, backendAttempt.id); await candidate.request(`/assessments/attempts/${backendAttempt.id}/answers`, "PUT", { answers });
      backendResult = await candidate.request(`/assessments/attempts/${backendAttempt.id}/submit`, "POST", {});
      assert.equal(backendResult.score, 100); assert.equal(backendResult.verified, true); assert.equal(backendResult.grade, "Middle");
      assert.deepEqual(await candidate.request(`/assessments/attempts/${backendAttempt.id}/submit`, "POST", {}), backendResult);
      manifest.ids.backendAttemptId = backendAttempt.id; await saveManifest();
      report.backend = { attemptId: backendAttempt.id, purpose: backendAttempt.purpose, programVersion: backendAttempt.programVersion,
        score: backendResult.score, verified: backendResult.verified, grade: backendResult.grade, source: "HTTP-issued/answered/submitted; no DB preset" };
    });
    await step("five resumes: same-program copy preserves original source/date, different program gets no inherited grade; limit excludes sixth", async () => {
      secondaryId = (await candidate.request(`/me/resumes/${primaryId}/copy`, "POST", { title: "Backend · открытое вторичное · audit" }, [201])).id;
      frontendId = (await candidate.request("/me/resumes", "POST", { title: "Frontend · независимая программа · audit", specialization: "Frontend / TypeScript", copyFromId: primaryId }, [201])).id;
      copyId = (await candidate.request(`/me/resumes/${secondaryId}/copy`, "POST", { title: "Backend · сохранённый источник · audit" }, [201])).id;
      fifthId = (await candidate.request("/me/resumes", "POST", { title: "Backend · пятое резюме · audit", specialization: "Backend / Python" }, [201])).id;
      const list = await candidate.request("/me/resumes"); assert.equal(list.count, 5);
      const primary = list.resumes.find((row: any) => row.id === primaryId), secondary = list.resumes.find((row: any) => row.id === secondaryId), copy = list.resumes.find((row: any) => row.id === copyId);
      const source = (row: any) => row.qualification.evidence.map((item: any) => ({ attemptId: item.attemptId, date: item.date, skill: item.skill, criterionId: item.criterionId }));
      assert.ok(primary.qualification.evidence.length > 0); assert.deepEqual(source(secondary), source(primary)); assert.deepEqual(source(copy), source(primary));
      assert.equal(secondary.verifiedGrade, "Middle"); assert.equal(list.resumes.find((row: any) => row.id === frontendId).verifiedGrade, null);
      await candidate.request("/me/resumes", "POST", { title: "Sixth denied", specialization: "Backend / Python" }, [409]);
      await candidate.request(`/me/resumes/${secondaryId}/copy`, "POST", {}, [409]);
      manifest.ids.secondaryResumeId = secondaryId; manifest.ids.frontendResumeId = frontendId; manifest.ids.copyResumeId = copyId; manifest.ids.fifthResumeId = fifthId; await saveManifest();
    });
    await step("Frontend Junior independently earned through its own genuine HTTP exam; Backend keeps Middle", async () => {
      const frontQuestionnaire = { version: "frontend-typescript-v1", industry: "Учебные интерфейсы / custom", specialization: "Frontend / TypeScript",
        answers: { typescript: 0, state: 0, accessibility: 0, performance: 0, architecture: 0, ownership: 0 } };
      await candidate.request(`/me/resumes/${frontendId}`, "PUT", { ...resumeInput, questionnaire: frontQuestionnaire });
      const front = await candidate.request("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true,
        programId: "frontend-typescript", grade: "Junior", resumeId: frontendId }, [201]);
      const answers = await ownedAnswers(front.id, candidateAccount); await candidate.request(`/assessments/attempts/${front.id}/answers`, "PUT", { answers });
      const result = await candidate.request(`/assessments/attempts/${front.id}/submit`, "POST", {}); assert.equal(result.verified, true); assert.equal(result.grade, "Junior");
      const list = await candidate.request("/me/resumes"); assert.equal(list.resumes.find((row: any) => row.id === primaryId).verifiedGrade, "Middle");
      assert.equal(list.resumes.find((row: any) => row.id === frontendId).verifiedGrade, "Junior");
      manifest.ids.frontendAttemptId = front.id; await saveManifest();
      report.frontend = { attemptId: front.id, programVersion: front.programVersion, grade: result.grade, score: result.score, independentFromBackend: true };
    });
    await step("private primary plus open exact secondary; catalog person dedup and source registry stay accurate", async () => {
      await candidate.request(`/me/resumes/${primaryId}`, "PATCH", { visibility: "private", consentMatching: false, consentCatalog: false, readyForOffers: false });
      await candidate.request(`/me/resumes/${secondaryId}`, "PATCH", { visibility: "pseudonymous", consentMatching: true, consentCatalog: true, readyForOffers: true });
      await candidate.request(`/me/resumes/${frontendId}`, "PATCH", { visibility: "pseudonymous", consentMatching: false, consentCatalog: true, readyForOffers: false });
      await candidate.request(`/me/resumes/${frontendId}/primary`, "POST", {}); await candidate.request(`/me/resumes/${primaryId}/primary`, "POST", {});
      const registry = await candidate.request("/me/evidence/registry"); assert.ok(JSON.stringify(registry).includes(String(backendAttempt.id))); assert.ok(JSON.stringify(registry).includes(String(manifest.ids.frontendAttemptId)));
      const bank = await employer.request(`/employer/candidates?q=${encodeURIComponent(`Audit · Backend · ${manifest.runId}`)}`);
      assert.equal(bank.candidates.length, 1); assert.equal(bank.candidates[0].candidateId, candidateAccount.id); assert.equal(bank.candidates[0].availableResumes.length, 2);
      assert.equal("contactEmail" in bank.candidates[0], false); assert.equal("phone" in bank.candidates[0], false);
      const frontBank = await employer.request(`/employer/candidates?q=${encodeURIComponent(manifest.runId)}&specialization=${encodeURIComponent("Frontend / TypeScript")}`);
      assert.equal(frontBank.candidates[0].resumeId, frontendId); assert.equal(frontBank.candidates[0].verifiedGrade, "Junior");
      manifest.ids.evidenceCount = registry.observations?.length ?? registry.evidence?.length ?? null; await saveManifest();
    });
    await step("employer matching, explanation and comparison use selected open secondary and preserve mandatory unknown requirements", async () => {
      const matches = await employer.request(`/matches?needId=${needId}`), match = matches.find((row: any) => row.candidateId === candidateAccount.id);
      assert.ok(match); assert.equal(match.resumeId, secondaryId); assert.equal(match.verifiedGrade, "Middle");
      const explanation = await employer.request(`/matches/explanation?needId=${needId}&candidateId=${candidateAccount.id}&resumeId=${secondaryId}`);
      assert.equal(explanation.resumeId, secondaryId);
      const comparison = await employer.request(`/employer/compare?needId=${needId}&leftResumeId=${secondaryId}&rightResumeId=${frontendId}`);
      assert.equal(comparison.left.resumeId, secondaryId); assert.equal(comparison.right.resumeId, frontendId);
      assert.equal(comparison.left.evaluation.eligible, true); assert.equal(comparison.right.evaluation.eligible, false);
      const unknown = await employer.request("/employer/needs", "POST", { ...needInput, title: `Strict unknown post-exam · ${manifest.runId}`, requiredSkills: ["Python", "Обработка учебных платежей"] }, [201]);
      assert.equal((await employer.request(`/matches?needId=${unknown.id}`)).some((row: any) => row.candidateId === candidateAccount.id), false);
      await otherEmployer.request(`/matches?needId=${needId}`, "GET", undefined, [404]);
      report.matching = { needId, resumeId: match.resumeId, candidateId: candidateAccount.id, grade: match.verifiedGrade,
        businessFit: match.baseScore ?? match.score ?? null, comparisonRightGrade: comparison.right.verifiedGrade, comparisonRightEligible: false };
    });
    await step("exact-resume addressable invitation with salary conditions opens only its company after acceptance; revoke/replay stays closed", async () => {
      const inviteBody = { idempotencyKey: `independent_${manifest.runId}_invitation`, needId, candidateId: candidateAccount.id, resumeId: secondaryId,
        title: "Учебное приглашение обсудить роль", message: "Синтетическое приглашение: обсудим учебные задачи Python и SQL и прозрачные условия.",
        reason: "Подтверждённые Python и SQL соответствуют обязательным навыкам потребности.", salaryMin: 190000, salaryMax: 240000,
        salaryPeriod: "month", salaryType: "gross", workFormat: "Удалённо" };
      const invitation = await employer.request("/employer/invitations", "POST", inviteBody, [201]);
      assert.equal(invitation.resumeId, secondaryId); assert.equal(invitation.salaryMin, inviteBody.salaryMin); assert.equal(invitation.salaryMax, inviteBody.salaryMax);
      await employer.request(`/employer/invitations/${invitation.id}/contacts`, "GET", undefined, [403]);
      await otherEmployer.request(`/employer/invitations/${invitation.id}/contacts`, "GET", undefined, [403, 404]);
      const accepted = await candidate.request(`/me/invitations/${invitation.id}/decision`, "POST", { decision: "accept" });
      assert.equal(accepted.invitation.contactShared, true);
      const contacts = await employer.request(`/employer/invitations/${invitation.id}/contacts`); assert.equal(contacts.email, candidateAccount.email);
      await otherEmployer.request(`/employer/invitations/${invitation.id}/contacts`, "GET", undefined, [403, 404]);
      await candidate.request(`/me/invitations/${invitation.id}/revoke-contact`, "POST", {});
      await candidate.request(`/me/invitations/${invitation.id}/decision`, "POST", { decision: "accept" });
      await employer.request(`/employer/invitations/${invitation.id}/contacts`, "GET", undefined, [403]);
      const rows = await db.select().from(grants).where(eq(grants.invitationId, invitation.id)); assert.equal(rows.length, 1); assert.ok(rows[0]!.revokedAt);
      manifest.ids.invitationId = invitation.id; await saveManifest();
      report.invitation = { id: invitation.id, resumeId: secondaryId, salaryMin: inviteBody.salaryMin, salaryMax: inviteBody.salaryMax,
        period: "month", salaryType: "gross", accepted: true, ownCompanyContactOpened: true, otherCompanyDenied: true,
        revoked: true, oldAcceptanceReplayStayedRevoked: true };
    });
    await step("company practice search finds exact secondary, captures rubric, evaluates owner answer without changing Signal qualification", async () => {
      await candidate.request("/me/microtasks/preferences", "PUT", { enabled: true });
      const template = await employer.request("/employer/microtasks", "POST", { title: `Учебная практика · ${manifest.runId}`,
        specialization: "Backend / Python", competency: "Idempotency", scenario: "Синтетическая библиотека принимает повторные запросы. Объясните правило ключа повтора и два теста; производственный код и доступ к системам не нужны.",
        educationalOnly: true, expectedMinutes: 20, intervalDays: 7, deadlineDays: 3,
        rubric: [{ id: "rule", label: "Правило повторного идентификатора", maxPoints: 4 }, { id: "tests", label: "Проверяемые учебные сценарии", maxPoints: 3 }] }, [201]);
      const page = await employer.request(`/employer/microtasks/eligible/candidates?templateId=${template.id}&search=${encodeURIComponent("открытое вторичное")}`);
      const selected = page.items.find((row: any) => row.id === candidateAccount.id && row.resumeId === secondaryId); assert.ok(selected);
      const subscription = await employer.request(`/employer/microtasks/${template.id}/subscriptions`, "POST", { candidateId: selected.id, resumeId: selected.resumeId });
      assert.equal(subscription.resumeId, secondaryId);
      const own = await candidate.request("/me/microtasks"), offer = own.offers.find((row: any) => row.subscriptionId === subscription.id); assert.ok(offer);
      assert.equal(offer.resumeId, secondaryId); assert.equal(offer.resumeContext.verifiedGrade, "Middle");
      const qualificationBefore = (await candidate.request(`/me/resumes/${secondaryId}`)).qualification;
      await candidate.request(`/me/microtasks/${offer.id}/decision`, "POST", { decision: "accept", consentCompanyReview: true });
      await candidate.request(`/me/microtasks/${offer.id}/submit`, "POST", { answer: "Синтетический учебный ответ: ключ повтора хранится атомарно с итогом; повтор возвращает сохранённый итог. Два теста: повтор одного ключа и сбой до фиксации." });
      const result = await employer.request(`/employer/microtasks/offers/${offer.id}/evaluate`, "POST", { scores: [
        { criterionId: "rule", points: 4, comment: "Явное объяснение учебного ключа." }, { criterionId: "tests", points: 3, comment: "Два учебных сценария указаны." }],
        feedback: "Синтетическая оценка компании по сохранённой рубрике, отдельно от экзамена Signal." });
      assert.equal(result.result.total, 7); assert.equal(result.result.max, 7); assert.equal(result.result.qualificationEffect, "none"); assert.equal(result.result.purpose, "company_task");
      assert.deepEqual((await candidate.request(`/me/resumes/${secondaryId}`)).qualification, qualificationBefore);
      manifest.ids.microTemplateId = template.id; manifest.ids.microSubscriptionId = subscription.id; manifest.ids.microOfferId = offer.id; await saveManifest();
      report.practice = { templateId: template.id, subscriptionId: subscription.id, offerId: offer.id, resumeId: secondaryId,
        companyScore: "7/7", purpose: result.result.purpose, qualificationEffect: result.result.qualificationEffect, signalGradeUnchanged: true };
    });
    manifest.phase = "completed-awaiting-browser";
  }
  report.status = "PASS";
} catch (error) { report.failedStep = activeStep; report.failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  report.completedAt = new Date().toISOString(); report.userIds = manifest.accounts.map(row => row.id); report.ids = manifest.ids;
  report.ownedOrdinaryUsers = manifest.accounts.length; report.currentSourceHashes = Object.fromEntries(await Promise.all([
    "scripts/independent-fixes-full-http.ts", "artifacts/api-server/src/routes/signal-auth.ts", "artifacts/api-server/src/routes/signal-profile-assessments.ts",
    "artifacts/api-server/src/routes/signal-employer-matching.ts", "artifacts/api-server/src/lib/employer-required-skills.ts",
    "artifacts/api-server/src/routes/signal-microtasks.ts", "artifacts/api-server/src/lib/assessment-managed.ts",
    "artifacts/api-server/src/lib/assessment-bank.ts"].map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const output = `outputs/verification/independent-fixes-20261007/full-http-${manifest.runId}-${complete ? "complete" : "prepare"}-${Date.now()}.json`;
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
  if (complete) manifest.completeReport = output; else manifest.prepareReport = output; await saveManifest();
  console.info(JSON.stringify({ status: report.status, checks: checks.length, requests: requests.length, output, privateManifestPath: privatePath,
    failedStep: report.failedStep ?? null, failure: report.failure ?? null }));
  await pool.end();
}
