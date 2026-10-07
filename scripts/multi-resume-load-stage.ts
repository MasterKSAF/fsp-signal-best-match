/** Guarded native-stage load: 5,000 people, 1 -> 5 resumes, one immutable attempt/person. Never defaults to live DB. */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  signalUsersTable as users,
  signalSessionsTable as sessions,
  signalCandidateProfilesTable as profiles,
  signalCompaniesTable as companies,
  signalNeedsTable as needs,
  signalCandidateResumesTable as resumes,
  signalAssessmentAttemptsTable as attempts,
} from "../lib/db/src/index";
import {
  assembleManagedAttempt,
  programSpecialization,
  verifiedSkillsForAttempt,
} from "../artifacts/api-server/src/lib/assessment-managed";
import {
  assessmentBankVersion,
  scoreAttempt,
} from "../artifacts/api-server/src/lib/assessment-bank";
import { emptyResume } from "../artifacts/api-server/src/lib/signal-resume-contract";
import { validatedLoadTarget } from "./multi-resume-load-target";
import { profileOwnedResumePool } from "./profile-multi-resume-pool";
const target = validatedLoadTarget(process.env);
const base = process.env.LOAD_API_ORIGIN!,
  origin = process.env.INTEGRATION_APP_ORIGIN!;
const appPid = Number(process.env.SIGNAL_LOAD_APP_PID);
assert.ok(
  Number.isSafeInteger(appPid) && appPid > 0,
  "Explicit stage API PID required",
);
const pwsh = "C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe",
  run = promisify(execFile);
const id = randomBytes(6).toString("hex"),
  prefix = `LOAD-${id}`,
  ownedIds: number[] = [],
  startedAt = new Date().toISOString();
const diagnostic = process.argv.includes("--diagnostic");
const fixture = {
  version: "multi-resume-native-stage-v1",
  seed: "signal-multi-resume-scale-2026-10-06",
  people: 5000,
  baselineResumes: 1,
  expandedResumes: 5,
  immutableAttemptsPerPerson: 1,
  sessions: 32,
  candidateSessions: 16,
  employerSessions: 16,
  warmupSeconds: 30,
  measuredSeconds: 180,
  thinkMs: 100,
  timeoutMs: 10000,
};
const limits = {
  jsonP95Ms: 1500,
  pdfP95Ms: 2000,
  p99Ms: 5000,
  errors: 0,
  minRequestsPerRoute: 50,
  maxAppMemoryBytes: 1024 * 1024 * 1024,
  minimumValidTelemetrySamples: 12,
};
const out = "outputs/verification/multi-resume",
  privateManifest = "outputs/local-backup/multi-resume-load-owned.json";
const runManifest = `outputs/local-backup/multi-resume-load-owned-${target.key}-${id}.json`;
await mkdir(out, { recursive: true });
await mkdir("outputs/local-backup", { recursive: true });
const sourceFiles = [
  "artifacts/api-server/src/lib/signal-resume-matching.ts",
  "artifacts/api-server/src/lib/signal-matching.ts",
  "artifacts/api-server/src/lib/signal-resume-catalog.ts",
  "artifacts/api-server/src/lib/assessment-ranking-evidence.ts",
  "artifacts/api-server/src/lib/signal-resume-qualification.ts",
  "artifacts/api-server/src/lib/signal-resume.ts",
  "artifacts/api-server/src/lib/assessment-bank.ts",
  "artifacts/api-server/src/lib/assessment-managed.ts",
  "artifacts/api-server/src/routes/signal-employer-matching.ts",
  "artifacts/api-server/src/routes/signal-candidate-bank.ts",
  "artifacts/api-server/src/lib/signal-catalog-computation.ts",
  "artifacts/api-server/src/lib/signal-readonly-resume.ts",
  "artifacts/api-server/src/lib/signal-fresh-pool-cache.ts",
  "artifacts/api-server/src/lib/signal-fresh-ranking-cache.ts",
  "artifacts/api-server/src/lib/signal-resume-evaluation.ts",
];
async function runtimeIdentity() {
  if(!process.env.SIGNAL_LOAD_RUNTIME_MANIFEST)return null;
  const frozen=JSON.parse(await readFile(process.env.SIGNAL_LOAD_RUNTIME_MANIFEST,'utf8'));
  return {runtimeKind:frozen.runtimeKind??'historical-custom-diagnostic',apiBundleSha256:frozen.apiSha256,candidateManifestSha256:frozen.candidateManifestSha256??null,deliveryFiles:frozen.deliveryFiles??null};
}
async function sourceHashes() {
  if (process.env.SIGNAL_LOAD_RUNTIME_MANIFEST) {
    const frozen = JSON.parse(
      await readFile(process.env.SIGNAL_LOAD_RUNTIME_MANIFEST, "utf8"),
    );
    if(!diagnostic)assert.equal(frozen.runtimeKind,'normal-delivery','Full acceptance requires the exact normal delivery bundle');
    assert.equal(
      createHash("sha256")
        .update(await readFile(frozen.apiPath))
        .digest("hex"),
      frozen.apiSha256,
      "Measured API bundle identity changed",
    );
    assert.ok(
      sourceFiles.every(
        (file) => typeof frozen.sourceHashes[file] === "string",
      ),
    );
    return frozen.sourceHashes;
  }
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (f) => [
        f,
        createHash("sha256")
          .update(await readFile(f))
          .digest("hex"),
      ]),
    ),
  );
}
async function telemetry() {
  const { stdout } = await run(
    pwsh,
    [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${appPid} | Select-Object Id,StartTime,WorkingSet64,@{n='cpuSeconds';e={$_.TotalProcessorTime.TotalSeconds}} | ConvertTo-Json -Compress`,
    ],
    { timeout: 10000 },
  );
  return { at: new Date().toISOString(), ...JSON.parse(stdout.trim()) };
}
async function fetchApi(path: string, cookie: string) {
  return fetch(`${base}/api${path}`, {
    headers: { Origin: origin, Cookie: cookie },
    signal: AbortSignal.timeout(fixture.timeoutMs),
  });
}
type Actor = {
  id: number;
  resumeId?: number;
  companyId?: number;
  needId?: number;
  cookie: string;
};
type Worker = { routes: { label: string; path: string }[]; cookie: string };
const actors: Actor[] = [],
  workers: Worker[] = [],
  baselineRows: Array<typeof resumes.$inferSelect> = [];
const forms = new Map<string, ReturnType<typeof assembleManagedAttempt>>();
for (const program of ["backend-python", "frontend-typescript"])
  for (const grade of ["Junior", "Middle", "Senior"] as const)
    forms.set(
      `${program}/${grade}`,
      assembleManagedAttempt(
        program,
        grade,
        `${fixture.seed}:${program}:${grade}`,
        {
          contextId:
            program === "backend-python" ? "api-platform" : "frontend-product",
        },
      ),
    );
async function makeSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    userId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 3600000),
    demoMode: false,
  });
  return `fsp_signal_session=${token}`;
}
async function ownedSnapshot() {
  const rows = await db
    .select({
      id: resumes.id,
      userId: resumes.userId,
      grade: resumes.verifiedGrade,
      score: resumes.verifiedScore,
      skills: resumes.verifiedSkills,
      primary: resumes.isPrimary,
      revision: resumes.revision,
      visibility: resumes.visibility,
      matching: resumes.consentMatching,
      catalog: resumes.consentCatalog,
      at: resumes.latestAssessmentAt,
    })
    .from(resumes)
    .where(inArray(resumes.userId, ownedIds))
    .orderBy(resumes.id);
  const attemptRows = await db
    .select({
      id: attempts.id,
      userId: attempts.userId,
      program: attempts.programId,
      grade: attempts.grade,
      at: attempts.submittedAt,
    })
    .from(attempts)
    .where(inArray(attempts.userId, ownedIds))
    .orderBy(attempts.id);
  return {
    people: fixture.people,
    resumes: rows.length,
    attempts: attemptRows.length,
    sha256: createHash("sha256")
      .update(JSON.stringify({ rows, attemptRows }))
      .digest("hex"),
  };
}
function quantile(values: number[], q: number) {
  return (
    Math.round(
      values[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)]! *
        100,
    ) / 100
  );
}
async function phase(label: string) {
  const execution = {
    mode: diagnostic ? "diagnostic-not-acceptance" : "acceptance",
    warmupSeconds: diagnostic ? 5 : fixture.warmupSeconds,
    measuredSeconds: diagnostic ? 15 : fixture.measuredSeconds,
  };
  const metrics: Record<
    string,
    { times: number[]; errors: number; statuses: Record<string, number> }
  > = Object.fromEntries(
    ["catalogue", "matching", "explanation", "profile", "pdf"].map((name) => [
      name,
      { times: [], errors: 0, statuses: {} },
    ]),
  );
  const samples: any[] = [];
  let pending: Promise<void> | undefined;
  const take = () => {
    if (pending) return pending;
    pending = telemetry()
      .then((sample) => {
        samples.push(sample);
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  const runPeriod = async (seconds: number, record: boolean) => {
    const until = performance.now() + seconds * 1000;
    await Promise.all(
      workers.map(async (worker) => {
        let n = 0;
        while (performance.now() < until) {
          const route = worker.routes[n++ % worker.routes.length]!,
            at = performance.now();
          let status = "timeout";
          try {
            const response = await fetchApi(route.path, worker.cookie);
            status = String(response.status);
            await response.arrayBuffer();
          } catch {
            status = "network_error";
          }
          if (record) {
            const item = metrics[route.label]!;
            item.times.push(performance.now() - at);
            item.statuses[status] = (item.statuses[status] ?? 0) + 1;
            if (status !== "200") item.errors++;
          }
          await delay(fixture.thinkMs);
        }
      }),
    );
  };
  console.log(`${label}: ${execution.mode} warmup ${execution.warmupSeconds}s`);
  await runPeriod(execution.warmupSeconds, false);
  const before = await ownedSnapshot(),
    hashes = await sourceHashes();
  await take();
  const timer = setInterval(() => void take(), 5000);
  console.log(`${label}: measured ${execution.measuredSeconds}s`);
  const start = performance.now();
  try {
    await runPeriod(execution.measuredSeconds, true);
  } finally {
    clearInterval(timer);
    if (pending) await pending;
    await take();
  }
  const elapsedSeconds = (performance.now() - start) / 1000,
    after = await ownedSnapshot(),
    afterHashes = await sourceHashes();
  const results = Object.fromEntries(
    Object.entries(metrics).map(([route, item]) => {
      const values = item.times.sort((a, b) => a - b),
        p95Ms = quantile(values, 0.95),
        p99Ms = quantile(values, 0.99);
      return [
        route,
        {
          requests: values.length,
          errors: item.errors,
          statuses: item.statuses,
          p50Ms: quantile(values, 0.5),
          p95Ms,
          p99Ms,
          passed:
            values.length >= limits.minRequestsPerRoute &&
            item.errors === 0 &&
            p95Ms <= (route === "pdf" ? limits.pdfP95Ms : limits.jsonP95Ms) &&
            p99Ms <= limits.p99Ms,
          meetsStrictSmallFixture1000Ms:
            route === "pdf" ? p95Ms <= 2000 : p95Ms <= 1000,
        },
      ];
    }),
  );
  const peakAppMemoryBytes = Math.max(
    ...samples.map((s) => Number(s.WorkingSet64)),
  );
  const sourceStable = JSON.stringify(hashes) === JSON.stringify(afterHashes),
    datasetStable = before.sha256 === after.sha256;
  const telemetryStable =
    new Set(samples.map((s) => `${s.Id}/${s.StartTime}`)).size === 1;
  const firstSample = samples[0],
    lastSample = samples.at(-1);
  const telemetryElapsedSeconds =
    (Date.parse(lastSample.at) - Date.parse(firstSample.at)) / 1000;
  const cpuSecondsDelta =
    Number(lastSample.cpuSeconds) - Number(firstSample.cpuSeconds);
  const meanCpuCorePercent = (cpuSecondsDelta / telemetryElapsedSeconds) * 100;
  const report = {
    label,
    fixture,
    execution,
    limits,
    elapsedSeconds,
    totalRequests: Object.values(results).reduce(
      (total, row) => total + row.requests,
      0,
    ),
    results,
    before,
    after,
    datasetStable,
    sourceStable,
    sourceHashes: hashes,
    telemetryMethod:
      "native Windows process working set/CPU seconds; not Docker cgroup/image telemetry",
    samples,
    runtimeManifest: process.env.SIGNAL_LOAD_RUNTIME_MANIFEST ?? null,
    runtimeIdentity:await runtimeIdentity(),
    peakAppMemoryBytes,
    telemetryStable,
    cpu: {
      cpuSecondsDelta,
      telemetryElapsedSeconds,
      meanCpuCorePercent,
      hostNormalizedPercent: meanCpuCorePercent / os.cpus().length,
      logicalCpus: os.cpus().length,
      note: "100% core usage equals one logical CPU; host-normalized percentage divides by logical CPU count. No new CPU SLA is introduced.",
    },
    passed:
      Object.values(results).every((row) => row.passed) &&
      datasetStable &&
      sourceStable &&
      samples.length >= limits.minimumValidTelemetrySamples &&
      telemetryStable &&
      peakAppMemoryBytes <= limits.maxAppMemoryBytes,
  };
  await writeFile(`${out}/load-${label}.json`, JSON.stringify(report, null, 2));
  await writeFile(
    `${out}/load-${id}-${label}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      phase: label,
      passed: report.passed,
      totalRequests: report.totalRequests,
      peakAppMemoryBytes,
      results,
    }),
  );
  return report;
}
async function functionalSample(employer: Actor) {
  const pages = [];
  for (const page of [1, 2, 3]) {
    const r = await fetchApi(
      `/employer/candidates?q=${prefix}&page=${page}`,
      employer.cookie,
    );
    assert.equal(r.status, 200);
    pages.push(await r.json());
  }
  assert.ok(pages.every((page) => page.total === fixture.people));
  const listed = pages.flatMap((page) =>
    page.candidates.map((row: any) => row.candidateId),
  );
  assert.equal(new Set(listed).size, listed.length);
  assert.ok(pages.every((page) => page.candidates.length === 24));
  const r = await fetchApi(
    `/matches?needId=${employer.needId}`,
    employer.cookie,
  );
  assert.equal(r.status, 200);
  const matched = await r.json();
  assert.equal(
    new Set(matched.map((row: any) => row.candidateId)).size,
    matched.length,
  );
  const own = new Set(ownedIds),
    matching = matched.filter((row: any) => own.has(row.candidateId));
  assert.ok(
    matching.length >= 1000,
    "At least 1,000 actual admitted fixture people required; an empty matching pool cannot pass",
  );
  const advanced = new URLSearchParams({
    q: prefix,
    specialization: "Backend / Python",
    grade: "Middle",
    skills: "Python,SQL",
    experienceMin: "0",
    workFormat: "Удалённо",
    salaryMin: "180000",
    salaryMax: "220000",
    salaryPeriod: "month",
    salaryType: "gross",
    hasPhoto: "no",
    readyForOffers: "yes",
    checkedWithinDays: "30",
  });
  const advancedResponse = await fetchApi(
    `/employer/candidates?${advanced}`,
    employer.cookie,
  );
  assert.equal(advancedResponse.status, 200);
  const advancedPage = await advancedResponse.json();
  const expectedAdvancedPeople = baselineRows.filter(
    (row) =>
      row.specialization === "Backend / Python" &&
      row.verifiedGrade === "Middle" &&
      row.verifiedSkills.includes("Python") &&
      row.verifiedSkills.includes("SQL"),
  ).length;
  assert.ok(expectedAdvancedPeople >= 1000);
  assert.equal(advancedPage.total, expectedAdvancedPeople);
  assert.equal(advancedPage.candidates.length, 24);
  assert.equal(
    new Set(advancedPage.candidates.map((row: any) => row.candidateId)).size,
    24,
  );
  const noHiddenAnswerKeys =
    !/(correctAnswer|oracles|savedAnswer|passwordHash)/.test(
      JSON.stringify([...pages, advancedPage]),
    );
  assert.ok(noHiddenAnswerKeys);
  return {
    catalogueTotal: pages[0].total,
    pageUniquePeople: listed.length,
    matchingPeople: matching.length,
    matchingOrderDigest: createHash("sha256")
      .update(
        JSON.stringify(
          matching.map((row: any) => [
            row.candidateId,
            row.resumeId,
            row.score,
            row.ranking?.businessFitScore,
            row.ranking?.groupId,
          ]),
        ),
      )
      .digest("hex"),
    firstPagesDigest: createHash("sha256")
      .update(JSON.stringify(listed))
      .digest("hex"),
    advancedFilters: {
      expectedPeople: expectedAdvancedPeople,
      actualPeople: advancedPage.total,
      uniqueFirstPage: 24,
      salaryPeriod: "month",
      salaryType: "gross",
      verifiedSkillsOnly: true,
    },
    noHiddenAnswerKeys,
    matchingNoDuplicatePeople: true,
  };
}
let report: any;
try {
  const at = new Date("2026-10-05T20:00:00Z");
  for (let offset = 0; offset < fixture.people; offset += 100) {
    const batch = await db
      .insert(users)
      .values(
        Array.from(
          { length: Math.min(100, fixture.people - offset) },
          (_, k) => ({
            email: `multi-load-${id}-${offset + k}@example.test`,
            passwordHash: "unusable-synthetic-load-account",
            role: "candidate" as const,
            displayName: `Synthetic load ${offset + k}`,
            emailVerified: true,
            demoMode: false,
          }),
        ),
      )
      .returning();
    ownedIds.push(...batch.map((user) => user.id));
    await writeFile(
      privateManifest,
      JSON.stringify(
        {
          id,
          database: target.database,
          profile: target.key,
          createdUserIds: ownedIds,
          cleanup: "pending",
        },
        null,
        2,
      ),
    );
    const professional = batch.map((user, k) => {
      const n = offset + k,
        program = n % 4 === 0 ? "frontend-typescript" : "backend-python",
        grade = n % 10 === 9 ? "Junior" : n % 10 >= 7 ? "Senior" : "Middle";
      const form = forms.get(`${program}/${grade}`)!,
        answers = form.cases.map((item) => ({
          caseId: item.id,
          answer: form.oracles[item.id]!.answer,
        })),
        result = scoreAttempt(form.cases, form.oracles, answers);
      assert.equal(result.score, 100);
      return {
        user,
        n,
        program,
        grade: grade as "Junior" | "Middle" | "Senior",
        form,
        answers,
        result,
        skills: verifiedSkillsForAttempt(
          form.cases,
          form.oracles,
          result.evidence,
        ),
      };
    });
    await db.insert(profiles).values(
      professional.map((row) => ({
        userId: row.user.id,
        professionalAlias: `${prefix} ${String(row.n).padStart(5, "0")}`,
        specialization: programSpecialization(row.program)!,
        assumedGrade: row.grade,
        verifiedGrade: row.grade,
        verifiedScore: 100,
        verifiedSkills: row.skills,
        stack: row.skills,
        skills: row.skills,
        yearsExperience: row.n % 9,
        workFormat: "Удалённо",
        salaryMin: 160000,
        salaryMax: 240000,
        salaryPeriod: "month" as const,
        salaryType: "gross" as const,
        consentMatching: true,
        visibility: "pseudonymous" as const,
        latestAssessmentAt: at,
        contactEmail: row.user.email,
      })),
    );
    const created = await db
      .insert(resumes)
      .values(
        professional.map((row) => ({
          ...emptyResume(programSpecialization(row.program)!),
          userId: row.user.id,
          title: `Synthetic ${row.program}`,
          isPrimary: true,
          specialization: programSpecialization(row.program)!,
          assumedGrade: row.grade,
          verifiedGrade: row.grade,
          verifiedScore: 100,
          verifiedSkills: row.skills,
          stack: row.skills,
          skills: row.skills,
          yearsExperience: row.n % 9,
          workFormat: "Удалённо",
          salaryMin: 160000,
          salaryMax: 240000,
          salaryPeriod: "month" as const,
          salaryType: "gross" as const,
          consentMatching: true,
          consentCatalog: true,
          visibility: "pseudonymous" as const,
          readyForOffers: true,
          latestAssessmentAt: at,
        })),
      )
      .returning();
    baselineRows.push(...created);
    const resumeByUser = new Map(created.map((row) => [row.userId, row]));
    await db.insert(attempts).values(
      professional.map((row) => ({
        userId: row.user.id,
        resumeId: resumeByUser.get(row.user.id)!.id,
        resumeSpecialization: programSpecialization(row.program)!,
        programVersion: assessmentBankVersion(row.form.cases, row.form.oracles),
        programId: row.program,
        grade: row.grade,
        status: "submitted" as const,
        cases: row.form.cases,
        oracles: row.form.oracles,
        answers: row.answers,
        score: 100,
        verified: true,
        startedAt: new Date(at.getTime() - 60000),
        dueAt: new Date(at.getTime() + 60000),
        submittedAt: at,
      })),
    );
    await db
      .update(resumes)
      .set({ qualificationAttemptId: sql`${attempts.id}` })
      .from(attempts)
      .where(
        and(
          eq(resumes.id, attempts.resumeId),
          inArray(
            resumes.id,
            created.map((row) => row.id),
          ),
        ),
      );
    for (const row of created)
      if (actors.length < fixture.candidateSessions)
        actors.push({
          id: row.userId,
          resumeId: row.id,
          cookie: await makeSession(row.userId),
        });
    if (offset % 1000 === 0)
      console.log(
        `Prepared ${offset + batch.length}/${fixture.people} synthetic people`,
      );
  }
  for (let index = 0; index < fixture.employerSessions; index++) {
    const [user] = await db
      .insert(users)
      .values({
        email: `multi-load-${id}-employer-${index}@example.test`,
        passwordHash: "unusable-synthetic-load-account",
        role: "employer",
        displayName: "Synthetic load employer",
        emailVerified: true,
        demoMode: false,
      })
      .returning();
    ownedIds.push(user.id);
    await writeFile(
      privateManifest,
      JSON.stringify(
        {
          id,
          database: target.database,
          profile: target.key,
          createdUserIds: ownedIds,
          cleanup: "pending",
        },
        null,
        2,
      ),
    );
    const [company] = await db
      .insert(companies)
      .values({
        ownerUserId: user.id,
        name: `Synthetic ${prefix}`,
        contactEmail: user.email,
      })
      .returning();
    const [need] = await db
      .insert(needs)
      .values({
        companyId: company.id,
        title: "Synthetic backend load need",
        specialization: "Backend / Python",
        grade: "Middle",
        requiredSkills: ["Python", "SQL"],
        desirableSkills: ["API contracts"],
        description: "Synthetic scale scenario, not a human pilot",
        workFormat: "Удалённо",
        salaryMin: 150000,
        salaryMax: 250000,
        salaryPeriod: "month",
        salaryType: "gross",
      })
      .returning();
    actors.push({
      id: user.id,
      companyId: company.id,
      needId: need.id,
      cookie: await makeSession(user.id),
    });
  }
  for (const actor of actors) {
    if (actor.resumeId)
      workers.push({
        cookie: actor.cookie,
        routes: [
          {
            label: "profile",
            path: `/me/candidate-profile?resumeId=${actor.resumeId}`,
          },
          { label: "pdf", path: `/me/resumes/${actor.resumeId}/pdf` },
          {
            label: "profile",
            path: `/me/candidate-profile?resumeId=${actor.resumeId}`,
          },
        ],
      });
    else {
      const target = baselineRows.find(
        (row) =>
          row.specialization === "Backend / Python" &&
          row.verifiedGrade === "Middle",
      )!;
      workers.push({
        cookie: actor.cookie,
        routes: [
          { label: "catalogue", path: `/employer/candidates?q=${prefix}` },
          { label: "matching", path: `/matches?needId=${actor.needId}` },
          {
            label: "explanation",
            path: `/matches/explanation?needId=${actor.needId}&candidateId=${target.userId}&resumeId=${target.id}`,
          },
        ],
      });
    }
  }
  const employer = actors.find((actor) => actor.needId)!;
  const baselineFunctional = await functionalSample(employer);
  if (process.argv.includes('--profile-pool')) {
    assert.ok(diagnostic, 'Serial profiling never alters acceptance execution');
    await profileOwnedResumePool('baseline-one-resume', id);
  }
  const baseline = await phase("baseline-one-resume");
  report = {
    status: "RUNNING",
    synthetic: true,
    startedAt,
    fixture,
    limits,
    baselineFunctional,
    baseline,
  };
  if (diagnostic && process.argv.includes("--baseline-only")) {
    report.status = "DIAGNOSTIC";
    report.executionMode = "diagnostic-baseline-only-not-acceptance";
    report.target = target;
    throw Object.assign(new Error("Baseline-only diagnostic complete"), {
      diagnosticComplete: true,
    });
  }
  if (
    diagnostic &&
    Object.values(baseline.results).every(
      (result) => result.errors === result.requests,
    )
  )
    throw new Error(
      "Diagnostic baseline: every route failed; expanded load not started.",
    );
  console.log(
    "Adding four resumes/person, preserving one original attempt/date and primary ID",
  );
  for (let offset = 0; offset < baselineRows.length; offset += 100) {
    const originals = baselineRows.slice(offset, offset + 100);
    await db.insert(resumes).values(
      originals.flatMap((original) =>
        Array.from({ length: 4 }, (_, copy) => {
          const {
            id: _id,
            createdAt: _created,
            updatedAt: _updated,
            ...fields
          } = original;
          return {
            ...fields,
            isPrimary: false,
            revision: 1,
            title: `${original.title} alternative ${copy + 1}`,
          };
        }),
      ),
    );
  }
  const expandedFunctional = await functionalSample(employer);
  assert.equal(
    expandedFunctional.catalogueTotal,
    baselineFunctional.catalogueTotal,
  );
  assert.equal(
    expandedFunctional.firstPagesDigest,
    baselineFunctional.firstPagesDigest,
  );
  assert.equal(
    expandedFunctional.matchingOrderDigest,
    baselineFunctional.matchingOrderDigest,
  );
  if (process.argv.includes('--profile-pool')) await profileOwnedResumePool('expanded-five-resumes', id);
  const expanded = await phase("expanded-five-resumes");
  assert.equal(expanded.before.attempts, baseline.before.attempts);
  assert.equal(expanded.before.resumes, fixture.people * 5);
  report = {
    status: diagnostic
      ? "DIAGNOSTIC"
      : baseline.passed && expanded.passed
        ? "PASS"
        : "FAIL",
    scope:
      "Controlled native-stage HTTP load, not production capacity or official FSP score",
    synthetic: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    apiOrigin: base,
    target,
    fixture,
    executionMode: diagnostic ? "diagnostic-not-acceptance" : "acceptance",
    runtimeIdentity:await runtimeIdentity(),
    limits,
    limitsSource:
      "scripts/load-scale.ts (same 1500/2000/5000 ms and sample/memory thresholds); stricter 1000ms small-load criterion also reported",
    machine: {
      platform: os.platform(),
      cpus: os.cpus().length,
      memoryBytes: os.totalmem(),
      node: process.version,
    },
    fixtureHash: createHash("sha256")
      .update(JSON.stringify(fixture))
      .digest("hex"),
    scriptHash: createHash("sha256")
      .update(await readFile("scripts/multi-resume-load-stage.ts"))
      .digest("hex"),
    baselineFunctional,
    expandedFunctional,
    baseline,
    expanded,
    oldSealedArtifactsUnmodified: true,
  };
} catch (error) {
  const diagnosticComplete = Boolean(
    (error as { diagnosticComplete?: boolean }).diagnosticComplete,
  );
  report = {
    ...(report ?? {}),
    status: diagnosticComplete ? "DIAGNOSTIC" : "FAIL",
    synthetic: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    failure:
      error instanceof Error
        ? ((error as Error & { cause?: { message?: string } }).cause?.message ??
          error.message.split("\n")[0]!.slice(0, 500))
        : String(error),
    fixture,
    limits,
  };
  if (!diagnosticComplete) process.exitCode = 1;
} finally {
  // Persist measurement before cleanup, so a drain/recovery error cannot erase it.
  if (report)
    await writeFile(
      `${out}/load-comparison-${id}.json`,
      JSON.stringify(report, null, 2),
    );
  let cleanupError: string | null = null;
  try {
    for (let offset = 0; offset < ownedIds.length; offset += 100)
      await db
        .delete(users)
        .where(inArray(users.id, ownedIds.slice(offset, offset + 100)));
  } catch (error) {
    cleanupError =
      (error as { cause?: { message?: string } }).cause?.message ??
      "Owned cleanup needs API drain/recovery";
    process.exitCode = 1;
  }
  const remaining = ownedIds.length
    ? (
        await db
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, ownedIds))
      ).length
    : 0;
  await writeFile(
    privateManifest,
    JSON.stringify(
      {
        id,
        database: target.database,
        profile: target.key,
        createdUserIds: ownedIds,
        cleanup: remaining === 0 ? "complete" : "pending-recovery",
        remaining,
      },
      null,
      2,
    ),
  );
  await writeFile(runManifest, await readFile(privateManifest));
  if (report) {
    report.cleanup = {
      createdUsers: ownedIds.length,
      remainingUsers: remaining,
      ownerOnly: true,
      status: remaining === 0 ? "complete" : "pending-recovery",
      error: cleanupError,
    };
    await writeFile(
      `${out}/load-comparison.json`,
      JSON.stringify(report, null, 2),
    );
    await writeFile(
      `${out}/load-comparison-${id}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        status: report.status,
        cleanup: report.cleanup,
        failure: report.failure ?? null,
      }),
    );
    if ((!diagnostic && report.status !== "PASS") || remaining !== 0)
      process.exitCode = 1;
  }
  await pool.end();
}
