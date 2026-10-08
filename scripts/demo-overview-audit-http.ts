import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
const origin = process.env.API_ORIGIN ?? "", target = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.SIGNAL_OVERVIEW_AUDIT, "owned-isolated");
assert.equal(origin, "http://127.0.0.1:4367"); assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "55435"); assert.equal(target.pathname, "/signal_independent_fixes_20261007");
const { db, pool, signalUsersTable: users, signalCandidateProfilesTable: profiles, signalCandidateResumesTable: resumes,
  signalAssessmentAttemptsTable: attempts, signalDemoSeedTable: markers, signalMicroPreferencesTable: preferences,
  signalMicroTemplatesTable: templates, signalMicroOffersTable: offers } = await import("../lib/db/src/index.ts");
const { seedOverviewDemo, OVERVIEW_DEMO_MARKER } = await import("./src/seed-overview-demo.ts");
const runId = randomUUID().slice(0, 8), prefix = `audit-demo-preserved-${runId}-`, owned: number[] = [], checks: any[] = [];
const report: any = { status: "FAIL", startedAt: new Date().toISOString(), synthetic: true,
  origin, database: target.pathname.slice(1), runtimeKind: "current-source-http", credentialsExported: false,
  marker: OVERVIEW_DEMO_MARKER, checks, browserAcceptance: "Pending root browser review; HTTP does not count as browser", cleanup: false };
async function check(name: string, action: () => Promise<void>) { await action(); checks.push({ name, passed: true }); }
async function snapshot() {
  const rows = await pool.query(`select jsonb_build_object('users',(select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]') from signal_users u where id=any($1::int[])),
    'profiles',(select coalesce(jsonb_agg(to_jsonb(p) order by user_id),'[]') from signal_candidate_profiles p where user_id=any($1::int[])),
    'resumes',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from signal_candidate_resumes r where user_id=any($1::int[])),
    'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from signal_assessment_attempts a where user_id=any($1::int[])),
    'preferences',(select coalesce(jsonb_agg(to_jsonb(p) order by candidate_user_id),'[]') from signal_micro_preferences p where candidate_user_id=any($1::int[])))::text as content`, [owned]);
  return createHash("sha256").update(rows.rows[0].content).digest("hex");
}
async function seedMain() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/src/seed-fsp-signal.ts"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let diagnostics = ""; child.stdout.on("data", value => { diagnostics += String(value); }); child.stderr.on("data", value => { diagnostics += String(value); });
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Overview seed failed (${code}); inspect local runner. ${diagnostics.slice(-400)}`)));
  });
}
let cookie = "";
async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}/api${path}`, { method, headers: { Origin: origin, Cookie: cookie,
    ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `${path}: status ${response.status}`);
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return response.json();
}
try {
  for (const kind of ["ordinary", "reviewer"] as const) {
    const [user] = await db.insert(users).values({ email: `${prefix}${kind}@example.test`, passwordHash: "unusable-owned-sentinel",
      role: "candidate", displayName: `Owned ${kind} seed preservation sentinel`, emailVerified: true,
      demoMode: kind === "reviewer", reviewScopeId: kind === "reviewer" ? randomUUID() : null }).returning();
    owned.push(user!.id);
    await db.insert(profiles).values({ userId: user!.id, professionalAlias: `${prefix}${kind}`, visibility: "private", consentMatching: false });
    const [resume] = await db.insert(resumes).values({ userId: user!.id, title: "Owned ungraded draft", isPrimary: true, visibility: "private", consentMatching: false }).returning();
    await db.insert(preferences).values({ candidateUserId: user!.id, enabled: false });
    await db.insert(attempts).values({ userId: user!.id, resumeId: resume!.id, resumeRevision: 1, resumeSpecialization: "Backend / Python",
      programId: "backend-python-v1", grade: "Junior", status: "in_progress", purpose: "signal_qualification", purposeOrigin: "candidate_confirmed",
      gradeConfirmedAt: new Date(), cases: [], oracles: {}, answers: [], dueAt: new Date(Date.now() + 3_600_000) });
  }
  const before = await snapshot(); report.protectedBeforeSha256 = before;
  const previous = await db.select().from(markers).where(eq(markers.key, OVERVIEW_DEMO_MARKER));
  report.contentPreviouslyPresent = previous.length > 0;
  await check("main seed creates coherent overview without touching ordinary or reviewer draft, qualification or preferences", async () => {
    await seedMain(); assert.equal(await snapshot(), before);
    assert.equal((await db.select().from(markers).where(eq(markers.key, OVERVIEW_DEMO_MARKER))).length, 1);
  });
  const [counts] = (await pool.query(`select (select count(*)::int from signal_users where email like 'overview-v060-%' and demo_mode and review_scope_id is null) people,
    (select count(*)::int from signal_candidate_resumes r join signal_users u on u.id=r.user_id where u.email like 'overview-v060-%') resumes,
    (select count(*)::int from signal_micro_templates where title='Учебный счётчик библиотеки · Demo') programs,
    (select count(*)::int from signal_micro_offers o join signal_users u on u.id=o.candidate_user_id where u.email like 'overview-v060-%') results`)).rows;
  report.counts = counts; assert.deepEqual(counts, { people: 6, resumes: 8, programs: 1, results: 1 });
  const demoUsers = await db.select({ id: users.id }).from(users).where(and(sql`${users.email} like 'overview-v060-%'`, eq(users.demoMode, true), isNull(users.reviewScopeId)));
  const beforeData = (await pool.query(`select jsonb_build_object('resumes',(select jsonb_agg(to_jsonb(r) order by id) from signal_candidate_resumes r where user_id=any($1::int[])),
    'offers',(select jsonb_agg(to_jsonb(o) order by id) from signal_micro_offers o where candidate_user_id=any($1::int[])))::text as content`, [demoUsers.map(row => row.id)])).rows[0].content;
  const beforeDataSha = createHash("sha256").update(beforeData).digest("hex");
  await check("repeated content preparation creates no duplicates and preserves overview results and ordinary/reviewer data", async () => {
    const result = await seedOverviewDemo(); assert.equal(result.created, false);
    await seedMain(); assert.equal(await snapshot(), before);
    const afterData = (await pool.query(`select jsonb_build_object('resumes',(select jsonb_agg(to_jsonb(r) order by id) from signal_candidate_resumes r where user_id=any($1::int[])),
      'offers',(select jsonb_agg(to_jsonb(o) order by id) from signal_micro_offers o where candidate_user_id=any($1::int[])))::text as content`, [demoUsers.map(row => row.id)])).rows[0].content;
    assert.equal(createHash("sha256").update(afterData).digest("hex"), beforeDataSha);
  });
  await call("/auth/demo-session", "POST", { role: "employer" });
  await check("overview employer HTTP catalog exposes six synthetic people across two directions with actual skill counts and no contacts", async () => {
    const page = await call("/employer/candidates?q=Demo"); report.catalogCount = page.total;
    assert.equal(page.candidates.length, 6);
    for (const row of page.candidates) { assert.equal("contactEmail" in row, false); assert.equal("phone" in row, false); assert.equal("email" in row, false); }
    const multiple = page.candidates.find((row: any) => row.alias === "Demo · Reliable API");
    assert.ok(multiple); assert.equal(multiple.availableResumes.length, 2);
    assert.ok(multiple.availableResumes.some((row: any) => row.specialization === "Frontend / TypeScript" && row.verifiedGrade === null));
    assert.ok(multiple.avatarDataUrl?.startsWith("data:image/png;base64,"));
    assert.ok(page.candidates.some((row: any) => row.verifiedGrade === null));
  });
  await check("overview filters meaningfully separate Frontend, unconfirmed and public synthetic avatar", async () => {
    const frontend = await call(`/employer/candidates?q=Demo&specialization=${encodeURIComponent("Frontend / TypeScript")}`);
    assert.equal(frontend.candidates.length, 4); assert.ok(frontend.candidates.every((row: any) => row.specialization === "Frontend / TypeScript"));
    const noGrade = await call("/employer/candidates?q=Demo&grade=unconfirmed"); assert.equal(noGrade.candidates.length, 2);
    const photo = await call("/employer/candidates?q=Demo&hasPhoto=yes"); assert.equal(photo.candidates.length, 1);
    assert.equal(photo.candidates[0].alias, "Demo · Reliable API");
  });
  await check("overview practice has readable program and evaluated exact secondary resume; company score cannot award Signal grade", async () => {
    const programs = await call("/employer/microtasks"); const program = programs.find((row: any) => row.title === "Учебный счётчик библиотеки · Demo");
    assert.ok(program); assert.equal(program.rubric.length, 3);
    const rows = await call("/employer/microtasks/offers"), example = rows.find((row: any) => row.snapshot.title === program.title);
    assert.ok(example); assert.equal(example.status, "evaluated"); assert.equal(example.result.total, 8); assert.equal(example.result.max, 10);
    assert.equal(example.result.purpose, "company_task"); assert.equal(example.result.qualificationEffect, "none");
    const [resume] = await db.select().from(resumes).where(eq(resumes.id, example.resumeId));
    assert.equal(resume!.isPrimary, false); assert.equal(resume!.verifiedGrade, "Middle");
    assert.equal(example.resumeContext.resumeId, resume!.id); assert.ok(example.result.feedback.includes("Синтетический"));
    assert.ok(example.resumeContext.verifiedSkills.length < 10);
    report.practice = { templateId: program.id, offerId: example.id, resumeId: resume!.id, companyScore: "8/10", signalGrade: "Middle", synthetic: true };
  });
  report.protectedAfterSha256 = await snapshot(); report.status = "PASS";
} catch (error) { report.failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  if (owned.length) {
    await db.delete(users).where(and(inArray(users.id, owned), sql`${users.email} like ${prefix + "%"}`));
    report.cleanup = true;
  }
  report.completedAt = new Date().toISOString();
  report.sourceHashes = Object.fromEntries(await Promise.all(["scripts/src/seed-overview-demo.ts", "scripts/src/seed-fsp-signal.ts", "scripts/fixtures/overview-synthetic-avatar.png"].map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  const output = `outputs/verification/independent-fixes-20261007/demo-overview-${runId}.json`;
  await mkdir("outputs/verification/independent-fixes-20261007", { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ status: report.status, checks: checks.length, output, failure: report.failure ?? null }));
  await pool.end();
}

