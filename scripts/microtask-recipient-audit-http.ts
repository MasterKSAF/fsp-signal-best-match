/** Real HTTP/SQL recipient regression on strictly owned isolated fixtures. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
const origin = process.env.API_ORIGIN ?? "", target = new URL(process.env.DATABASE_URL ?? "");
const baseline = process.argv.includes("--baseline"), keep = process.argv.includes("--keep-for-browser");
assert.equal(process.env.SIGNAL_RECIPIENT_AUDIT, "owned-isolated");
assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55435");
assert.equal(origin, baseline ? "http://127.0.0.1:4365" : "http://127.0.0.1:4367");
assert.equal(target.pathname, baseline ? "/signal_resume_v060_compiled_check" : "/signal_independent_fixes_20261007");
const { db, pool, signalUsersTable: users, signalSessionsTable: sessions, signalCandidateProfilesTable: profiles,
  signalCandidateResumesTable: resumes, signalCompaniesTable: companies, signalMicroPreferencesTable: preferences,
  signalCompanyBlocksTable: blocks, signalMicroSubscriptionsTable: subscriptions, signalMicroOffersTable: offers,
  signalComplaintsTable: complaints, signalEmployerRestrictionsTable: restrictions } = await import("../lib/db/src/index.ts");
const { hashPassword } = await import("../artifacts/api-server/src/lib/signal-auth.ts");
const runId = randomUUID().slice(0, 8), scope = randomUUID(), prefix = `audit-recipient-${runId}-`;
const owned: { id: number; email: string; password: string; token: string; role: "candidate" | "employer" }[] = [];
const checks: { name: string; passed: true }[] = [];
const output = join("outputs", "verification", "independent-fixes-20261007", `microtask-recipients-${baseline ? "baseline" : "fixed"}-${runId}.json`);
const report: any = { schemaVersion: 1, status: "FAIL", startedAt: new Date().toISOString(), origin,
  database: target.pathname.slice(1), runtimeKind: baseline ? "existing-compiled-e72-historical-baseline" : "current-source-http",
  synthetic: true, population: { people: 21, resumesPerPerson: 5, equalAliases: true }, checks,
  credentialsExported: false, browserAcceptance: "Pending root browser review; HTTP is not browser evidence", cleanup: false };
async function request(account: typeof owned[number], path: string, method = "GET", body?: unknown, accepted = [200]) {
  const response = await fetch(`${origin}/api${path}`, { method, headers: { Origin: origin,
    Cookie: `fsp_signal_session=${account.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = response.status === 204 ? null : await response.json();
  assert.ok(accepted.includes(response.status), `${method} ${path}: ${response.status} ${data?.error ?? ""}`);
  return { status: response.status, data };
}
async function actor(role: "candidate" | "employer", ordinal: number, actorScope = scope, demoMode = true) {
  const password = `Owned-${randomBytes(18).toString("hex")}-aA1!`, email = `${prefix}${role}-${ordinal}@example.test`;
  const [user] = await db.insert(users).values({ email, passwordHash: await hashPassword(password), role,
    displayName: `Synthetic recipient ${ordinal}`, emailVerified: true, demoMode, reviewScopeId: demoMode ? actorScope : null }).returning();
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ userId: user!.id, demoMode, reviewScopeId: demoMode ? actorScope : null,
    tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 4 * 3600000) });
  const item = { id: user!.id, email, password, token, role }; owned.push(item);
  if (role === "candidate") {
    await db.insert(profiles).values({ userId: item.id, professionalAlias: `Shared alias · ${runId}`,
      visibility: "private", consentMatching: false });
    await db.insert(preferences).values({ candidateUserId: item.id, enabled: true });
  }
  return item;
}
async function document(userId: number, title: string, specialization = "Backend / Python", isPrimary = false, grade: "Junior" | "Middle" | "Senior" = "Middle") {
  const [row] = await db.insert(resumes).values({ userId, title, specialization, isPrimary,
    visibility: "pseudonymous", consentMatching: true, consentCatalog: true, verifiedGrade: grade, verifiedSkills: ["Python", "SQL"],
    legacyQualification: { specialization, grade, score: 80, skills: ["Python", "SQL"], assessedAt: "2026-10-01T09:00:00Z",
      gradeChangedAt: null, attemptId: null, limitation: "Owned synthetic historical fixture; no human or newly completed exam claim" } }).returning();
  return row!;
}
async function check(name: string, action: () => Promise<void>) { await action(); checks.push({ name, passed: true }); }
const templateBody = { title: `Учебные получатели · ${runId}`, specialization: "Backend / Python", competency: "SQL",
  scenario: "Учебная ситуация с вымышленной библиотекой: объясните правило транзакции и повторного запроса. Производственный код не нужен.",
  educationalOnly: true, expectedMinutes: 10, intervalDays: 7, deadlineDays: 3,
  rubric: [{ id: "reasoning", label: "Обоснование подхода", maxPoints: 3 }] };
try {
  const employer = await actor("employer", 0);
  const [company] = await db.insert(companies).values({ ownerUserId: employer.id, name: `Synthetic recipient company ${runId}`,
    contactEmail: employer.email }).returning();
  const candidates: typeof owned = [], documents: typeof resumes.$inferSelect[] = [];
  for (let n = 1; n <= 21; n++) {
    const person = await actor("candidate", n); candidates.push(person);
    for (let d = 1; d <= 5; d++) documents.push(await document(person.id, `Recipient ${String(n).padStart(2, "0")} · Document ${d}`, "Backend / Python", d === 1));
  }
  const template = (await request(employer, "/employer/microtasks", "POST", templateBody, [201])).data;
  const route = `/employer/microtasks/eligible/candidates?templateId=${template.id}`;
  const last = candidates.at(-1)!, lastResume = documents.at(-1)!;
  if (baseline) {
    await check("old array truncates 21x5 to first100; last person unreachable", async () => {
      const data = (await request(employer, route)).data; assert.ok(Array.isArray(data)); assert.equal(data.length, 100);
      assert.equal(data.some((item: any) => item.id === last.id), false);
      report.oldReturnedRows = data.length;
    });
    await db.insert(blocks).values(candidates.slice(0, 20).map(person => ({ candidateUserId: person.id, companyId: company!.id, active: true })));
    await check("old blocked first100 gives false empty although five later rows permitted", async () => {
      assert.deepEqual((await request(employer, route)).data, []);
      report.actualLaterPermittedRows = 5;
    });
    report.status = "REPRODUCED";
  } else {
    let firstCursor = "";
    await check("21x5 and duplicate aliases: deterministic bounded keyset visits all105 once", async () => {
      const found: number[] = []; let cursor: string | null = null, pages = 0;
      do {
        const page = (await request(employer, route + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""))).data;
        assert.deepEqual(Object.keys(page).sort(), ["items", "nextCursor"]); assert.ok(page.items.length <= 25);
        if (pages === 0) firstCursor = page.nextCursor;
        found.push(...page.items.map((item: any) => item.resumeId)); cursor = page.nextCursor; pages++;
        assert.ok(pages <= 5);
      } while (cursor);
      assert.deepEqual(found, documents.map(row => row.id)); assert.equal(new Set(found).size, 105); assert.equal(pages, 5);
      report.permittedPageCount = pages;
    });
    await check("server search finds exact last person's concrete fifth resume", async () => {
      const page = (await request(employer, route + "&search=Recipient%2021%20%C2%B7%20Document%205")).data;
      assert.equal(page.items.length, 1); assert.equal(page.items[0].id, last.id); assert.equal(page.items[0].resumeId, lastResume.id);
    });
    await check("ordinary and foreign reviewer candidates, foreign template and candidate role stay excluded", async () => {
      const ordinary = await actor("candidate", 1001, scope, false);
      const foreign = await actor("candidate", 1002, randomUUID());
      await document(ordinary.id, "Foreign ordinary recipient"); await document(foreign.id, "Foreign reviewer recipient");
      assert.deepEqual((await request(employer, route + "&search=Foreign")).data, { items: [], nextCursor: null });
      const foreignEmployer = await actor("employer", 1003, randomUUID());
      await db.insert(companies).values({ ownerUserId: foreignEmployer.id, name: "Foreign owned fixture company", contactEmail: foreignEmployer.email });
      await request(foreignEmployer, route, "GET", undefined, [404]);
      await request(last, route, "GET", undefined, [403]);
    });
    await check("active company invitation restriction denies list and subscription; lifting restores permitted list", async () => {
      const [complaint] = await db.insert(complaints).values({ reporterUserId: candidates[0]!.id, companyId: company!.id,
        objectType: "company", objectId: company!.id, category: "spam", explanation: "Owned synthetic trust control", status: "upheld" }).returning();
      const [restriction] = await db.insert(restrictions).values({ companyId: company!.id, complaintId: complaint!.id,
        scope: "invitations", moderatorUserId: employer.id, publicReason: "Owned synthetic temporary restriction",
        startsAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 3600000) }).returning();
      await request(employer, route, "GET", undefined, [403]);
      await request(employer, `/employer/microtasks/${template.id}/subscriptions`, "POST", { candidateId: last.id, resumeId: lastResume.id }, [403]);
      assert.equal((await db.select().from(subscriptions).where(eq(subscriptions.candidateUserId, last.id))).length, 0);
      await db.update(restrictions).set({ liftedAt: new Date(), liftReason: "Synthetic control complete", liftedByUserId: employer.id }).where(eq(restrictions.id, restriction!.id));
      assert.equal((await request(employer, route)).data.items.length, 25);
    });
    await db.insert(blocks).values(candidates.slice(0, 20).map(person => ({ candidateUserId: person.id, companyId: company!.id, active: true })));
    await check("first100 blocked: final page yields five later permitted rows and no prohibited totals", async () => {
      const page = (await request(employer, route)).data;
      assert.equal(page.items.length, 5); assert.equal(page.nextCursor, null); assert.ok(page.items.every((item: any) => item.id === last.id));
      assert.equal(JSON.stringify(page).includes(candidates[0]!.email), false);
      assert.deepEqual(Object.keys(page).sort(), ["items", "nextCursor"]);
    });
    await check("search must not reveal blocked aliases or rows", async () => {
      assert.deepEqual((await request(employer, route + "&search=Recipient%2001")).data, { items: [], nextCursor: null });
    });
    await db.update(blocks).set({ active: false }).where(eq(blocks.companyId, company!.id));
    await check("grade, search and template changes reject stale cursors; malformed bounds rejected", async () => {
      for (const suffix of [`&grade=Junior&cursor=${firstCursor}`, `&search=Recipient&cursor=${firstCursor}`, "&limit=51", "&grade=Other", "&limit=1&limit=2"])
        await request(employer, route + suffix, "GET", undefined, [400]);
      const front = (await request(employer, "/employer/microtasks", "POST", { ...templateBody, title: `${templateBody.title} Front`, specialization: "Frontend / TypeScript" }, [201])).data;
      assert.deepEqual((await request(employer, `/employer/microtasks/eligible/candidates?templateId=${front.id}`)).data, { items: [], nextCursor: null });
      await request(employer, `/employer/microtasks/eligible/candidates?templateId=${front.id}&cursor=${firstCursor}`, "GET", undefined, [400]);
      await request(employer, `/employer/microtasks/${front.id}/availability`, "POST", { active: false });
      await request(employer, `/employer/microtasks/eligible/candidates?templateId=${front.id}`, "GET", undefined, [404]);
    });
    await check("private primary does not conceal qualified secondary and primary switch keeps selectedID", async () => {
      await request(last, `/me/resumes/${documents[100]!.id}`, "PATCH", { visibility: "private", consentMatching: false });
      await request(last, `/me/resumes/${documents[101]!.id}/primary`, "POST", {});
      const rows = (await request(employer, route + "&search=Recipient%2021")).data.items;
      assert.equal(rows.some((row: any) => row.resumeId === documents[100]!.id), false);
      assert.equal(rows.some((row: any) => row.resumeId === lastResume.id), true);
    });
    await check("visibility revoked after selection refuses subscription without partial rows", async () => {
      await request(last, `/me/resumes/${lastResume.id}`, "PATCH", { visibility: "private", consentMatching: false });
      await request(employer, `/employer/microtasks/${template.id}/subscriptions`, "POST", { candidateId: last.id, resumeId: lastResume.id }, [404]);
      assert.equal((await db.select().from(subscriptions).where(eq(subscriptions.candidateUserId, last.id))).length, 0);
      assert.equal((await db.select().from(offers).where(eq(offers.candidateUserId, last.id))).length, 0);
      await request(last, `/me/resumes/${lastResume.id}`, "PATCH", { visibility: "pseudonymous", consentMatching: true });
    });
    await check("block revoked after selection refuses subscription with fresh server rights", async () => {
      await db.insert(blocks).values({ candidateUserId: last.id, companyId: company!.id, active: true });
      await request(employer, `/employer/microtasks/${template.id}/subscriptions`, "POST", { candidateId: last.id, resumeId: lastResume.id }, [403]);
      assert.equal((await db.select().from(subscriptions).where(eq(subscriptions.candidateUserId, last.id))).length, 0);
      await db.update(blocks).set({ active: false }).where(and(eq(blocks.companyId, company!.id), eq(blocks.candidateUserId, last.id)));
    });
    await check("concrete fifth resume subscription captures its original selected resume and revision", async () => {
      const result = (await request(employer, `/employer/microtasks/${template.id}/subscriptions`, "POST", { candidateId: last.id, resumeId: lastResume.id })).data;
      assert.equal(result.resumeId, lastResume.id); assert.equal(result.resumeContext.resumeId, lastResume.id);
      assert.equal(result.resumeProvenance, "captured");
      report.selectedResumeId = lastResume.id; report.subscriptionId = result.id;
    });
    if (keep) {
      const privatePath = join(homedir(), ".codex", "private", `signal-recipient-audit-${runId}.json`);
      await mkdir(join(homedir(), ".codex", "private"), { recursive: true });
      await writeFile(privatePath, JSON.stringify({ runId, prefix, database: target.pathname.slice(1), scope,
        templateId: template.id, companyId: company!.id, selectedResumeId: lastResume.id,
        accounts: owned.map(({ token, ...account }) => account) }, null, 2));
      report.privateManifestPath = privatePath;
      report.fixturesRetainedForBrowser = true;
    }
    report.status = "PASS";
  }
} catch (error) { report.failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  if (!keep || baseline || report.status !== "PASS") {
    if (owned.length) await db.transaction(async tx => {
      const rows = await tx.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, owned.map(item => item.id)));
      assert.ok(rows.every(row => owned.some(item => item.id === row.id && item.email === row.email && row.email.startsWith(prefix))));
      await tx.delete(users).where(and(inArray(users.id, owned.map(item => item.id)), sql`${users.email} like ${prefix + "%"}`));
    });
    report.cleanup = true;
  }
  report.completedAt = new Date().toISOString();
  report.currentSourceHashes = Object.fromEntries(await Promise.all(["artifacts/api-server/src/routes/signal-microtasks.ts", "artifacts/api-server/src/lib/microtask-recipient-query.ts", "artifacts/fsp-signal/src/components/microtasks.tsx"].map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  report.currentSourceHashesScope = baseline ? "Runner current checkout only; not historical compiled runtime association" : "Current source route/query/UI inputs; browser not claimed";
  await mkdir(join("outputs", "verification", "independent-fixes-20261007"), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ status: report.status, checks: checks.length, output, privateManifestPath: report.privateManifestPath ?? null, failure: report.failure ?? null }));
  await pool.end();
}
