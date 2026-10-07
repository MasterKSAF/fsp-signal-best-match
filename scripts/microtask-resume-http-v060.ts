/** Owned synthetic practice fixtures; not an exam or human-grade validation. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import { homedir } from "node:os";
import { join } from "node:path";
const origin = process.env.API_ORIGIN ?? "", databaseUrl = new URL(process.env.DATABASE_URL ?? "");
const compiledTarget = process.env.SIGNAL_V060_COMPILED_ACCEPTANCE === "1";
assert.equal(origin, compiledTarget ? "http://127.0.0.1:4365" : "http://127.0.0.1:4363");
assert.equal(databaseUrl.hostname, "127.0.0.1"); assert.equal(databaseUrl.port, "55435");
assert.equal(databaseUrl.pathname, compiledTarget ? "/signal_resume_v060_compiled_check" : "/signal_resume_v060_check");
assert.equal(process.env.SIGNAL_MICROTASK_RESUME_HTTP_PROBE, "true");
const { db, pool, signalUsersTable: users, signalSessionsTable: sessions, signalCandidateProfilesTable: profiles,
  signalCandidateResumesTable: resumes, signalCompaniesTable: companies, signalMicroTemplatesTable: templates,
  signalMicroSubscriptionsTable: subscriptions, signalMicroOffersTable: offers } = await import("../lib/db/src/index.ts");
const { runMicrotaskScheduler } = await import("../artifacts/api-server/src/lib/microtask-scheduler.ts");
const { revokeMicrotasksForResume } = await import("../artifacts/api-server/src/lib/microtask-resume.ts");
const runId = randomUUID().slice(0, 8), prefix = `v060-micro-${runId}-`, scope = randomUUID();
const owned: { id: number; email: string }[] = [], checks: { name: string; passed: true }[] = [];
let activeCheck = "fixture setup";
const report: any = { schemaVersion: 1, status: "FAIL", passed: false, startedAt: new Date().toISOString(),
  apiOrigin: origin, database: databaseUrl.pathname.slice(1), synthetic: true, fixturePrefix: prefix,
  runtimeKind: compiledTarget ? "compiled-target-requires-artifact-association" : "source-tsx-targeted-only",
  checks, cleanup: false, credentialsExported: false, sourceHashes: {},
  scope: "Controlled legacy-qualified fixtures test selected-resume company practice; no exam answers, auto grading, official grade validity or human pilot claim." };
async function check(name: string, action: () => Promise<void>) { activeCheck = name; await action(); checks.push({ name, passed: true }); }
class Client {
  constructor(readonly token: string) { }
  async call(path: string, method = "GET", body?: unknown, allowed = [200]) {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Origin: origin, Cookie: `fsp_signal_session=${this.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const data = response.status === 204 ? null : await response.json();
    assert.ok(allowed.includes(response.status), `${method} ${path}: unexpected ${response.status}`);
    return { status: response.status, data };
  }
}
async function fixture(role: "candidate" | "employer", pair = scope) {
  const email = `${prefix}${owned.length}@example.test`;
  const [user] = await db.insert(users).values({ email, role, demoMode: true, reviewScopeId: pair, emailVerified: true,
    passwordHash: "controlled-session-only-no-password", displayName: `Synthetic ${owned.length}` }).returning();
  owned.push({ id: user.id, email });
  let companyId = 0;
  if (role === "candidate") await db.insert(profiles).values({ userId: user.id, professionalAlias: `${prefix}candidate-${user.id}`,
    visibility: "private", consentMatching: false });
  else { const [company] = await db.insert(companies).values({ ownerUserId: user.id, name: `${prefix}company`, contactEmail: email }).returning(); companyId = company.id; }
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ userId: user.id, demoMode: true, reviewScopeId: pair,
    tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) });
  return { user, companyId, client: new Client(token) };
}
async function resume(userId: number, specialization = "Backend / Python", qualified = true, primary = false) {
  const [row] = await db.insert(resumes).values({ userId, title: `${prefix}resume`, specialization, isPrimary: primary,
    verifiedGrade: qualified ? "Middle" : null, verifiedSkills: qualified ? ["Python", "SQL"] : [],
    visibility: qualified ? "pseudonymous" : "private", consentMatching: qualified,
    legacyQualification: qualified ? { specialization, grade: "Middle", score: 83, skills: ["Python", "SQL"], assessedAt: "2026-10-01T12:00:00Z",
      gradeChangedAt: null, attemptId: null, limitation: "Synthetic historical fixture, not newly measured qualification" } : null }).returning();
  return row;
}
const body = { title: "Учебное рассуждение о SQL", specialization: "Backend / Python", competency: "SQL",
  scenario: "Объясните обработку учебной транзакции и отказа. Производственная работа не требуется, ответ проверяет автор задания.",
  expectedMinutes: 10, intervalDays: 7, deadlineDays: 3, educationalOnly: true,
  rubric: [{ id: "approach", label: "Последовательное объяснение", maxPoints: 3 }] };
try {
  const candidate = await fixture("candidate"), employer = await fixture("employer"), samePairOther = await fixture("candidate"), foreign = await fixture("candidate", randomUUID()), foreignEmployer = await fixture("employer", foreign.user.reviewScopeId!);
  const primary = await resume(candidate.user.id, "Backend / Python", false, true), secondary = await resume(candidate.user.id), front = await resume(candidate.user.id, "Frontend / TypeScript"), alternative = await resume(candidate.user.id), fifth = await resume(candidate.user.id, "Backend / Python", false);
  const otherResume = await resume(samePairOther.user.id), foreignResume = await resume(foreign.user.id);
  for (const c of [candidate, samePairOther, foreign]) await c.client.call("/me/microtasks/preferences", "PUT", { enabled: true });
  let templateId = 0, subscriptionId = 0, offerId = 0, original: any;
  await check("template category is required, closed and owned", async () => {
    const { specialization, ...missing } = body;
    await employer.client.call("/employer/microtasks", "POST", missing, [400]);
    await employer.client.call("/employer/microtasks", "POST", { ...body, specialization: "Own category" }, [400]);
    templateId = (await employer.client.call("/employer/microtasks", "POST", body, [201])).data.id;
    await foreignEmployer.client.call(`/employer/microtasks/${templateId}`, "PUT", body, [404]);
  });
  await check("qualified secondary is selectable with private unqualified primary; scope and category filter are exact", async () => {
    const rows = (await employer.client.call(`/employer/microtasks/eligible/candidates?templateId=${templateId}`)).data;
    assert.ok(rows.some((r: any) => r.id === candidate.user.id && r.resumeId === secondary.id));
    for (const id of [primary.id, front.id, fifth.id, foreignResume.id]) assert.equal(rows.some((r: any) => r.resumeId === id), false);
    assert.equal(rows.some((r: any) => r.resumeId === otherResume.id), true);
    await foreignEmployer.client.call(`/employer/microtasks/eligible/candidates?templateId=${templateId}`, "GET", undefined, [404]);
  });
  await check("missing, foreign-owner, wrong-specialization and private resume IDs cannot subscribe", async () => {
    await employer.client.call(`/employer/microtasks/${templateId}/subscriptions`, "POST", { candidateId: candidate.user.id }, [400]);
    for (const id of [primary.id, otherResume.id, foreignResume.id, front.id])
      await employer.client.call(`/employer/microtasks/${templateId}/subscriptions`, "POST", { candidateId: candidate.user.id, resumeId: id }, [404]);
  });
  await check("parallel duplicate subscriptions produce one person subscription and one captured offer", async () => {
    const results = await Promise.all([1, 2].map(() => employer.client.call(`/employer/microtasks/${templateId}/subscriptions`, "POST", { candidateId: candidate.user.id, resumeId: secondary.id })));
    assert.equal(results[0].data.id, results[1].data.id); subscriptionId = results[0].data.id;
    const rows = await db.select().from(offers).where(eq(offers.candidateUserId, candidate.user.id)); assert.equal(rows.length, 1);
    original = rows[0]; offerId = original.id; assert.equal(original.resumeId, secondary.id); assert.equal(original.resumeRevision, secondary.revision);
    assert.equal(original.resumeContext.specialization, "Backend / Python"); assert.equal(original.resumeProvenance, "captured");
    await employer.client.call(`/employer/microtasks/${templateId}/subscriptions`, "POST", { candidateId: candidate.user.id, resumeId: alternative.id }, [409]);
  });
  await check("primary switch and later harmless edit preserve original target and revision", async () => {
    await candidate.client.call(`/me/resumes/${front.id}/primary`, "POST", {});
    await candidate.client.call(`/me/resumes/${secondary.id}`, "PATCH", { title: "Новое безопасное название" });
    const [row] = await db.select().from(offers).where(eq(offers.id, offerId));
    assert.equal(row.resumeId, secondary.id); assert.equal(row.resumeRevision, secondary.revision); assert.deepEqual(row.resumeContext, original.resumeContext);
    assert.equal((await candidate.client.call("/me/microtasks")).data.offers.find((r: any) => r.id === offerId).resumeAvailable, true);
  });
  await check("company evaluates open answer without changing Signal qualification; shared evidence uses exact resume", async () => {
    const before = (await candidate.client.call(`/me/resumes/${secondary.id}`)).data.qualification;
    await candidate.client.call(`/me/microtasks/${offerId}/decision`, "POST", { decision: "accept", consentCompanyReview: true });
    await candidate.client.call(`/me/microtasks/${offerId}/submit`, "POST", { answer: "Учебный ответ: объясняю транзакцию, обработку сбоя и повтор запроса." });
    const scores = { scores: [{ criterionId: "approach", points: 3, comment: "Учебное объяснение принято." }], feedback: "Понятный учебный подход; это оценка компании, а не экзамен Signal." };
    const evaluated = (await employer.client.call(`/employer/microtasks/offers/${offerId}/evaluate`, "POST", scores)).data;
    assert.equal(evaluated.result.purpose, "company_task"); assert.equal(evaluated.result.qualificationEffect, "none");
    assert.deepEqual((await candidate.client.call(`/me/resumes/${secondary.id}`)).data.qualification, before);
    await candidate.client.call(`/me/microtasks/${offerId}/visibility`, "POST", { shareResult: true });
    assert.equal((await employer.client.call(`/employer/micro-evidence/${candidate.user.id}?resumeId=${secondary.id}`)).data.length, 1);
    assert.equal((await employer.client.call(`/employer/micro-evidence/${candidate.user.id}?resumeId=${alternative.id}`)).data.length, 0);
    await employer.client.call(`/employer/micro-evidence/${candidate.user.id}?resumeId=${otherResume.id}`, "GET", undefined, [404]);
  });
  await check("rebind and five resumes do not bypass person-wide weekly clock", async () => {
    await candidate.client.call(`/me/microtasks/subscriptions/${subscriptionId}`, "POST", { active: false });
    const rebound = (await employer.client.call(`/employer/microtasks/${templateId}/subscriptions`, "POST", { candidateId: candidate.user.id, resumeId: alternative.id })).data;
    assert.equal(rebound.id, subscriptionId); assert.equal(rebound.active, false); assert.ok(new Date(rebound.lastOfferedAt));
    await candidate.client.call(`/me/microtasks/subscriptions/${subscriptionId}`, "POST", { active: true });
    const before = await db.select().from(offers).where(eq(offers.candidateUserId, candidate.user.id));
    await runMicrotaskScheduler(new Date(), [candidate.user.id]);
    assert.equal((await db.select().from(offers).where(eq(offers.candidateUserId, candidate.user.id))).length, before.length);
    assert.equal(before[0].resumeId, secondary.id);
  });
  await check("offer origin cannot be edited directly and incomplete captured context cannot enter DB", async () => {
    await assert.rejects(pool.query("UPDATE signal_micro_offers SET resume_revision=resume_revision+1 WHERE id=$1", [offerId]), (e: any) => e.code === "P0001");
    await assert.rejects(pool.query("INSERT INTO signal_micro_subscriptions(template_id,candidate_user_id,next_due_at,resume_provenance) VALUES($1,$2,now(),'captured')", [templateId, samePairOther.user.id]), (e: any) => e.code === "23514");
  });
  for (const change of ["hide", "consent", "delete", "specialization"] as const) {
    await check(`selected resume ${change} revokes company access and preserves owner history`, async () => {
      const own = await fixture("candidate"); const target = await resume(own.user.id, "Backend / Python", true, true);
      await own.client.call("/me/microtasks/preferences", "PUT", { enabled: true });
      await employer.client.call(`/employer/microtasks/${templateId}/subscriptions`, "POST", { candidateId: own.user.id, resumeId: target.id });
      const [created] = await db.select().from(offers).where(eq(offers.candidateUserId, own.user.id));
      await own.client.call(`/me/microtasks/${created.id}/decision`, "POST", { decision: "accept", consentCompanyReview: true });
      if (change === "delete") await own.client.call(`/me/resumes/${target.id}`, "DELETE", undefined, [204]);
      else if (change === "specialization") {
        const profile = (await own.client.call(`/me/candidate-profile?resumeId=${target.id}`)).data;
        const keys = ["displayName", "professionalAlias", "assumedGrade", "stack", "skills", "yearsExperience", "workFormat", "salaryMin", "salaryMax", "salaryPeriod", "salaryType", "visibility", "consentMatching", "phone", "contactEmail"];
        await own.client.call(`/me/candidate-profile?resumeId=${target.id}`, "PUT", { ...Object.fromEntries(keys.map(key => [key, profile[key]])), specialization: "Frontend / TypeScript" });
      } else await own.client.call(`/me/resumes/${target.id}`, "PATCH", change === "hide" ? { visibility: "private" } : { consentMatching: false });
      await own.client.call(`/me/microtasks/${created.id}/submit`, "POST", { answer: "Новый ответ после отзыва не должен отправляться." }, [409]);
      const history = (await own.client.call("/me/microtasks")).data.offers.find((r: any) => r.id === created.id);
      assert.equal(history.resumeAvailable, false); assert.equal(history.resumeContext.resumeId, target.id); assert.equal(history.status, "withdrawn");
      const employerHistory = (await employer.client.call("/employer/microtasks/offers")).data.find((r: any) => r.id === created.id);
      assert.equal(employerHistory.resumeContext, null); assert.equal(employerHistory.answer, null);
      const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, created.subscriptionId)); assert.equal(sub.active, false);
    });
  }
  for (const operation of ["subscribe", "submit"] as const) {
    await check(`concurrent privacy transition serializes before ${operation}; no stale rights cross commit`, async () => {
      const own = await fixture("candidate"); const target = await resume(own.user.id, "Backend / Python", true, true);
      await own.client.call("/me/microtasks/preferences", "PUT", { enabled: true });
      let existingOffer: any;
      if (operation === "submit") {
        await employer.client.call(`/employer/microtasks/${templateId}/subscriptions`, "POST", { candidateId: own.user.id, resumeId: target.id });
        [existingOffer] = await db.select().from(offers).where(eq(offers.candidateUserId, own.user.id));
        await own.client.call(`/me/microtasks/${existingOffer.id}/decision`, "POST", { decision: "accept", consentCompanyReview: true });
      }
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => enter = resolve), released = new Promise<void>(resolve => release = resolve);
      const privacy = db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${own.user.id})`);
        await tx.update(resumes).set({ visibility: "private", consentMatching: false }).where(eq(resumes.id, target.id));
        await revokeMicrotasksForResume(tx, own.user.id, target.id);
        enter(); await released;
      });
      await entered;
      let settled = false;
      const action = (operation === "subscribe"
        ? employer.client.call(`/employer/microtasks/${templateId}/subscriptions`, "POST", { candidateId: own.user.id, resumeId: target.id }, [404])
        : own.client.call(`/me/microtasks/${existingOffer.id}/submit`, "POST", { answer: "Этот ответ не должен пройти после отзыва доступа." }, [409]))
        .finally(() => settled = true);
      try {
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(settled, false, "HTTP action crossed an uncommitted selected-resume privacy transition");
      } finally { release(); }
      await privacy; await action;
      const rows = await db.select().from(offers).where(eq(offers.candidateUserId, own.user.id));
      assert.equal(rows.length, operation === "submit" ? 1 : 0);
      if (existingOffer) { assert.equal(rows[0].status, "withdrawn"); assert.equal(rows[0].answer, null); }
    });
  }
  await check("company block applies to all resumes of the person", async () => {
    await candidate.client.call(`/me/companies/${employer.companyId}/block`, "PUT", { blocked: true });
    await employer.client.call(`/employer/microtasks/${templateId}/subscriptions`, "POST", { candidateId: candidate.user.id, resumeId: alternative.id }, [403]);
  });
  await check("legacy remains unbound, owned answers readable, and no new offer/answer gains invented origin", async () => {
    const legacy = await fixture("candidate"); const target = await resume(legacy.user.id, "Backend / Python", true, true);
    await legacy.client.call("/me/microtasks/preferences", "PUT", { enabled: true });
    const [sub] = await db.insert(subscriptions).values({ templateId, candidateUserId: legacy.user.id, nextDueAt: new Date() }).returning();
    const [old] = await db.insert(offers).values({ subscriptionId: sub.id, candidateUserId: legacy.user.id, companyId: employer.companyId,
      snapshot: { ...body, companyName: "Synthetic legacy company", version: 1, limits: "Company evaluation only" },
      scheduledFor: new Date(), dueAt: new Date(Date.now() + 86400000), status: "accepted", acceptedAt: new Date(), answer: "Исторический сохранённый ответ." }).returning();
    await legacy.client.call(`/me/microtasks/${old.id}/submit`, "POST", { answer: "Новый ответ без известного исходного резюме." }, [409]);
    assert.equal((await legacy.client.call("/me/microtasks")).data.offers.find((r: any) => r.id === old.id).answer, old.answer);
    assert.equal((await db.select().from(offers).where(eq(offers.id, old.id)))[0].resumeId, null);
    await runMicrotaskScheduler(new Date(), [legacy.user.id]); assert.equal((await db.select().from(offers).where(eq(offers.candidateUserId, legacy.user.id))).length, 1);
    assert.ok(target.id); // Current primary exists but must never be backfilled.
  });
  report.status = "PASS"; report.passed = true;
} catch (error) {
  report.failedCheck = activeCheck; report.errorKind = error instanceof Error ? error.name : "Unknown";
  const privateDir = join(homedir(), ".codex", "private"); await mkdir(privateDir, { recursive: true });
  await writeFile(join(privateDir, `v060-micro-${runId}-failure.log`), error instanceof Error ? error.stack ?? error.name : "Unknown error");
  process.exitCode = 1;
} finally {
  try {
    for (const own of owned) {
      const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, own.id));
      assert.equal(row?.email, own.email, "Owned identity changed; cleanup must fail closed");
      assert.ok(own.email.startsWith(prefix));
    }
    if (owned.length) await db.delete(users).where(inArray(users.id, owned.map(r => r.id)));
    assert.equal((await db.select({ id: users.id }).from(users).where(inArray(users.id, owned.map(r => r.id)))).length, 0);
    report.cleanup = true; report.createdUsers = owned.length; report.remainingOwnedUsers = 0;
  } catch (error) { report.cleanup = false; report.cleanupErrorKind = error instanceof Error ? error.name : "Unknown"; report.status = "FAIL"; report.passed = false; process.exitCode = 1; }
  for (const file of ["artifacts/api-server/src/routes/signal-microtasks.ts", "artifacts/api-server/src/lib/microtask-scheduler.ts", "artifacts/api-server/src/lib/microtask-resume.ts", "artifacts/api-server/src/lib/microtask-resume-policy.ts", "lib/db/migrations/0009_microtask_resume.sql", "artifacts/api-server/src/routes/signal-resume.ts"]) report.sourceHashes[file] = createHash("sha256").update(await readFile(file)).digest("hex");
  report.completedAt = new Date().toISOString();
  const path = `outputs/verification/release-0.6.0/microtask-resume-http-${runId}.json`;
  await mkdir("outputs/verification/release-0.6.0", { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2));
  await pool.end(); console.log(JSON.stringify({ passed: report.passed, checks: checks.length, cleanup: report.cleanup, report: path, failedCheck: report.failedCheck }));
}
