/** Explicit synthetic fixture for local browser QA; never a claimed registration or human pilot. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db, pool, signalUsersTable as users } from "../lib/db/src/index";
import { hashPassword } from "../artifacts/api-server/src/lib/signal-auth";
import { emptyResume } from "../artifacts/api-server/src/lib/signal-resume-contract";

const origin = process.env.BROWSER_QA_ORIGIN ?? "http://127.0.0.1:4310";
for (const url of [origin, process.env.DATABASE_URL ?? ""]) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname), "Only local services are allowed");
let pending: any = null;
try { pending = JSON.parse(await readFile("outputs/local-backup/browser-qa.json", "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
assert.ok(!pending?.setupCompletedAt && !pending?.cleanedAt, "An existing completed fixture must not be overwritten");
const fixtureId = pending?.fixtureId ?? `browser-qa-${randomUUID()}`;
const email = pending?.candidate.email ?? `${fixtureId}@example.test`;
const password = pending?.candidate.password ?? randomUUID();
assert.match(fixtureId, /^browser-qa-[0-9a-f-]{36}$/);
assert.equal(email, `${fixtureId}@example.test`);
let cookie = "";
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}/api${path}`, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const session = response.headers.getSetCookie().find(value => value.startsWith("fsp_signal_session="));
  if (session) cookie = session.split(";")[0]!;
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${data?.error ?? ""}`);
  return data;
}
await mkdir("outputs/local-backup", { recursive: true });
try {
  const [user] = pending ? await db.select().from(users).where(and(eq(users.id, pending.candidate.id), eq(users.email, email), eq(users.demoMode, false))) : await db.insert(users).values({ email, passwordHash: await hashPassword(password), role: "candidate", displayName: "Мария Соколова", emailVerified: true, demoMode: false }).returning();
  assert.ok(user);
  // Keep cleanup metadata immediately, even if later profile setup fails.
  const metadata = pending ?? { fixtureId, origin, provenance: "Locally seeded verified synthetic candidate for browser QA. Registration is covered separately. Not a real person or human validation participant.", candidate: { id: user.id, email, password, displayName: user.displayName, specialization: "Frontend / TypeScript" }, createdAt: new Date().toISOString(), cleanup: "node --env-file-if-exists=.env --import tsx scripts/cleanup-browser-assessment-fixture.ts" };
  if (!pending) await writeFile("outputs/local-backup/browser-qa.json", JSON.stringify(metadata, null, 2), { flag: "wx" });
  await api("/auth/login", "POST", { email, password });
  assert.equal((await api("/assessments/history")).attempts.length, 0, "Do not change a fixture once browser assessment has begun");
  await api("/me/candidate-profile", "PUT", { displayName: "Мария Соколова", professionalAlias: "Interface Engineer", specialization: "Frontend / TypeScript", assumedGrade: "Middle", stack: ["TypeScript"], skills: ["Accessibility", "Frontend state"], yearsExperience: 3, workFormat: "Удалённо", salaryMin: 150000, salaryMax: 220000, salaryPeriod: "month", salaryType: "gross", visibility: "pseudonymous", consentMatching: true, phone: null, contactEmail: email });
  const resume = emptyResume("Frontend / TypeScript");
  resume.summary = "Разрабатываю интерфейсы на TypeScript. Работаю с состоянием приложения, доступностью и производительностью. Хочу развивать сложные пользовательские сценарии.";
  resume.experience = [{ company: "Студия интерфейсов", role: "Frontend-разработчик", start: "2023-06", end: null, description: "Разработка клиентских форм и каталогов, настройка обработки ошибок и клавиатурной навигации." }];
  resume.projects = [{ title: "Личный кабинет", role: "Frontend-разработчик", description: "Формы с валидацией, сохранение черновиков и доступная навигация.", url: null }];
  resume.softSkills = ["Работа в команде", "Обратная связь"];
  resume.questionnaire.industry = "Информационные технологии";
  for (const key of Object.keys(resume.questionnaire.answers)) (resume.questionnaire.answers as Record<string, number | null>)[key] = 2;
  const saved = await api("/me/resume", "PUT", resume);
  assert.equal(saved.recommendation.grade, "Middle");
  assert.equal((await api("/assessments/history")).attempts.length, 0);
  await writeFile("outputs/local-backup/browser-qa.json", JSON.stringify({ ...metadata, setupCompletedAt: new Date().toISOString() }, null, 2));
  console.log("Synthetic browser candidate ready. Credentials only in outputs/local-backup/browser-qa.json. No assessment created.");
} finally { await pool.end(); }
