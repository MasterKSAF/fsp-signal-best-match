/** Local scoped integration fixtures. Real registration is covered by integration-test.ts.
 * This suite seeds verified synthetic accounts, then uses ordinary authenticated HTTP.
 * Oracle reads are local test-only; no answer/key is printed or put in a public report.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, signalUsersTable as users, signalAssessmentAttemptsTable as attempts, signalBankTemplateOverridesTable as overrides, signalBankAuditTable as audit } from "../lib/db/src/index";
import { hashPassword } from "../artifacts/api-server/src/lib/signal-auth";
import { assembleAttempt } from "../artifacts/api-server/src/lib/assessment-bank";
import { managedTemplates, exposedTemplateIds, assembleManagedAttempt, assessmentPrograms } from "../artifacts/api-server/src/lib/assessment-managed";
import { emptyResume } from "../artifacts/api-server/src/lib/signal-resume-contract";

const origin = process.env.INTEGRATION_API_ORIGIN ?? "http://127.0.0.1:4312";
const appOrigin = process.env.INTEGRATION_APP_ORIGIN ?? process.env.PUBLIC_URL ?? "http://127.0.0.1:4310";
for (const url of [origin, appOrigin, process.env.DATABASE_URL ?? ""]) assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Only local services are allowed");
if (process.env.SIGNAL_ISOLATED_STAGE_ACCEPTANCE === '1') {
  const stage = new URL(process.env.DATABASE_URL!); assert.equal(stage.hostname, '127.0.0.1'); assert.equal(stage.port, '55435'); assert.equal(stage.pathname, '/signal_resume_stage');
  assert.equal(origin, 'http://127.0.0.1:4313'); assert.equal(appOrigin, 'http://127.0.0.1:4314');
}
const runId = `bank-qa-${randomUUID()}`;
const captured: number[] = []; const changedOverrides = new Map<string, typeof overrides.$inferSelect | null>();
const checks: string[] = []; const started = Date.now();
const pass = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
const sourcePaths=["artifacts/api-server/src/lib/assessment-managed.ts","artifacts/api-server/src/lib/assessment-bank.ts","artifacts/api-server/src/routes/signal-profile-assessments.ts"];
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async file=>[file,createHash("sha256").update(await readFile(file)).digest("hex")])));
const dockerContainer=process.env.INTEGRATION_DOCKER_CONTAINER;
function dockerIdentity() {
  if(!dockerContainer)return null;
  const image=execFileSync("docker",["inspect",dockerContainer,"--format","{{.Image}}"],{encoding:"utf8",timeout:10000}).trim();
  const script=`const fs=require('fs'),crypto=require('crypto'); console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(sourcePaths)}.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync('/app/'+p)).digest('hex')]))));`;
  const hashes=JSON.parse(execFileSync("docker",["exec",dockerContainer,"node","-e",script],{encoding:"utf8",timeout:10000}));
  assert.deepEqual(hashes,sourceHashes,"Actual served Docker assessment source differs from local test inputs");
  return {container:dockerContainer,image,sourceHashes:hashes};
}
const dockerBefore=dockerIdentity();
class Client {
  cookie = "";
  async request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Origin: appOrigin, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const cookie = response.headers.getSetCookie().find(value => value.startsWith("fsp_signal_session=")); if (cookie) this.cookie = cookie.split(";")[0]!;
    const bytes = Buffer.from(await response.arrayBuffer()); let data: any; try { data = JSON.parse(bytes.toString()); } catch {}
    return { status: response.status, data, bytes, headers: response.headers };
  }
  async ok(path: string, method = "GET", body?: unknown, expected = [200]) { const result = await this.request(path, method, body); assert.ok(expected.includes(result.status), `${method} ${path}: ${result.status} ${result.data?.error ?? ""}`); return result.data; }
}
async function fixture(suffix: string, specialization = "Frontend / TypeScript") {
  const password = randomUUID(); const email = `${runId}-${suffix.toLowerCase()}@example.test`;
  const [user] = await db.insert(users).values({ email, passwordHash: await hashPassword(password), role: "candidate", displayName: "Синтетический участник проверки", emailVerified: true, demoMode: false }).returning();
  captured.push(user!.id); const client = new Client(); await client.ok("/auth/login", "POST", { email, password });
  await client.ok("/me/candidate-profile", "PUT", { displayName: "Синтетический участник проверки", professionalAlias: `Проверка ${suffix}`, specialization, assumedGrade: "Senior", stack: [specialization === "Frontend / TypeScript" ? "TypeScript" : "Python"], skills: [], yearsExperience: 2, workFormat: "Удалённо", salaryMin: 100000, salaryMax: 180000, salaryPeriod: "month", salaryType: "gross", visibility: "private", consentMatching: false, phone: null, contactEmail: email });
  const owned = await client.ok('/me/resumes');
  const primary = owned.resumes.find((row: any) => row.isPrimary); assert.ok(primary);
  return { id: user!.id, client, specialization, resumeId: primary.id as number };
}
async function questionnaire(person: Awaited<ReturnType<typeof fixture>>) {
  const resume = emptyResume(person.specialization);
  for (const key of Object.keys(resume.questionnaire.answers)) (resume.questionnaire.answers as Record<string, number | null>)[key] = 2;
  const response = await person.client.ok("/me/resume", "PUT", resume);
  assert.equal(response.recommendation.grade, "Middle"); return response;
}
async function solve(person: Awaited<ReturnType<typeof fixture>>, attemptId: number) {
  const [stored] = await db.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.userId, person.id)));
  assert.ok(stored);
  const answers = stored.cases.map(item => ({ caseId: item.id, answer: stored.oracles[item.id]!.answer }));
  await person.client.ok(`/assessments/attempts/${attemptId}/answers`, "PUT", { answers });
  const result = await person.client.ok(`/assessments/attempts/${attemptId}/submit`, "POST");
  assert.equal(result.verified, true); assert.equal(result.score, 100);
  assert.equal(result.evidence.every((item: any) => item.sourceType === "signal_assessment" && item.candidateUserId === person.id && item.attemptId === attemptId), true);
  assert.doesNotMatch(JSON.stringify(result), /"answer"|"blueprint"|"seed"|"oracles"/);
  return { stored, result };
}
function manage(command: string, ...args: string[]) { execFileSync(process.execPath, ["--import", "tsx", "scripts/manage-assessment-bank.ts", command, ...args, "--operator", runId, "--reason", "Синтетическая техническая проверка управления банком; временная запись"], { cwd: process.cwd(), env: process.env, stdio: "pipe", timeout: 15000 }); }
async function override(templateId: string, action: "enable" | "disable") {
  if (!changedOverrides.has(templateId)) { const [old] = await db.select().from(overrides).where(eq(overrides.templateId, templateId)); changedOverrides.set(templateId, old ?? null); }
  manage(action, "--template", templateId);
}
let success = false;
let previousAttemptId: number | null = null;
let dockerAfter: ReturnType<typeof dockerIdentity> = null;
try {
  if (process.env.SIGNAL_ISOLATED_STAGE_ACCEPTANCE === '1') assert.equal((await pool.query('select current_database() as name')).rows[0]?.name, 'signal_resume_stage');
  const anonymous = new Client();
  const programs = await anonymous.ok("/assessments/programs");
  assert.deepEqual(programs.filter((x: any) => x.available).map((x: any) => x.id), ["backend-python", "frontend-typescript"]);
  const registry = await anonymous.ok("/assessments/programs/frontend-typescript/competencies");
  assert.equal(registry.templates.length, 36); assert.doesNotMatch(JSON.stringify(registry), /"answer"|"seed"|"oracles"/);
  assert.equal((await anonymous.request("/assessments/contexts?programId=frontend-typescript")).status, 401);
  pass("Two complete public programs and key-free template registry; private contexts require authentication");
  for (const grade of ["Junior", "Middle", "Senior"] as const) {
    const person = await fixture(grade);
    assert.equal((await person.client.request("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade })).status, 409);
    const resume = await questionnaire(person); assert.equal(resume.questionnaire.version, "frontend-typescript-v1");
    assert.equal(resume.questions[0].key, "typescript"); assert.equal(resume.questionSets["Frontend / TypeScript"].length, 6);
    assert.equal((await person.client.ok("/assessments/contexts?programId=frontend-typescript")).profiles.length, 3);
    assert.equal((await person.client.request("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade, contextId: "api-platform" })).status, 400);
    const first = await person.client.ok("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade, contextId: "frontend-product" }, [201]);
    assert.doesNotMatch(JSON.stringify(first), /"answer"|"seed"|"oracles"|"blueprint"/);
    assert.equal((await anonymous.request(`/assessments/attempts/${first.id}`)).status, 401);
    if (previousAttemptId !== null) {
      assert.equal((await person.client.request(`/assessments/attempts/${previousAttemptId}`)).status, 404);
      assert.equal((await person.client.request(`/assessments/attempts/${previousAttemptId}/answers`, "PUT", { answers: [] })).status, 404);
      assert.equal((await person.client.request(`/assessments/attempts/${previousAttemptId}/submit`, "POST")).status, 404);
    }
    previousAttemptId = first.id;
    const { result } = await solve(person, first.id); assert.ok(result.evidence.every((item: any, slot: number) => item.programVersion === "signal-frontend-typescript-v2" && item.templateId && item.templateVersion === (grade === "Senior" && slot === 4 ? 2 : 1)));
    const profile = await person.client.ok("/me/candidate-profile"); assert.equal(profile.verifiedGrade, grade); assert.ok(profile.verifiedSkills.includes("TypeScript")); assert.equal(profile.verifiedSkills.includes("React"), false);
    const repeated = await person.client.ok(`/assessments/attempts/${first.id}/submit`, "POST"); assert.deepEqual(repeated, result);
    assert.equal((await person.client.request("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade })).status, 409);
    const pdf = await person.client.request("/me/resume/pdf"); assert.equal(pdf.status, 200); assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
    const history = await person.client.ok("/assessments/history"); assert.equal(history.attempts[0].bankVersion, "signal-frontend-typescript-v2");
    pass(`Frontend ${grade}: ordinary questionnaire, role, private ownership, save/grade, provenance, PDF, immutable repeat and cooldown`);
    if (grade === "Senior") {
      const lower = await person.client.ok("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade: "Junior" }, [201]);
      await solve(person, lower.id);
      const after = await person.client.ok("/me/candidate-profile"); assert.equal(after.verifiedGrade, "Senior"); assert.equal(after.latestAssessmentAt, profile.latestAssessmentAt);
      manage("annul", "--attempt", String(first.id));
      const corrected = await person.client.ok(`/assessments/attempts/${first.id}`);
      assert.equal(corrected.result.verified, false); assert.equal(corrected.result.evidence.length, 0); assert.ok(corrected.result.correctionReason);
      const restored = await person.client.ok("/me/candidate-profile"); assert.equal(restored.verifiedGrade, "Junior");
      const [seniorSnapshot] = await db.select().from(attempts).where(eq(attempts.id, first.id)); assert.equal(seniorSnapshot!.verified, true, "Original decision not overwritten");
      assert.equal((await person.client.request("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade: "Middle" })).status, 409, "Correction must not waive promotion rules for a different grade");
      const afterCorrection = await person.client.ok("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade: "Senior" }, [201]);
      assert.equal((await person.client.ok("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade: "Senior" })).id, afterCorrection.id, "The replacement resumes idempotently");
      pass("Lower successful attempt does not refresh Senior; explicit annulment keeps snapshot, restores prior proof and releases affected cooldown");
      // Both assigned scenarios for one competency can be blocked only for the next attempt.
      const blocked = managedTemplates.filter(item => item.programId === "frontend-typescript" && item.grade === "Senior" && item.slot === 0);
      for (const template of blocked) await override(template.id, "disable");
      await person.client.ok(`/assessments/attempts/${afterCorrection.id}`); // Issued attempt remains active by policy.
      manage("annul", "--attempt", String(afterCorrection.id));
      assert.equal((await person.client.request("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade: "Senior" })).status, 503);
      await override(blocked[0]!.id, "enable");
      const newAttempt = await person.client.ok("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade: "Senior" }, [201]);
      const [newSnapshot] = await db.select().from(attempts).where(eq(attempts.id, newAttempt.id)); assert.ok(!exposedTemplateIds(newSnapshot!.oracles).includes(blocked[1]!.id));
      pass("Availability override: active snapshots continue, exhausted competency rejects new attempt, disabled scenario stays excluded");
      const failedReplacement = await person.client.ok(`/assessments/attempts/${newAttempt.id}/submit`, "POST");
      assert.equal(failedReplacement.verified, false);
      const afterFailure = await person.client.ok("/me/candidate-profile");
      assert.equal(afterFailure.verifiedGrade, restored.verifiedGrade); assert.equal(afterFailure.latestAssessmentAt, restored.latestAssessmentAt);
      assert.equal((await person.client.request("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: person.resumeId, programId: "frontend-typescript", grade: "Senior" })).status, 409, "Replacement decision consumes the narrow correction exception");
      pass("Correction exception is grade-scoped and ends after a replacement decision; failed attempt never refreshes older proof");
    }
  }
  const legacy = await fixture("legacy", "Backend / Python"); await questionnaire(legacy);
  const oldForm = assembleAttempt("Middle", `${runId}-legacy`);
  const [oldAttempt] = await db.insert(attempts).values({ userId: legacy.id, resumeId: legacy.resumeId, resumeSpecialization: legacy.specialization, programId: "backend-python", programVersion: 'kalibr-backend-python-v4', grade: "Middle", cases: oldForm.cases, oracles: oldForm.oracles, answers: [], startedAt: new Date(), dueAt: new Date(Date.now() + 45 * 60000) }).returning();
  const resumed = await legacy.client.ok("/assessments/attempts", "POST", { purpose: "signal_qualification", gradeConfirmed: true, resumeId: legacy.resumeId, programId: "backend-python", grade: "Middle" }); assert.equal(resumed.id, oldAttempt!.id);
  await solve(legacy, oldAttempt!.id);
  assert.equal((await legacy.client.ok("/assessments/history")).attempts[0].bankVersion, "kalibr-backend-python-v4");
  pass("Previously issued v4 attempt resumes and grades with its original snapshot after v5 deployment");
  for(const programId of ["backend-python","frontend-typescript"] as const) {
    const specialization=programId==="backend-python"?"Backend / Python":"Frontend / TypeScript";
    const currentPerson=await fixture(`${programId}-current`,specialization);await questionnaire(currentPerson);
    const currentAttempt=await currentPerson.client.ok("/assessments/attempts","POST",{ purpose: "signal_qualification", gradeConfirmed: true, resumeId: currentPerson.resumeId,programId,grade:"Senior"},[201]);
    const [snapshot]=await db.select().from(attempts).where(eq(attempts.id,currentAttempt.id));assert.ok(snapshot);
    const answers=snapshot.cases.map((task,slot)=>({caseId:task.id,answer:slot===4?"":snapshot.oracles[task.id]!.answer}));
    await currentPerson.client.ok(`/assessments/attempts/${currentAttempt.id}/answers`,"PUT",{answers});
    const rejected=await currentPerson.client.ok(`/assessments/attempts/${currentAttempt.id}/submit`,"POST");
    assert.equal(rejected.score,83);assert.equal(rejected.verified,false);
    assert.equal((await currentPerson.client.ok("/me/candidate-profile")).verifiedGrade,null);
    const oldPerson=await fixture(`${programId}-historical`,specialization);await questionnaire(oldPerson);
    const form=assembleManagedAttempt(programId,"Senior",`${runId}-${programId}-historical`);
    const oldVersion=programId==="backend-python"?"signal-backend-python-v5":"signal-frontend-typescript-v1";
    const oldCases=form.cases.map(task=>({...task,id:task.id.replace(/signal-backend-python-v6|signal-frontend-typescript-v2/,oldVersion)}));
    const oldOracles=Object.fromEntries(form.cases.map((task,slot)=>[oldCases[slot]!.id,{...form.oracles[task.id]!,blueprint:{...form.oracles[task.id]!.blueprint,version:oldVersion,critical:[0,1,3].includes(slot),templateVersion:1}}]));
    const [saved]=await db.insert(attempts).values({userId:oldPerson.id,programId,grade:"Senior",cases:oldCases,oracles:oldOracles,answers:[],startedAt:new Date(),dueAt:new Date(Date.now()+45*60000)}).returning();
    assert.ok(saved);const oldSnapshot=JSON.stringify(saved.oracles);
    const oldAnswers=oldCases.map((task,slot)=>({caseId:task.id,answer:slot===4?"":oldOracles[task.id]!.answer}));
    await oldPerson.client.ok(`/assessments/attempts/${saved.id}/answers`,"PUT",{answers:oldAnswers});
    const accepted=await oldPerson.client.ok(`/assessments/attempts/${saved.id}/submit`,"POST");assert.equal(accepted.score,83);assert.equal(accepted.verified,true);
    const [stillSaved]=await db.select().from(attempts).where(eq(attempts.id,saved.id));assert.equal(JSON.stringify(stillSaved!.oracles),oldSnapshot);
    assert.equal((await oldPerson.client.ok("/assessments/history")).attempts[0].bankVersion,oldVersion);
    pass(`${programId}: new Senior architecture gap rejects 83 points; historical v5/v1 snapshot retains its original 83-point decision and immutable rubric`);
  }
  dockerAfter=dockerIdentity();assert.deepEqual(dockerAfter,dockerBefore,"Served image changed during HTTP checks");success = true;
} finally {
  for (const [id, previous] of changedOverrides) {
    const [current] = await db.select().from(overrides).where(eq(overrides.templateId, id));
    if (current?.operator !== runId) throw new Error("Availability changed by another operator; automatic restoration skipped to protect their change.");
    if (previous) await db.update(overrides).set(previous).where(eq(overrides.templateId, id)); else await db.delete(overrides).where(eq(overrides.templateId, id));
  }
  await db.delete(audit).where(eq(audit.operator, runId));
  if (captured.length) await db.delete(users).where(inArray(users.id, captured));
  await mkdir("outputs/verification", { recursive: true });
  await writeFile(process.env.INTEGRATION_REPORT_PATH || "outputs/verification/assessment-managed-http.json", JSON.stringify({ generatedAt: new Date().toISOString(), passed: success, provenance: "Synthetic scoped integration fixtures, not a human validation study", groups: checks.length, checks, durationMs: Date.now() - started, apiOrigin: origin, appOrigin,programVersions:Object.fromEntries(assessmentPrograms.map(program=>[program.id,program.version])),sourceHashes,scriptSha256:createHash("sha256").update(await readFile("scripts/integration-assessment-managed.ts")).digest("hex"),dockerBefore,dockerAfter, cleanup: "Exact created users and test-owned availability overrides restored; no seed, private answers or user rows exported" }, null, 2));
  await pool.end();
}
