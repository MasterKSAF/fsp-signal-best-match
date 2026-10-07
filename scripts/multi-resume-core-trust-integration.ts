import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { eq, and, sql } from "drizzle-orm";
const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "55435" || databaseUrl.pathname !== "/signal_resume_stage") throw new Error("This integration test is restricted to the isolated signal_resume_stage database on 127.0.0.1:55435.");
const origin = process.env.API_ORIGIN ?? "http://127.0.0.1:4313";
if (origin !== "http://127.0.0.1:4313") throw new Error("Isolated API origin must be http://127.0.0.1:4313.");
const { db, pool, signalUsersTable: users, signalSessionsTable: sessions, signalCandidateProfilesTable: profiles, signalCandidateResumesTable: resumes, signalCompaniesTable: companies, signalNeedsTable: needs, signalInvitationsTable: invitations, signalContactGrantsTable: grants, signalJobsTable: jobs, signalAssessmentAttemptsTable: attempts, signalAssessmentCorrectionsTable: corrections, signalModeratorPermissionsTable: permissions, signalComplaintsTable: complaints, signalTrustAuditTable: audit } = await import("../lib/db/src/index.ts");
const { hashPassword } = await import("../artifacts/api-server/src/lib/signal-auth.ts");
const { assembleManagedAttempt } = await import("../artifacts/api-server/src/lib/assessment-managed.ts");
const prefix = `coretrust-${randomUUID().slice(0, 8)}`; const password = randomBytes(24).toString('base64url');
const checks: { name: string; status: string }[] = [];
const fixtures: Record<string, unknown> = {};
const actorIds: number[] = [];
async function step(name: string, run: () => Promise<void>) { await run(); checks.push({ name, status: "PASS" }); }
async function account(name: string, role: "candidate" | "employer") {
  const email = `${prefix}-${name}@example.test`;
  const [user] = await db.insert(users).values({ email, passwordHash: await hashPassword(password), role, displayName: `Isolated QA ${name}`, emailVerified: true, demoMode: false }).returning();
  actorIds.push(user!.id);
  if (role === "candidate") await db.insert(profiles).values({ userId: user!.id, professionalAlias: `QA ${name}`, contactEmail: email, phone: "+70000000000", visibility: "private", consentMatching: false });
  fixtures[name] = { id: user!.id, email }; return user!;
}
async function login(email: string) {
  const response = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, "fixture login");
  const cookie = response.headers.getSetCookie()[0]?.split(";")[0]; assert.ok(cookie); return cookie;
}
async function request(cookie: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const data = response.headers.get("Content-Type")?.includes("json") ? await response.json() : null;
  if (data && /^\/me\/resume(?:s)?(?:\/|\?|$)/.test(path)) {
    assert.doesNotMatch(JSON.stringify(data), /"(?:poolContentDigest|pool_content_digest)"/, "Server-only database signatures must never enter resume DTOs");
  }
  return { status: response.status, data, response };
}
let outcome = "PASS"; let failure: string | null = null;
try {
  const a = await account("candidate-a", "candidate"), b = await account("candidate-b", "candidate"), employer = await account("employer", "employer"), mod1 = await account("moderator-a", "candidate"), mod2 = await account("moderator-b", "candidate");
  await db.insert(permissions).values([{ userId: mod1.id, grantedBy: "isolated-test-fixture" }, { userId: mod2.id, grantedBy: "isolated-test-fixture" }]);
  const [company] = await db.insert(companies).values({ ownerUserId: employer.id, name: `Isolated ${prefix}`, contactEmail: employer.email }).returning();
  fixtures.companyId = company!.id;
  const cookies = { a: await login(a.email), b: await login(b.email), employer: await login(employer.email), mod1: await login(mod1.email), mod2: await login(mod2.email) };
  const first = await request(cookies.a, "/me/resumes"); assert.equal(first.status, 200); assert.equal(first.data.count, 1); const firstId = first.data.resumes[0].id as number;
  await step("new candidate gets one owned primary resume, no confirmed Junior by default", async () => { assert.equal(first.data.resumes[0].verifiedGrade, null); assert.equal(first.data.resumes[0].isPrimary, true); assert.equal(first.data.resumes[0].consentCatalog, false); });
  await step("real signed resume DTO omits internal digest in list/read/create/copy/content PUT/metadata PATCH", async () => {
    const [stored] = await db.select({ digest: resumes.poolContentDigest }).from(resumes).where(eq(resumes.id, firstId));
    assert.ok(Buffer.isBuffer(stored?.digest)); assert.equal(stored.digest.length, 32);
    assert.equal((await request(cookies.a, `/me/resumes/${firstId}`)).status, 200);
    const created = await request(cookies.a, "/me/resumes", "POST", { title: "Private DTO control", specialization: "Backend / Python" });
    assert.equal(created.status, 201);
    const copied = await request(cookies.a, `/me/resumes/${created.data.id}/copy`, "POST", {}); assert.equal(copied.status, 201);
    const content = { summary: "Synthetic DTO control", softSkills: [], experience: [], projects: [], education: [], portfolio: [], questionnaire: created.data.questionnaire, revision: created.data.revision };
    const saved = await request(cookies.a, `/me/resumes/${created.data.id}`, "PUT", content); assert.equal(saved.status, 200);
    assert.equal((await request(cookies.a, `/me/resumes/${created.data.id}`, "PATCH", { title: "DTO edited", revision: saved.data.revision })).status, 200);
    for (const id of [copied.data.id, created.data.id]) assert.equal((await request(cookies.a, `/me/resumes/${id}`, "DELETE")).status, 204);
    assert.equal((await request(cookies.a, "/me/resumes")).data.count, 1);
  });
  await request(cookies.b, "/me/resumes");
  await step("resume, copy and trust IDs reject PostgreSQL integer overflow before database lookup", async () => {
    for (const raw of ["2147483648", "9007199254740991", "1e3", "0", "-1"]) {
      assert.equal((await request(cookies.a, `/me/resumes/${raw}`)).status, 400);
      assert.equal((await request(cookies.a, `/me/resume?resumeId=${encodeURIComponent(raw)}`)).status, 400);
      assert.equal((await request(cookies.a, `/me/companies/${raw}/block`, "PUT", { blocked: true })).status, 400);
    }
    assert.equal((await request(cookies.a, "/me/resumes", "POST", { title: "Overflow", specialization: "Backend / Python", copyFromId: 2147483648 })).status, 400);
    assert.equal((await request(cookies.a, "/me/complaints", "POST", { objectType: "company", objectId: 2147483648, category: "other", idempotencyKey: `${prefix}_overflow` })).status, 400);
  });
  await step("foreign resume is protected in read, metadata, content, PDF, primary and deletion APIs", async () => {
    for (const [path, method, body] of [[`/me/resumes/${firstId}`, "GET", undefined], [`/me/resumes/${firstId}`, "PATCH", { title: "attack" }], [`/me/resumes/${firstId}/pdf`, "GET", undefined], [`/me/resumes/${firstId}/primary`, "POST", {}], [`/me/resumes/${firstId}/copy`, "POST", {}], [`/me/resumes/${firstId}`, "DELETE", undefined]] as const) assert.equal((await request(cookies.b, path, method, body)).status, 404);
    const content = { summary: "", softSkills: [], experience: [], projects: [], education: [], portfolio: [], questionnaire: first.data.resumes[0].questionnaire };
    assert.equal((await request(cookies.b, `/me/resumes/${firstId}`, "PUT", content)).status, 404);
  });
  await step("two concurrent creations at four active resumes produce exactly one fifth and reject sixth", async () => {
    for (let i = 0; i < 3; i++) assert.equal((await request(cookies.a, "/me/resumes", "POST", { title: `Backend ${i}`, specialization: "Backend / Python" })).status, 201);
    const pair = await Promise.all([0, 1].map(i => request(cookies.a, "/me/resumes", "POST", { title: `Concurrent ${i}`, specialization: "Backend / Python" })));
    assert.deepEqual(pair.map(item => item.status).sort(), [201, 409]); assert.equal((await request(cookies.a, "/me/resumes")).data.count, 5);
  });
  await step("hiding does not free capacity; deletion frees exactly one place", async () => {
    assert.equal((await request(cookies.a, `/me/resumes/${firstId}`, "PATCH", { visibility: "private" })).status, 200);
    assert.equal((await request(cookies.a, "/me/resumes", "POST", { title: "sixth", specialization: "Backend / Python" })).status, 409);
    assert.equal((await request(cookies.a, `/me/resumes/${firstId}/copy`, "POST", {})).status, 409);
    const list = (await request(cookies.a, "/me/resumes")).data.resumes; const removed = list.find((r: { id: number }) => r.id !== firstId).id;
    assert.equal((await request(cookies.a, `/me/resumes/${removed}`, "DELETE")).status, 204);
    const copy = await request(cookies.a, `/me/resumes/${firstId}/copy`, "POST", {}); assert.equal(copy.status, 201); assert.ok(copy.data.title.endsWith("— копия")); assert.equal(copy.data.visibility, "private"); assert.equal(copy.data.consentCatalog, false); assert.equal(copy.data.consentMatching, false);
  });
  const backendForm = assembleManagedAttempt("backend-python", "Middle", `${prefix}-backend`);
  const [backendProof] = await db.insert(attempts).values({ userId: a.id, resumeId: firstId, resumeRevision: 1, resumeSpecialization: "Backend / Python", programId: "backend-python", programVersion: "signal-backend-python-v6", grade: "Middle", status: "submitted", ...backendForm, answers: backendForm.cases.map(c => ({ caseId: c.id, answer: backendForm.oracles[c.id]!.answer })), score: 100, verified: true, gradeChanged: true, dueAt: new Date("2026-10-01T10:35:00Z"), submittedAt: new Date("2026-10-01T10:20:00Z") }).returning();
  await step("one saved real program powers all compatible resumes with original proof date and no extra attempts", async () => {
    const list = (await request(cookies.a, "/me/resumes")).data.resumes;
    assert.ok(list.every((r: any) => r.verifiedGrade === "Middle" && r.verifiedScore === 100 && r.qualification.evidence.every((e: any) => e.attemptId === backendProof!.id && e.date === "2026-10-01T10:20:00.000Z")));
    assert.equal((await db.select().from(attempts).where(eq(attempts.userId, a.id))).length, 1);
  });
  let frontendId = 0;
  await step("Backend Middle does not transfer to Frontend; Frontend Junior is independently earned", async () => {
    const list = (await request(cookies.a, "/me/resumes")).data.resumes; await request(cookies.a, `/me/resumes/${list.find((r: any) => r.id !== firstId).id}`, "DELETE");
    const front = await request(cookies.a, "/me/resumes", "POST", { title: "Frontend", specialization: "Frontend / TypeScript", copyFromId: firstId }); assert.equal(front.status, 201); frontendId = front.data.id; assert.equal(front.data.verifiedGrade, null);
    const form = assembleManagedAttempt("frontend-typescript", "Junior", `${prefix}-frontend`);
    await db.insert(attempts).values({ userId: a.id, resumeId: frontendId, resumeRevision: 1, resumeSpecialization: "Frontend / TypeScript", programId: "frontend-typescript", programVersion: "signal-frontend-typescript-v2", grade: "Junior", status: "submitted", ...form, answers: form.cases.map(c => ({ caseId: c.id, answer: form.oracles[c.id]!.answer })), score: 100, verified: true, dueAt: new Date("2026-10-02T10:35:00Z"), submittedAt: new Date("2026-10-02T10:20:00Z") });
    const updated = (await request(cookies.a, "/me/resumes")).data.resumes;
    assert.equal(updated.find((r: any) => r.id === firstId).verifiedGrade, "Middle"); assert.equal(updated.find((r: any) => r.id === frontendId).verifiedGrade, "Junior");
  });
  await step("PDF remains explicitly targeted after changing primary, and stale revision fails metadata save", async () => {
    const before = (await request(cookies.a, `/me/resumes/${firstId}`)).data;
    await request(cookies.a, `/me/resumes/${frontendId}/primary`, "POST", {});
    const pdf = await request(cookies.a, `/me/resumes/${firstId}/pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.response.headers.get("X-Signal-Resume-Id"), String(firstId));
    assert.equal((await request(cookies.a, `/me/resumes/${firstId}`, "PATCH", { title: "Revision update", revision: before.revision })).status, 200);
    assert.equal((await request(cookies.a, `/me/resumes/${firstId}`, "PATCH", { title: "Stale tab", revision: before.revision })).status, 409);
  });
  await step("revoked shared proof removes Backend grade and badge evidence without erasing Frontend or history", async () => {
    await db.insert(corrections).values({ attemptId: backendProof!.id, reason: "Controlled fixture revocation", operator: "isolated-acceptance", originalDecision: { score: 100, verified: true, status: "submitted" } });
    const list = (await request(cookies.a, "/me/resumes")).data.resumes;
    assert.ok(list.filter((r: any) => r.specialization === "Backend / Python").every((r: any) => r.verifiedGrade === null && r.qualification.evidence.length === 0)); assert.equal(list.find((r: any) => r.id === frontendId).verifiedGrade, "Junior");
    assert.equal((await db.select().from(attempts).where(eq(attempts.userId, a.id))).length, 2);
  });
  await step("avatar upload validates type and clear removes stored photo", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZsAAAAASUVORK5CYII=";
    assert.equal((await request(cookies.a, "/me/avatar", "POST", { dataUrl })).status, 200);
    assert.equal((await request(cookies.a, "/me/avatar", "POST", { dataUrl: dataUrl.replace("image/png", "image/jpeg") })).status, 400);
    assert.equal((await request(cookies.a, "/me/avatar", "DELETE")).data.avatarDataUrl, null);
  });
  const [need] = await db.insert(needs).values({ companyId: company!.id, title: "Trust fixture role", specialization: "Frontend / TypeScript", grade: "Junior", requiredSkills: ["TypeScript"], description: "Controlled acceptance fixture", workFormat: "Удалённо", salaryMin: 100000, salaryMax: 150000 }).returning();
  const [invitation] = await db.insert(invitations).values({ companyId: company!.id, needId: need!.id, candidateUserId: a.id, resumeId: frontendId, title: "Trust fixture invitation", message: "Fixture", reason: "Fixture", salaryMin: 100000, salaryMax: 150000, salaryPeriod: "month", salaryType: "gross", workFormat: "Удалённо", status: "accepted" }).returning();
  const [grant] = await db.insert(grants).values({ invitationId: invitation!.id, companyId: company!.id, candidateUserId: a.id }).returning();
  await request(cookies.a, `/me/resumes/${frontendId}`, "PATCH", { visibility: "public", consentMatching: true, consentCatalog: true });
  const privateText = `Private reporter text ${prefix} +70000000000 reporter@example.test`;
  const complaintBody = { objectType: "invitation", objectId: invitation!.id, category: "spam", explanation: privateText, idempotencyKey: `${prefix}_complaint1` };
  let complaintId = 0;
  await step("complaint is saved once; replay/different-key duplicate do not create cases or quota, changed key payload fails", async () => {
    const saved = await request(cookies.a, "/me/complaints", "POST", complaintBody); assert.equal(saved.status, 201); complaintId = saved.data.complaint.id;
    assert.equal((await request(cookies.a, "/me/complaints", "POST", complaintBody)).status, 200);
    const duplicate = await request(cookies.a, "/me/complaints", "POST", { ...complaintBody, idempotencyKey: `${prefix}_complaint2` }); assert.equal(duplicate.status, 200); assert.equal(duplicate.data.complaint.id, complaintId);
    assert.equal((await request(cookies.a, "/me/complaints", "POST", { ...complaintBody, explanation: "different" })).status, 409);
    assert.equal((await db.select().from(complaints).where(eq(complaints.reporterUserId, a.id))).length, 1);
  });
  await step("complaint object ACL, role checks and moderator permission protect foreign cases and queue", async () => {
    assert.equal((await request(cookies.b, "/me/complaints", "POST", { ...complaintBody, idempotencyKey: `${prefix}_foreign` })).status, 404);
    assert.deepEqual((await request(cookies.b, "/me/complaints")).data.complaints, []);
    assert.equal((await request(cookies.employer, "/me/complaints", "POST", complaintBody)).status, 403);
    assert.equal((await request(cookies.a, "/moderation/queue")).status, 403); assert.equal((await request(cookies.a, "/me/trust-status")).data.moderator, false);
    assert.equal((await request(cookies.a, "/me/candidate-profile", "PUT", { moderator: true })).status, 400); assert.equal((await request(cookies.a, "/me/trust-status")).data.moderator, false);
  });
  await step("personal block revokes accepted invitation contact grant; unblock never restores consent", async () => {
    assert.equal((await request(cookies.employer, `/employer/invitations/${invitation!.id}/contacts`)).status, 200, "actual pre-block contact route is usable");
    assert.equal((await request(cookies.a, `/me/companies/${company!.id}/block`, "PUT", { blocked: true })).status, 200);
    assert.ok((await db.select().from(grants).where(eq(grants.id, grant!.id)))[0]!.revokedAt);
    assert.equal((await request(cookies.employer, `/employer/invitations/${invitation!.id}/contacts`)).status, 403);
    assert.equal((await request(cookies.a, `/me/companies/${company!.id}/block`, "PUT", { blocked: false })).status, 200);
    const response = await request(cookies.employer, `/employer/invitations/${invitation!.id}/contacts`); assert.notEqual(response.status, 200);
    assert.ok((await db.select().from(grants).where(eq(grants.id, grant!.id)))[0]!.revokedAt);
  });
  let restrictionId = 0;
  const decision = { action: "restrict", reason: "Controlled evidence reviewed by moderator", scope: "all", durationHours: 24, publicReasonCode: "spam" };
  await step("moderator review then restriction updates author status, is idempotent, and keeps reporter private from employer", async () => {
    assert.equal((await request(cookies.mod1, `/moderation/complaints/${complaintId}/decision`, "POST", { action: "review", reason: "Review controlled case" })).status, 200);
    assert.equal((await request(cookies.mod1, `/moderation/complaints/${complaintId}/decision`, "POST", decision)).status, 200);
    const before = (await db.select().from(audit).where(eq(audit.companyId, company!.id))).length;
    assert.equal((await request(cookies.mod1, `/moderation/complaints/${complaintId}/decision`, "POST", decision)).status, 200);
    assert.equal((await db.select().from(audit).where(eq(audit.companyId, company!.id))).length, before);
    assert.equal((await request(cookies.mod1, `/moderation/complaints/${complaintId}/decision`, "POST", { ...decision, scope: "contacts" })).status, 409);
    assert.equal((await request(cookies.mod1, `/moderation/complaints/${complaintId}/decision`, "POST", { ...decision, durationHours: 48 })).status, 409);
    assert.equal((await request(cookies.mod1, `/moderation/complaints/${complaintId}/decision`, "POST", { ...decision, publicReasonCode: "privacy" })).status, 409);
    assert.equal((await request(cookies.a, "/me/complaints")).data.complaints.find((c: any) => c.id === complaintId).status, "upheld");
    const restrictions = await request(cookies.employer, "/employer/restrictions"); assert.equal(restrictions.status, 200); restrictionId = restrictions.data.restrictions[0].id;
    const serialized = JSON.stringify(restrictions.data); assert.ok(!serialized.includes(privateText)); assert.ok(!serialized.includes("reporterUserId")); assert.ok(!serialized.includes("complaintId"));
  });
  await step("operator-authorized employer moderator cannot read own company raw reports or audit and cannot self-decide", async () => {
    await db.insert(permissions).values({ userId: employer.id, grantedBy: "isolated-conflict-of-interest-fixture" });
    try {
      const queue = await request(cookies.employer, "/moderation/queue"); assert.equal(queue.status, 200);
      assert.ok(!queue.data.complaints.some((c: any) => c.companyId === company!.id)); assert.ok(!queue.data.appeals.some((appeal: any) => appeal.companyId === company!.id)); assert.ok(!JSON.stringify(queue.data).includes(privateText));
      const events = await request(cookies.employer, "/moderation/audit"); assert.equal(events.status, 200); assert.ok(!events.data.events.some((event: any) => event.companyId === company!.id));
      assert.equal((await request(cookies.employer, `/moderation/complaints/${complaintId}/decision`, "POST", decision)).status, 403);
    } finally { await db.update(permissions).set({ active: false }).where(eq(permissions.userId, employer.id)); }
  });
  await step("employer appeal is private/idempotent and original moderator cannot decide their own restriction appeal", async () => {
    const body = { explanation: "Controlled appeal with professional grounds" };
    const saved = await request(cookies.employer, `/employer/restrictions/${restrictionId}/appeals`, "POST", body); assert.equal(saved.status, 201);
    assert.equal((await request(cookies.employer, `/employer/restrictions/${restrictionId}/appeals`, "POST", body)).status, 200);
    assert.equal((await request(cookies.mod1, `/moderation/appeals/${saved.data.appeal.id}/decision`, "POST", { action: "accept", reason: "Independent reconsideration" })).status, 403);
    assert.equal((await request(cookies.mod2, `/moderation/appeals/${saved.data.appeal.id}/decision`, "POST", { action: "accept", reason: "Independent reconsideration" })).status, 200);
    assert.equal((await request(cookies.employer, "/employer/restrictions")).data.restrictions[0].active, false);
    assert.ok((await db.select().from(grants).where(eq(grants.id, grant!.id)))[0]!.revokedAt);
  });
  await step("dismissal is visible to author; terminal disposition cannot be rewritten into restriction", async () => {
    const saved = await request(cookies.a, "/me/complaints", "POST", { ...complaintBody, category: "other", idempotencyKey: `${prefix}_dismiss` }); assert.equal(saved.status, 201);
    assert.equal((await request(cookies.mod1, `/moderation/complaints/${saved.data.complaint.id}/decision`, "POST", { action: "dismiss", reason: "No grounds in controlled evidence" })).status, 200);
    assert.equal((await request(cookies.mod1, `/moderation/complaints/${saved.data.complaint.id}/decision`, "POST", decision)).status, 409);
    assert.equal((await request(cookies.a, "/me/complaints")).data.complaints.find((c: any) => c.id === saved.data.complaint.id).status, "dismissed");
  });
  await step("parallel complaints at nine cases stop exactly at ten; idempotent replay still succeeds at quota", async () => {
    const jobIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const [job] = await db.insert(jobs).values({ companyId: company!.id, title: `Controlled publication ${i}`, description: "Controlled QA publication", specialization: "Frontend / TypeScript", grade: "Junior", skills: ["TypeScript"], workFormat: "Удалённо", salaryMin: 100000, salaryMax: 150000, salaryPeriod: "month", salaryType: "gross", status: "published" }).returning(); jobIds.push(job!.id);
    }
    for (let i = 0; i < 7; i++) assert.equal((await request(cookies.a, "/me/complaints", "POST", { objectType: "job", objectId: jobIds[i], category: "other", idempotencyKey: `${prefix}_limit_${i}` })).status, 201);
    const pair = await Promise.all([7, 8].map(i => request(cookies.a, "/me/complaints", "POST", { objectType: "job", objectId: jobIds[i], category: "other", idempotencyKey: `${prefix}_limit_${i}` })));
    assert.deepEqual(pair.map(r => r.status).sort(), [201, 429]); assert.equal((await db.select().from(complaints).where(eq(complaints.reporterUserId, a.id))).length, 10);
    assert.equal((await request(cookies.a, "/me/complaints", "POST", complaintBody)).status, 200);
    const rate = pair.find(r => r.status === 429)!; assert.equal(rate.data.code, "COMPLAINT_RATE_LIMIT"); assert.ok(rate.data.retryAt);
    await db.update(complaints).set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(complaints.reporterUserId, a.id));
    assert.equal((await request(cookies.a, "/me/complaints", "POST", { objectType: "job", objectId: jobIds[9], category: "other", idempotencyKey: `${prefix}_after_window` })).status, 201);
  });
  await step("trust audit is append-only at DB layer and unavailable to ordinary participant", async () => {
    assert.equal((await request(cookies.a, "/moderation/audit")).status, 403);
    const [event] = await db.select().from(audit).where(eq(audit.companyId, company!.id)).limit(1); assert.ok(event);
    await assert.rejects(() => db.update(audit).set({ reason: "overwrite" }).where(eq(audit.id, event!.id)), error => (error as { code?: string; cause?: { code?: string } }).code === "23514" || (error as { cause?: { code?: string } }).cause?.code === "23514");
    assert.notEqual((await db.select().from(audit).where(eq(audit.id, event!.id)))[0]!.reason, "overwrite");
  });
} catch (error) { outcome = "FAIL"; failure = error instanceof Error ? error.stack ?? error.message : String(error); }
finally {
  mkdirSync("outputs/verification", { recursive: true });
  const privateDir = "outputs/verification/multi-resume-2026-10-06/private"; mkdirSync(privateDir, { recursive: true });
  const retiredDir = `${privateDir}/retired`; mkdirSync(retiredDir, { recursive: true });
  const privateManifest = `${retiredDir}/${prefix}.json`;
  // Never overwrite the pre-existing ordinary browser fixture manifest.
  writeFileSync(privateManifest, JSON.stringify({ prefix, apiOrigin: origin, actors: fixtures, createdActorIds: actorIds, password, immutableHistoryRetained: true }, null, 2), { flag: "wx" });
  let retirement: Record<string, unknown> = { status: "NOT_RUN", actorsRetained: actorIds.length, immutableHistoryRetained: true };
  try {
    await db.transaction(async tx => {
      if (!actorIds.length) return;
      const owned = await tx.select({ id: users.id, email: users.email, demoMode: users.demoMode, reviewScopeId: users.reviewScopeId }).from(users).where(sql`${users.id} = any(${sql.param(actorIds)}::int[])`);
      assert.equal(owned.length, actorIds.length, "Every retiring actor must still belong to this run");
      assert.ok(owned.every(row => row.email.startsWith(`${prefix}-`) && row.email.endsWith("@example.test") && !row.demoMode && row.reviewScopeId === null), "Exact actor IDs, run namespace and ordinary scope are mandatory");
      await tx.update(permissions).set({ active: false }).where(sql`${permissions.userId} = any(${sql.param(actorIds)}::int[])`);
      await tx.delete(sessions).where(sql`${sessions.userId} = any(${sql.param(actorIds)}::int[])`);
      await tx.update(resumes).set({ visibility: "private", consentMatching: false, consentCatalog: false, readyForOffers: false }).where(sql`${resumes.userId} = any(${sql.param(actorIds)}::int[])`);
      const remainingSessions = await tx.select({ userId: sessions.userId }).from(sessions).where(sql`${sessions.userId} = any(${sql.param(actorIds)}::int[])`);
      const activeModerators = await tx.select({ userId: permissions.userId }).from(permissions).where(and(eq(permissions.active, true), sql`${permissions.userId} = any(${sql.param(actorIds)}::int[])`));
      const visibleOwnedResumes = await tx.select({ id: resumes.id }).from(resumes).where(and(sql`${resumes.userId} = any(${sql.param(actorIds)}::int[])`, sql`(${resumes.visibility} <> 'private' OR ${resumes.consentMatching} OR ${resumes.consentCatalog} OR ${resumes.readyForOffers})`));
      assert.equal(remainingSessions.length, 0); assert.equal(activeModerators.length, 0); assert.equal(visibleOwnedResumes.length, 0);
    });
    retirement = { status: "PASS", actorsRetained: actorIds.length, immutableHistoryRetained: true, sessionsRemoved: true, moderationGrantsInactive: true, ownedResumesClosed: true, guard: "Exact new actor IDs, run-prefix emails and ordinary scope; existing browser fixtures never targeted" };
  } catch {
    retirement = { status: "FAIL", actorsRetained: actorIds.length, immutableHistoryRetained: true, reason: "Scoped retirement failed; private run manifest retained for controlled retry" };
    outcome = "FAIL"; failure = failure ?? "Scoped retirement failed; private details suppressed";
  }
  const report = { status: outcome, generatedAt: new Date().toISOString(), database: "isolated signal_resume_stage:55435", apiOrigin: origin, syntheticFixtures: true, prefix, checks, failure, fixtureRetained: true, fixtureRetentionReason: "Immutable trust audit and its actors remain; this is scoped retirement, not deletion cleanup", retirement, limitations: ["Immutable real assessment programs are inserted as controlled fixtures; assessment endpoint cooldown/start/submit acceptance belongs to the separate root integration.", "For expiration testing only this fixture author's complaint dates are aged by 25 hours; no existing real user records are altered.", "Browser acceptance and migration retry acceptance are separate runs, not implied by this HTTP report."] };
  const reportPath = `outputs/verification/multi-resume-core-trust-http-${prefix}.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeFileSync("outputs/verification/multi-resume-core-trust-http.json", JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ status: outcome, checks: checks.length, prefix, report: reportPath, failure: failure?.split("\n").slice(0, 4).join("\n") ?? null }));
  await pool.end(); if (outcome === "FAIL") process.exitCode = 1;
}
