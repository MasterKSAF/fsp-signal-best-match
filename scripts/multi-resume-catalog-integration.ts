/** Explicit isolated DB/API only. Synthetic fixtures; restores by deleting only its own created users. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  signalUsersTable as users,
  signalSessionsTable as sessions,
  signalCandidateProfilesTable as profiles,
  signalCompaniesTable as companies,
  signalCandidateResumesTable as resumes,
  signalAssessmentAttemptsTable as attempts,
  signalInvitationsTable as invitations,
  signalInvitationRequestsTable as receipts,
} from "../lib/db/src/index";
import {
  ensureCandidateResume,
  recomputeCandidateResumes,
} from "../artifacts/api-server/src/lib/signal-resume";
import { assembleManagedAttempt } from "../artifacts/api-server/src/lib/assessment-managed";
import { assessmentBankVersion } from "../artifacts/api-server/src/lib/assessment-bank";
assert.equal(
  process.env.SIGNAL_CATALOG_TEST_ISOLATED,
  "1",
  "Set SIGNAL_CATALOG_TEST_ISOLATED=1 only for an isolated test DB/API",
);
const apiOrigin = process.env.INTEGRATION_API_ORIGIN!,
  origin = process.env.INTEGRATION_APP_ORIGIN!;
for (const raw of [apiOrigin, origin, process.env.DATABASE_URL!])
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(raw).hostname),
    "Local isolated fixture only",
  );
assert.ok(apiOrigin && origin);
const nonce = randomBytes(6).toString("hex"),
  ownedIds: number[] = [],
  passed: string[] = [];
const prefix = `CAT-${nonce}`,
  startedAt = new Date().toISOString();
async function fixture(role: "candidate" | "employer", index = 0) {
  const token = randomBytes(32).toString("base64url");
  const [user] = await db
    .insert(users)
    .values({
      email: `catalog-${nonce}-${role}-${index}@example.test`,
      passwordHash: "unusable-synthetic-fixture",
      role,
      displayName: `Synthetic account ${index}`,
      emailVerified: true,
      demoMode: false,
    })
    .returning();
  ownedIds.push(user.id);
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 600000),
    demoMode: false,
  });
  let companyId: number | undefined, resumeId: number | undefined;
  if (role === "employer") {
    const [company] = await db
      .insert(companies)
      .values({
        ownerUserId: user.id,
        name: `Synthetic company ${nonce}-${index}`,
        contactEmail: user.email,
      })
      .returning();
    companyId = company.id;
  } else {
    await db.insert(profiles).values({
      userId: user.id,
      professionalAlias: `${prefix} ${String(index).padStart(3, "0")}`,
      specialization: "Backend / Python",
      contactEmail: user.email,
      consentMatching: true,
      visibility: "pseudonymous",
      workFormat: "Удалённо",
      salaryMin: 120000,
      salaryMax: 180000,
      salaryPeriod: "month",
      salaryType: "gross",
    });
    const row = await ensureCandidateResume(user.id);
    assert.ok(row);
    resumeId = row.id;
    const form = assembleManagedAttempt(
        "backend-python",
        "Middle",
        `catalog-${nonce}-${index}`,
      ),
      at = new Date();
    await db.insert(attempts).values({
      userId: user.id,
      resumeId: row.id,
      resumeSpecialization: row.specialization,
      programVersion: assessmentBankVersion(form.cases, form.oracles),
      programId: "backend-python",
      grade: "Middle",
      status: "submitted",
      ...form,
      answers: form.cases.map((item) => ({
        caseId: item.id,
        answer: form.oracles[item.id]!.answer,
      })),
      score: 100,
      verified: true,
      startedAt: new Date(at.getTime() - 60000),
      dueAt: new Date(at.getTime() + 60000),
      submittedAt: at,
    });
    await recomputeCandidateResumes(user.id);
  }
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    expected: number | number[] = 200,
    extraHeaders: Record<string, string> = {},
  ) {
    const response = await fetch(`${apiOrigin}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        Cookie: `fsp_signal_session=${token}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = response.status === 204 ? null : await response.json();
    assert.ok(
      (Array.isArray(expected) ? expected : [expected]).includes(
        response.status,
      ),
      `${method} ${path} ${response.status}: ${JSON.stringify(data)}`,
    );
    return { status: response.status, data };
  }
  return { user, companyId, resumeId: resumeId!, request };
}
const needBody = {
  title: "Synthetic backend need",
  specialization: "Backend / Python",
  grade: "Middle",
  requiredSkills: ["Python", "SQL"],
  desirableSkills: ["API contracts"],
  description: "Synthetic complete-resume catalogue regression",
  workFormat: "Удалённо",
  salaryMin: 100000,
  salaryMax: 200000,
  salaryPeriod: "month",
  salaryType: "gross",
};
function inviteBody(
  needId: number,
  candidate: { user: { id: number }; resumeId: number },
  title = "Synthetic offer",
) {
  return {
    needId,
    candidateId: candidate.user.id,
    resumeId: candidate.resumeId,
    title,
    message: "Synthetic bounded offer message",
    reason: "Confirmed Python and SQL in selected resume",
    salaryMin: 100000,
    salaryMax: 200000,
    salaryPeriod: "month",
    salaryType: "gross",
    workFormat: "Удалённо",
  };
}
try {
  const employer = await fixture("employer", 1),
    otherEmployer = await fixture("employer", 2),
    candidate = await fixture("candidate", 1),
    second = await fixture("candidate", 2);
  const need = (
    await employer.request("/employer/needs", "POST", needBody, 201)
  ).data;
  const matches = (await employer.request(`/matches?needId=${need.id}`)).data;
  assert.ok(
    matches.some(
      (row: any) =>
        row.candidateId === candidate.user.id &&
        row.resumeId === candidate.resumeId,
    ),
  );
  assert.equal(
    (await employer.request(`/employer/candidates?q=${prefix}`)).data.total,
    0,
  );
  passed.push(
    "legacy matching consent retained, separate catalogue publication opt-in defaults false",
  );
  for (const actor of [candidate, second])
    await actor.request(`/me/resumes/${actor.resumeId}`, "PATCH", {
      visibility: "pseudonymous",
      consentMatching: true,
      consentCatalog: true,
      readyForOffers: true,
    });
  const fixturePhoto =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYZkAAAAASUVORK5CYII=";
  await db
    .update(profiles)
    .set({ avatarDataUrl: fixturePhoto, avatarUpdatedAt: new Date() })
    .where(eq(profiles.userId, candidate.user.id));
  await candidate.request(`/me/resumes/${candidate.resumeId}`, "PATCH", {
    visibility: "public",
  });
  const photographed = (
    await employer.request(`/employer/candidates?q=${prefix}&hasPhoto=yes`)
  ).data;
  assert.equal(photographed.total, 1);
  assert.equal(photographed.candidates[0].avatarDataUrl, fixturePhoto);
  assert.ok(
    photographed.candidates[0].availableResumes.every(
      (row: any) => !("avatarDataUrl" in row),
    ),
  );
  await candidate.request(`/me/resumes/${candidate.resumeId}`, "PATCH", {
    visibility: "pseudonymous",
  });
  assert.equal(
    (await employer.request(`/employer/candidates?q=${prefix}&hasPhoto=yes`))
      .data.total,
    0,
  );
  const pseudonymousDetail = (
    await employer.request(`/employer/candidates/${candidate.resumeId}`)
  ).data;
  assert.equal(pseudonymousDetail.avatarDataUrl, null);
  assert.equal(pseudonymousDetail.publicName, null);
  passed.push(
    "pool photo presence uses real public bytes, selected card loads actual photo, pseudonymous images/identity remain hidden",
  );
  const copy = (
    await candidate.request(
      "/me/resumes",
      "POST",
      {
        title: "Second backend",
        specialization: "Backend / Python",
        copyFromId: candidate.resumeId,
      },
      201,
    )
  ).data;
  assert.ok(copy.id ?? copy.resumeId);
  const copyId = copy.id ?? copy.resumeId;
  await candidate.request(`/me/resumes/${copyId}`, "PATCH", {
    visibility: "pseudonymous",
    consentMatching: true,
    consentCatalog: true,
  });
  const frontend = (
    await candidate.request(
      "/me/resumes",
      "POST",
      { title: "Frontend Junior", specialization: "Frontend / TypeScript" },
      201,
    )
  ).data;
  const frontendId = frontend.id ?? frontend.resumeId;
  await candidate.request(`/me/resumes/${frontendId}`, "PATCH", {
    visibility: "pseudonymous",
    consentCatalog: true,
  });
  const list = (await employer.request(`/employer/candidates?q=${prefix}`))
    .data;
  assert.equal(list.total, 2);
  assert.equal(
    list.candidates.filter((row: any) => row.candidateId === candidate.user.id)
      .length,
    1,
  );
  assert.equal(
    list.candidates.find((row: any) => row.candidateId === candidate.user.id)
      .availableResumes.length,
    3,
  );
  assert.equal(
    (
      await employer.request(
        `/employer/candidates?q=${prefix}&specialization=Frontend%20%2F%20TypeScript&grade=Senior`,
      )
    ).data.total,
    0,
  );
  const selected = (
    await employer.request(`/matches?needId=${need.id}&resumeId=${copyId}`)
  ).data.find((row: any) => row.candidateId === candidate.user.id);
  assert.equal(selected.resumeId, copyId);
  assert.equal(selected.verifiedGrade, "Middle");
  const explanation = (
    await employer.request(
      `/matches/explanation?needId=${need.id}&candidateId=${candidate.user.id}&resumeId=${copyId}`,
    )
  ).data;
  assert.equal(explanation.resumeId, copyId);
  assert.equal(explanation.ranking.position, selected.ranking.position);
  assert.ok(explanation.evidence.some((row: any) => row.provenance?.attemptId));
  const own = (await candidate.request(`/me/evidence?resumeId=${copyId}`)).data;
  assert.equal(own.resumeId, copyId);
  assert.ok(own.evidence.length > 0);
  assert.ok(
    !/oracles|correctAnswer|savedAnswer|passwordHash/.test(JSON.stringify(own)),
  );
  await second.request(
    `/me/evidence?resumeId=${copyId}`,
    "GET",
    undefined,
    404,
  );
  await otherEmployer.request(
    `/employer/compare?needId=${need.id}&leftResumeId=${copyId}&rightResumeId=${second.resumeId}`,
    "GET",
    undefined,
    404,
  );
  const comparison = (
    await employer.request(
      `/employer/compare?needId=${need.id}&leftResumeId=${copyId}&rightResumeId=${second.resumeId}`,
    )
  ).data;
  assert.equal(comparison.left.resumeId, copyId);
  assert.equal(comparison.right.resumeId, second.resumeId);
  assert.ok(comparison.summary.length);
  assert.ok(
    !/oracles|correctAnswer|savedAnswer|contactEmail|phone/.test(
      JSON.stringify(comparison),
    ),
  );
  passed.push(
    "shared proof dates, whole-resume filters/dedup, explicit selected matching/explanation/comparison and foreign owner protection",
  );
  const body = inviteBody(need.id, candidate),
    created = (
      await employer.request("/employer/invitations", "POST", body, 201, {
        "Idempotency-Key": "intent-one",
      })
    ).data;
  const repeated = (
    await employer.request("/employer/invitations", "POST", body, 200, {
      "Idempotency-Key": "intent-one",
    })
  ).data;
  assert.equal(repeated.id, created.id);
  await employer.request(
    "/employer/invitations",
    "POST",
    { ...body, title: "Different intent" },
    409,
    { "Idempotency-Key": "intent-one" },
  );
  const duplicate = (
    await employer.request(
      "/employer/invitations",
      "POST",
      { ...body, resumeId: copyId },
      200,
      { "Idempotency-Key": "intent-copy" },
    )
  ).data;
  assert.equal(duplicate.id, created.id);
  assert.equal(duplicate.resumeId, candidate.resumeId);
  await candidate.request(`/me/invitations/${created.id}/decision`, "POST", {
    decision: "accept",
  });
  assert.ok(
    (await employer.request(`/employer/invitations/${created.id}/contacts`))
      .data.email,
  );
  await candidate.request(`/me/resumes/${candidate.resumeId}`, "PATCH", {
    visibility: "private",
  });
  await employer.request(
    `/employer/invitations/${created.id}/contacts`,
    "GET",
    undefined,
    403,
  );
  assert.equal(
    (await employer.request("/employer/invitations")).data.find(
      (row: any) => row.id === created.id,
    ).resumeSnapshot,
    null,
  );
  await employer.request(
    `/employer/candidates/${candidate.resumeId}`,
    "GET",
    undefined,
    404,
  );
  await employer.request(
    `/employer/compare?needId=${need.id}&leftResumeId=${candidate.resumeId}&rightResumeId=${second.resumeId}`,
    "GET",
    undefined,
    404,
  );
  passed.push(
    "idempotency body conflict, person-level duplicates across resume IDs, exact snapshot and hidden resume/contact history protection",
  );
  const secondInvite = (
    await employer.request(
      "/employer/invitations",
      "POST",
      inviteBody(need.id, second),
      201,
      { "Idempotency-Key": "second-offer" },
    )
  ).data;
  await employer.request(
    `/employer/invitations/${secondInvite.id}/withdraw`,
    "POST",
  );
  const otherNeed = (
    await employer.request(
      "/employer/needs",
      "POST",
      { ...needBody, title: "Another need" },
      201,
    )
  ).data;
  const cooldown = (
    await employer.request(
      "/employer/invitations",
      "POST",
      inviteBody(otherNeed.id, second),
      429,
      { "Idempotency-Key": "other-need" },
    )
  ).data;
  assert.equal(cooldown.code, "CANDIDATE_CONTACT_COOLDOWN");
  assert.ok(cooldown.retryAt);
  await db
    .update(invitations)
    .set({ updatedAt: new Date(Date.now() - 8 * 86400000) })
    .where(eq(invitations.id, secondInvite.id));
  await employer.request(
    "/employer/invitations",
    "POST",
    inviteBody(otherNeed.id, second),
    201,
    { "Idempotency-Key": "after-cooldown" },
  );
  passed.push(
    "closed-offer person/company cooldown across needs, elapsed-window reopening",
  );
  const quotaEmployer = await fixture("employer", 3),
    quotaNeed = (
      await quotaEmployer.request("/employer/needs", "POST", needBody, 201)
    ).data;
  const quotaCandidates = [];
  for (let i = 3; i < 28; i++)
    quotaCandidates.push(await fixture("candidate", i));
  const recent = new Date(Date.now() - 60000);
  await db.insert(invitations).values(
    quotaCandidates.slice(0, 18).map((actor) => ({
      ...inviteBody(quotaNeed.id, actor),
      candidateUserId: actor.user.id,
      companyId: quotaEmployer.companyId!,
      createdAt: recent,
      updatedAt: recent,
      status: "sent" as const,
    })),
  );
  const burst = await Promise.all(
    quotaCandidates
      .slice(18, 23)
      .map((actor, index) =>
        quotaEmployer.request(
          "/employer/invitations",
          "POST",
          inviteBody(quotaNeed.id, actor),
          [201, 429],
          { "Idempotency-Key": `burst-${index}` },
        ),
      ),
  );
  assert.equal(burst.filter((row) => row.status === 201).length, 2);
  assert.equal(
    burst.filter(
      (row) => row.status === 429 && row.data.code === "INVITATION_QUOTA",
    ).length,
    3,
  );
  const count = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(eq(invitations.companyId, quotaEmployer.companyId!));
  assert.equal(count.length, 20);
  const receiptCount = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(eq(receipts.companyId, quotaEmployer.companyId!));
  assert.equal(receiptCount.length, 2);
  const winning = burst.find((row) => row.status === 201)!;
  const winnerIndex = burst.indexOf(winning),
    winner = quotaCandidates[18 + winnerIndex]!;
  await quotaEmployer.request(
    "/employer/invitations",
    "POST",
    inviteBody(quotaNeed.id, winner),
    200,
    { "Idempotency-Key": `burst-${winnerIndex}` },
  );
  await quotaEmployer.request(
    "/employer/invitations",
    "POST",
    {
      ...inviteBody(quotaNeed.id, quotaCandidates[23]!),
      candidateId: candidate.user.id,
    },
    404,
    { "Idempotency-Key": "foreign-resume" },
  );
  assert.equal(
    (
      await db
        .select({ id: receipts.id })
        .from(receipts)
        .where(eq(receipts.companyId, quotaEmployer.companyId!))
    ).length,
    2,
  );
  passed.push(
    "atomic rolling quota under five concurrent sends at 18/20, retry without charge, rejected ownership without receipt",
  );
  await db
    .update(invitations)
    .set({ createdAt: new Date(Date.now() - 25 * 3600000) })
    .where(eq(invitations.companyId, quotaEmployer.companyId!));
  await quotaEmployer.request(
    "/employer/invitations",
    "POST",
    inviteBody(quotaNeed.id, quotaCandidates[23]!),
    201,
    { "Idempotency-Key": "window-ended" },
  );
  passed.push(
    "rolling 24-hour quota resets only by elapsed time, not closing an offer",
  );
  await mkdir("outputs/verification/multi-resume", { recursive: true });
  await writeFile(
    "outputs/verification/multi-resume/catalog-http.json",
    JSON.stringify(
      {
        status: "PASS",
        synthetic: true,
        startedAt,
        finishedAt: new Date().toISOString(),
        apiOrigin,
        passed,
        tests: passed.length,
        oldArtifactsUnmodified: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${passed.length} substantive catalogue/matching/invitation HTTP groups`,
  );
} finally {
  if (ownedIds.length)
    await db.delete(users).where(inArray(users.id, ownedIds));
  await pool.end();
}
