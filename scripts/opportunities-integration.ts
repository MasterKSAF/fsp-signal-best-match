/** Local synthetic functional fixtures. No human validation claims or user data resets. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { and, desc, eq, inArray } from "drizzle-orm";
const apiOrigin = process.env.INTEGRATION_API_ORIGIN || "http://127.0.0.1:4312";
const appOrigin =
  process.env.INTEGRATION_APP_ORIGIN ||
  process.env.PUBLIC_URL ||
  "http://127.0.0.1:4310";
for (const url of [apiOrigin, appOrigin, process.env.DATABASE_URL || ""])
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
    "Only local fixtures are permitted",
  );
const {
  db,
  pool,
  signalUsersTable: users,
  signalCandidateProfilesTable: profiles,
  signalCompaniesTable: companies,
  signalSessionsTable: sessions,
  signalNeedsTable: needs,
  signalInvitationsTable: invitations,
  signalMicroOffersTable: offers,
  signalMicroTemplatesTable: templates,
  signalMicroSubscriptionsTable: subscriptions,
  signalContactGrantsTable: grants,
} = await import("../lib/db/src/index.ts");
const { runMicrotaskScheduler } =
  await import("../artifacts/api-server/src/lib/microtask-scheduler.ts");
const run = randomUUID().slice(0, 8);
const ids: number[] = [];
const checks: string[] = [];
function passed(label: string) {
  checks.push(label);
  console.log(`PASS ${label}`);
}
class Client {
  constructor(readonly token = "") {}
  async call(path: string, method = "GET", body?: unknown, expected = [200]) {
    const r = await fetch(`${apiOrigin}/api${path}`, {
      method,
      headers: {
        Origin: appOrigin,
        ...(this.token ? { Cookie: `fsp_signal_session=${this.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const result: any = await r.json();
    assert.ok(
      expected.includes(r.status),
      `${method} ${path}: ${r.status} ${result.error || ""}`,
    );
    return result;
  }
}
async function fixture(
  role: "candidate" | "employer",
  demo = false,
  verified = true,
) {
  const email = `signal-opportunities-${run}-${ids.length}@example.test`;
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash: "fixture-session-only-no-login",
      role,
      displayName: `Учебный участник ${ids.length}`,
      emailVerified: true,
      demoMode: demo,
    })
    .returning();
  ids.push(user.id);
  let companyId = 0;
  if (role === "candidate")
    await db.insert(profiles).values({
      userId: user.id,
      professionalAlias: `Учебный Python ${user.id}`,
      contactEmail: email,
      phone: "+70000000000",
      verifiedGrade: verified ? "Middle" : null,
      verifiedSkills: verified ? ["Python"] : [],
      visibility: "pseudonymous",
      consentMatching: true,
    });
  else {
    const [company] = await db
      .insert(companies)
      .values({
        ownerUserId: user.id,
        name: `Учебная компания ${user.id}`,
        contactEmail: email,
      })
      .returning();
    companyId = company.id;
  }
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: createHash("sha256").update(token).digest("hex"),
    userId: user.id,
    demoMode: demo,
    expiresAt: new Date(Date.now() + 3600000),
  });
  return { user, companyId, client: new Client(token) };
}
const job = {
  title: "Учебный Backend инженер",
  description:
    "Синтетический сценарий вакансии: разработка API, командная работа и покрытие тестами.",
  specialization: "Backend / Python",
  grade: "Middle",
  skills: ["Python"],
  workFormat: "Удалённо",
  salaryMin: 140000,
  salaryMax: 200000,
  salaryPeriod: "month",
  salaryType: "gross",
};
const micro = {
  title: "Учебная обработка повторов",
  competency: "Идемпотентность",
  scenario:
    "Вымышленная библиотека считает посещения. Предложите правило обработки повторных запросов и тестовый сценарий. Это учебная задача без производственных данных.",
  expectedMinutes: 20,
  intervalDays: 7,
  deadlineDays: 3,
  educationalOnly: true,
  rubric: [
    { id: "rule", label: "Однозначное правило повторов", maxPoints: 4 },
    { id: "test", label: "Проверяемый тестовый сценарий", maxPoints: 3 },
  ],
};
try {
  const employer = await fixture("employer"),
    other = await fixture("employer"),
    candidate = await fixture("candidate"),
    ungraded = await fixture("candidate", false, false),
    lateCandidate = await fixture("candidate"),
    demo = await fixture("candidate", true),
    demoEmployer = await fixture("employer", true);
  const e = employer.client,
    c = candidate.client,
    d = demo.client;
  await new Client().call("/employer/jobs", "GET", undefined, [401]);
  await c.call("/employer/jobs", "POST", job, [403]);
  await e.call("/me/applications", "GET", undefined, [403]);
  await e.call("/employer/jobs", "POST", { ...job, salaryMin: 0 }, [400]);
  const draft = await e.call("/employer/jobs", "POST", job, [201]);
  assert.ok(
    !(await c.call("/public/jobs")).some((j: any) => j.id === draft.id),
  );
  await c.call(`/public/jobs/${draft.id}`, "GET", undefined, [404]);
  await other.client.call(`/employer/jobs/${draft.id}`, "PUT", job, [404]);
  passed(
    "Separate draft, salary validation, authentication, role and company ownership",
  );
  await e.call(`/employer/jobs/${draft.id}/status`, "POST", {
    status: "published",
  });
  const pub = await c.call(`/public/jobs/${draft.id}`);
  assert.equal(pub.salaryMin, 140000);
  await d.call(`/public/jobs/${draft.id}`, "GET", undefined, [404]);
  const dj = await demoEmployer.client.call(
    "/employer/jobs",
    "POST",
    job,
    [201],
  );
  await demoEmployer.client.call(`/employer/jobs/${dj.id}/status`, "POST", {
    status: "published",
  });
  await c.call(`/public/jobs/${dj.id}`, "GET", undefined, [404]);
  assert.ok(
    !(await new Client().call("/public/jobs")).some((j: any) => j.id === dj.id),
  );
  passed("Published detail and list isolate real, Demo and anonymous pools");
  const consent = {
    companyId: employer.companyId,
    jobVersion: 1,
    consentDisclosure: true,
    message: "Учебный отклик на вымышленную вакансию.",
  };
  await c.call(
    `/jobs/${draft.id}/applications`,
    "POST",
    { ...consent, consentDisclosure: false },
    [400],
  );
  await c.call(
    `/jobs/${draft.id}/applications`,
    "POST",
    { ...consent, companyId: other.companyId },
    [404],
  );
  const concurrent = await Promise.all([
    c.call(`/jobs/${draft.id}/applications`, "POST", consent, [200, 201]),
    c.call(`/jobs/${draft.id}/applications`, "POST", consent, [200, 201]),
  ]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  const application = concurrent[0];
  await e.call(`/employer/jobs/${draft.id}`, "PUT", {
    ...job,
    salaryMin: 170000,
  });
  const ownApp = (await c.call("/me/applications")).find(
    (a: any) => a.id === application.id,
  );
  assert.equal(ownApp.snapshot.salaryMin, 140000);
  assert.equal(ownApp.snapshot.version, 1);
  await ungraded.client.call(
    `/jobs/${draft.id}/applications`,
    "POST",
    consent,
    [409],
  );
  const uapp = await ungraded.client.call(
    `/jobs/${draft.id}/applications`,
    "POST",
    { ...consent, jobVersion: 2 },
    [201],
  );
  assert.ok(uapp.id);
  await e.call(`/employer/jobs/${draft.id}/status`, "POST", {
    status: "closed",
  });
  await lateCandidate.client.call(
    `/jobs/${draft.id}/applications`,
    "POST",
    {
      ...consent,
      jobVersion: 2,
    },
    [404],
  );
  await d.call(`/jobs/${draft.id}/applications`, "POST", consent, [404]);
  assert.equal(
    (await c.call(`/jobs/${draft.id}/applications`, "POST", consent)).id,
    application.id,
  );
  passed(
    "Explicit disclosure, concurrent replay, immutable conditions and version conflict; closing refuses new applications",
  );
  const contact = await e.call(
    `/employer/applications/${application.id}/contacts`,
  );
  assert.equal(contact.email, candidate.user.email);
  await other.client.call(
    `/employer/applications/${application.id}/contacts`,
    "GET",
    undefined,
    [403],
  );
  await e.call(`/employer/applications/${application.id}/status`, "POST", {
    status: "viewed",
  });
  await e.call(`/employer/applications/${application.id}/status`, "POST", {
    status: "shortlisted",
  });
  assert.equal(
    (await c.call("/me/applications")).find((a: any) => a.id === application.id)
      .status,
    "shortlisted",
  );
  passed("Both roles observe statuses; only addressed company reads contacts");
  const [need] = await db
    .insert(needs)
    .values({
      ...job,
      companyId: employer.companyId,
      requiredSkills: ["Python"],
      desirableSkills: [],
      skills: undefined,
    } as any)
    .returning();
  const [invitation] = await db
    .insert(invitations)
    .values({
      needId: need.id,
      companyId: employer.companyId,
      candidateUserId: candidate.user.id,
      title: job.title,
      message: "Учебное приглашение",
      reason: "Синтетическая проверка разрешений",
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryPeriod: "month",
      salaryType: "gross",
      workFormat: job.workFormat,
    })
    .returning();
  await c.call(`/me/invitations/${invitation.id}/decision`, "POST", {
    decision: "accept",
    consentContactDisclosure: true,
  });
  assert.equal(
    (
      await db
        .select()
        .from(grants)
        .where(
          and(
            eq(grants.candidateUserId, candidate.user.id),
            eq(grants.companyId, employer.companyId),
          ),
        )
    ).length,
    2,
  );
  await c.call(`/me/invitations/${invitation.id}/revoke-contact`, "POST");
  await e.call(
    `/employer/applications/${application.id}/contacts`,
    "GET",
    undefined,
    [403],
  );
  await e.call(
    `/employer/invitations/${invitation.id}/contacts`,
    "GET",
    undefined,
    [403],
  );
  await c.call(`/jobs/${draft.id}/applications`, "POST", consent);
  await c.call(`/me/invitations/${invitation.id}/decision`, "POST", {
    decision: "accept",
    consentContactDisclosure: true,
  });
  await e.call(
    `/employer/applications/${application.id}/contacts`,
    "GET",
    undefined,
    [403],
  );
  const hidden = (await e.call("/employer/applications")).find(
    (a: any) => a.id === application.id,
  );
  assert.equal(hidden.candidate, null);
  assert.equal(hidden.message, "");
  passed(
    "Multiple invitation/application bases revoked atomically; old request replay cannot silently regrant or expose profile",
  );
  await c.call(`/me/applications/${application.id}/withdraw`, "POST");
  await c.call(`/me/applications/${application.id}/withdraw`, "POST");
  await e.call(
    `/employer/applications/${application.id}/status`,
    "POST",
    { status: "shortlisted" },
    [409],
  );
  await e.call(`/employer/jobs/${draft.id}/status`, "POST", {
    status: "archived",
  });
  await e.call(
    `/employer/jobs/${draft.id}/status`,
    "POST",
    { status: "published" },
    [409],
  );
  passed(
    "Application withdrawal idempotent, terminal status and job archive enforced",
  );
  const newJob = await e.call("/employer/jobs", "POST", job, [201]);
  await e.call(`/employer/jobs/${newJob.id}/status`, "POST", {
    status: "published",
  });
  const newApplication = await c.call(
    `/jobs/${newJob.id}/applications`,
    "POST",
    consent,
    [201],
  );
  assert.equal(
    (await e.call(`/employer/applications/${newApplication.id}/contacts`))
      .email,
    candidate.user.email,
  );
  await e.call(
    `/employer/invitations/${invitation.id}/contacts`,
    "GET",
    undefined,
    [403],
  );
  await c.call(`/me/contact-permissions/${employer.companyId}/revoke`, "POST");
  await c.call(`/me/contact-permissions/${employer.companyId}/revoke`, "POST");
  await c.call(`/jobs/${newJob.id}/applications`, "POST", consent);
  await e.call(
    `/employer/applications/${newApplication.id}/contacts`,
    "GET",
    undefined,
    [403],
  );
  passed(
    "Fresh explicit application grants only a new basis; company-wide revoke is idempotent and old bases remain closed",
  );
  const template = await e.call("/employer/microtasks", "POST", micro, [201]);
  await e.call(
    `/employer/microtasks/${template.id}/subscriptions`,
    "POST",
    { candidateId: candidate.user.id },
    [404],
  );
  await c.call("/me/microtasks/preferences", "PUT", { enabled: true });
  await ungraded.client.call("/me/microtasks/preferences", "PUT", {
    enabled: true,
  });
  await d.call("/me/microtasks/preferences", "PUT", { enabled: true });
  await e.call(
    `/employer/microtasks/${template.id}/subscriptions`,
    "POST",
    { candidateId: ungraded.user.id },
    [404],
  );
  await e.call(
    `/employer/microtasks/${template.id}/subscriptions`,
    "POST",
    { candidateId: demo.user.id },
    [404],
  );
  const subscription = await e.call(
    `/employer/microtasks/${template.id}/subscriptions`,
    "POST",
    { candidateId: candidate.user.id },
  );
  const initial = await c.call("/me/microtasks");
  assert.equal(initial.offers.length, 1);
  const offer = initial.offers[0];
  assert.equal(
    (
      await e.call(
        `/employer/microtasks/${template.id}/subscriptions`,
        "POST",
        { candidateId: candidate.user.id },
      )
    ).id,
    subscription.id,
  );
  assert.equal((await c.call("/me/microtasks")).offers.length, 1);
  passed(
    "Practice opt-in, verified category gate, pool isolation and idempotent server schedule",
  );
  await e.call(`/employer/microtasks/${template.id}`, "PUT", {
    ...micro,
    scenario: micro.scenario + " Уточнение второй версии.",
  });
  assert.equal((await c.call("/me/microtasks")).offers[0].snapshot.version, 1);
  await c.call(
    `/me/microtasks/${offer.id}/decision`,
    "POST",
    { decision: "accept" },
    [400],
  );
  await c.call(`/me/microtasks/${offer.id}/decision`, "POST", {
    decision: "accept",
    consentCompanyReview: true,
  });
  const answer =
    "Учебное решение: используем ключ идемпотентности, атомарную запись и повторяем запрос с тем же ключом.";
  await c.call(`/me/microtasks/${offer.id}/submit`, "POST", { answer });
  await c.call(`/me/microtasks/${offer.id}/submit`, "POST", { answer });
  await c.call(
    `/me/microtasks/${offer.id}/submit`,
    "POST",
    { answer: answer + "Изменение" },
    [409],
  );
  const evaluation = {
    scores: [
      { criterionId: "rule", points: 4, comment: "Ключ описан явно." },
      {
        criterionId: "test",
        points: 2,
        comment: "Повтор задан; аварийный случай не раскрыт.",
      },
    ],
    feedback:
      "Правило корректно, добавьте сценарий сбоя между записью и ответом.",
  };
  await other.client.call(
    `/employer/microtasks/offers/${offer.id}/evaluate`,
    "POST",
    evaluation,
    [409],
  );
  await e.call(
    `/employer/microtasks/offers/${offer.id}/evaluate`,
    "POST",
    {
      ...evaluation,
      scores: [
        { criterionId: "rule", points: 100, comment: "Неверный диапазон." },
      ],
    },
    [409],
  );
  await e.call(
    `/employer/microtasks/offers/${offer.id}/evaluate`,
    "POST",
    evaluation,
  );
  await e.call(
    `/employer/microtasks/offers/${offer.id}/evaluate`,
    "POST",
    {
      ...evaluation,
      feedback: "Замена уже сохранённой оценки не допускается.",
    },
    [409],
  );
  await e.call(
    `/employer/microtasks/offers/${offer.id}/evaluate`,
    "POST",
    evaluation,
  );
  const [unchanged] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, candidate.user.id));
  assert.equal(unchanged.verifiedGrade, "Middle");
  assert.equal(unchanged.latestAssessmentAt, null);
  assert.equal(
    (await e.call(`/employer/micro-evidence/${candidate.user.id}`)).length,
    0,
  );
  await c.call(`/me/microtasks/${offer.id}/visibility`, "POST", {
    shareResult: true,
  });
  const shared = await other.client.call(
    `/employer/micro-evidence/${candidate.user.id}`,
  );
  assert.equal(shared.length, 1);
  assert.equal(shared[0].answer, undefined);
  assert.equal(shared[0].result.evaluatorUserId, undefined);
  assert.equal(
    (await other.client.call("/employer/microtasks/offers")).length,
    0,
  );
  await db
    .update(profiles)
    .set({ visibility: "private" })
    .where(eq(profiles.userId, candidate.user.id));
  await other.client.call(
    `/employer/micro-evidence/${candidate.user.id}`,
    "GET",
    undefined,
    [404],
  );
  await db
    .update(profiles)
    .set({ visibility: "pseudonymous" })
    .where(eq(profiles.userId, candidate.user.id));
  await c.call(`/me/microtasks/${offer.id}/visibility`, "POST", {
    shareResult: false,
  });
  assert.equal(
    (await other.client.call(`/employer/micro-evidence/${candidate.user.id}`))
      .length,
    0,
  );
  passed(
    "Two-role immutable answer and rubric-based evidence; no grade/freshness change; explicit result sharing and source-company answer privacy",
  );
  const t0 = new Date(offer.createdAt);
  const day = 86400000;
  const blocked = await runMicrotaskScheduler(
    new Date(t0.getTime() + 7 * day - 1),
    [candidate.user.id],
  );
  assert.equal(blocked.created, 0);
  const next = await runMicrotaskScheduler(
    new Date(t0.getTime() + 7 * day + 10),
    [candidate.user.id],
  );
  assert.equal(next.created, 1);
  assert.equal(
    (
      await runMicrotaskScheduler(new Date(t0.getTime() + 7 * day + 10), [
        candidate.user.id,
      ])
    ).created,
    0,
  );
  const [second] = await db
    .select()
    .from(offers)
    .where(
      and(
        eq(offers.candidateUserId, candidate.user.id),
        eq(offers.status, "offered"),
      ),
    );
  assert.equal(second.snapshot.version, 2);
  await c.call(`/me/microtasks/${second.id}/decision`, "POST", {
    decision: "accept",
    consentCompanyReview: true,
  });
  await runMicrotaskScheduler(new Date(t0.getTime() + 11 * day), [
    candidate.user.id,
  ]);
  const [expired] = await db
    .select()
    .from(offers)
    .where(eq(offers.id, second.id));
  assert.equal(expired.status, "expired");
  await c.call(`/me/microtasks/${second.id}/submit`, "POST", { answer }, [409]);
  await c.call(
    `/me/microtasks/${second.id}/decision`,
    "POST",
    { decision: "accept", consentCompanyReview: true },
    [409],
  );
  await c.call("/me/microtasks/preferences", "PUT", { enabled: false });
  assert.equal(
    (
      await runMicrotaskScheduler(new Date(t0.getTime() + 21 * day), [
        candidate.user.id,
      ])
    ).created,
    0,
  );
  await c.call("/me/microtasks/preferences", "PUT", { enabled: true });
  await e.call(`/employer/microtasks/${template.id}/subscriptions`, "POST", {
    candidateId: candidate.user.id,
  });
  assert.equal(
    (
      await runMicrotaskScheduler(new Date(t0.getTime() + 21 * day), [
        candidate.user.id,
      ])
    ).created,
    0,
  );
  await c.call(`/me/microtasks/subscriptions/${subscription.id}`, "POST", {
    active: true,
  });
  assert.equal(
    (
      await runMicrotaskScheduler(new Date(t0.getTime() + 21 * day), [
        candidate.user.id,
      ])
    ).created,
    1,
  );
  passed(
    "Fake clock scoped to fixtures: weekly follow-up, persisted restart replay, version snapshot, expiry, opt-out and explicit candidate resume",
  );
  const [third] = await db
    .select()
    .from(offers)
    .where(
      and(
        eq(offers.candidateUserId, candidate.user.id),
        eq(offers.status, "offered"),
      ),
    );
  await c.call(`/me/microtasks/${third.id}/decision`, "POST", {
    decision: "decline",
  });
  await c.call(`/me/microtasks/${third.id}/decision`, "POST", {
    decision: "decline",
  });
  await c.call(`/me/microtasks/${offer.id}/revoke`, "POST");
  await c.call(`/me/microtasks/${offer.id}/revoke`, "POST");
  const ownRevoked = (await c.call("/me/microtasks")).offers.find(
    (o: any) => o.id === offer.id,
  );
  assert.ok(ownRevoked.answer);
  assert.ok(ownRevoked.result);
  const companyRevoked = (await e.call("/employer/microtasks/offers")).find(
    (o: any) => o.id === offer.id,
  );
  assert.equal(companyRevoked.answer, null);
  assert.equal(companyRevoked.result, null);
  await e.call(
    `/employer/microtasks/offers/${offer.id}/evaluate`,
    "POST",
    evaluation,
    [409],
  );
  await c.call(
    `/me/microtasks/${offer.id}/visibility`,
    "POST",
    { shareResult: true },
    [409],
  );
  assert.equal(
    (
      await runMicrotaskScheduler(new Date(t0.getTime() + 40 * day), [
        candidate.user.id,
      ])
    ).created,
    0,
  );
  passed(
    "Decline, consent withdrawal and no regrant; owner evidence retained, company answer withheld and future schedule stopped",
  );
  const paged = await fixture("candidate");
  await paged.client.call("/me/microtasks/preferences", "PUT", {
    enabled: true,
  });
  const pageTime = new Date(Date.now() + 2 * day);
  const disabled = await db
    .insert(templates)
    .values(
      Array.from({ length: 101 }, (_, index) => ({
        ...micro,
        title: `Учебная приостановленная программа ${index + 1}`,
        companyId: employer.companyId,
        active: false,
      })),
    )
    .returning();
  const [lastTemplate] = await db
    .insert(templates)
    .values({ ...micro, companyId: employer.companyId })
    .returning();
  await db.insert(subscriptions).values(
    [...disabled, lastTemplate].map((template) => ({
      templateId: template.id,
      candidateUserId: paged.user.id,
      nextDueAt: pageTime,
    })),
  );
  const pages = await Promise.all([
    runMicrotaskScheduler(pageTime, [paged.user.id]),
    runMicrotaskScheduler(pageTime, [paged.user.id]),
  ]);
  assert.equal(
    pages.reduce((total, result) => total + result.created, 0),
    1,
  );
  assert.ok(pages.every((result) => result.checked >= 101));
  assert.equal(
    (
      await db
        .select()
        .from(offers)
        .where(eq(offers.candidateUserId, paged.user.id))
    ).length,
    1,
  );
  assert.equal(
    (await runMicrotaskScheduler(pageTime, [paged.user.id])).created,
    0,
  );
  const [waitingTemplate] = await db
    .insert(templates)
    .values({
      ...micro,
      title: "Следующая учебная программа",
      companyId: employer.companyId,
    })
    .returning();
  const [waitingSubscription] = await db
    .insert(subscriptions)
    .values({
      templateId: waitingTemplate.id,
      candidateUserId: paged.user.id,
      nextDueAt: new Date(pageTime.getTime() + 1),
    })
    .returning();
  assert.equal(
    (
      await runMicrotaskScheduler(new Date(pageTime.getTime() + 7 * day), [
        paged.user.id,
      ])
    ).created,
    1,
  );
  const [nextProgramOffer] = await db
    .select()
    .from(offers)
    .where(eq(offers.candidateUserId, paged.user.id))
    .orderBy(desc(offers.createdAt))
    .limit(1);
  assert.equal(
    nextProgramOffer.subscriptionId,
    waitingSubscription.id,
    "An older subscription cannot take every weekly slot while another program is overdue",
  );
  passed(
    "Scheduler pages beyond 100 blocked subscriptions; concurrent replay creates one offer; overdue programs fairly receive subsequent weekly slots",
  );
  await mkdir("outputs/verification", { recursive: true });
  await writeFile(
    process.env.INTEGRATION_REPORT_PATH || "outputs/verification/opportunities-integration.json",
    JSON.stringify(
      {
        passed: true,
        generatedAt: new Date().toISOString(),
        apiOrigin,
        groups: checks.length,
        checks,
        source:
          "Local synthetic fixtures; controlled clock scopes only captured candidate IDs; no human validation",
      },
      null,
      2,
    ),
  );
  console.log(`PASS ${checks.length} opportunity integration groups`);
} finally {
  if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
}
