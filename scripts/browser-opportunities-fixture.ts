/** Minimal, explicitly synthetic ordinary-account setup for local UI recording.
 * Does not accept invitations/applications/tasks or grade any candidate answer.
 * Credentials stay only in outputs/local-backup; exact captured IDs own cleanup.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db, pool, signalUsersTable as users } from "../lib/db/src/index";

const filename = "outputs/local-backup/browser-qa.json";
let fixture = JSON.parse(await readFile(filename, "utf8"));
const origin = fixture.origin as string;
for (const url of [origin, process.env.DATABASE_URL ?? ""])
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
assert.match(fixture.fixtureId, /^browser-qa-[0-9a-f-]{36}$/);
assert.equal(fixture.candidate.email, `${fixture.fixtureId}@example.test`);
assert.ok(fixture.setupCompletedAt && !fixture.cleanedAt);
const save = async () => {
  // Re-read candidate metadata so a later independent candidate update survives.
  const latest = JSON.parse(await readFile(filename, "utf8"));
  fixture = { ...latest, employer: fixture.employer, opportunities: fixture.opportunities };
  await writeFile(filename, JSON.stringify(fixture, null, 2));
};
class Client {
  cookie = "";
  async api(path: string, method = "GET", body?: unknown) {
    const r = await fetch(`${origin}/api${path}`, {
      method,
      headers: { Origin: origin, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const set = r.headers.getSetCookie().find(value => value.startsWith("fsp_signal_session="));
    if (set) this.cookie = set.split(";")[0]!;
    const data: any = await r.json();
    assert.ok(r.ok, `${method} ${path}: ${r.status} ${data?.error || ""}`);
    return data;
  }
}
const employer = new Client(), candidate = new Client();
const role = {
  title: "Frontend-разработчик продукта", specialization: "Frontend / TypeScript", grade: "Middle",
  description: "Создаём личный кабинет для планирования командной работы. Развиваем доступные формы и понятные состояния интерфейса. Нужны уверенный TypeScript, внимание к деталям и умение обсуждать решения с командой.",
  workFormat: "Удалённо", salaryMin: 150000, salaryMax: 220000, salaryPeriod: "month", salaryType: "gross",
};
try {
  if (!fixture.employer) {
    const email = `${fixture.fixtureId}-employer@example.test`, password = `Signal-${randomUUID()}`;
    const result = await employer.api("/auth/register", "POST", { email, password, displayName: "Анна Волкова", role: "employer", consentTerms: true, consentPrivacy: true });
    const [user] = await db.select().from(users).where(and(eq(users.email, email), eq(users.demoMode, false)));
    assert.ok(user);
    fixture.employer = { id: user.id, email, password, displayName: "Анна Волкова", companyName: "Линия", provenance: "Synthetic employer registered via ordinary HTTP and local Mailpit for UI QA; not a real company or human participant." };
    await save();
    const mailUrl = process.env.MAILPIT_URL || "http://127.0.0.1:8026";
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(mailUrl).hostname));
    const response = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const messages: any = await response.json();
    let code: string | undefined;
    for (const item of messages.messages ?? []) {
      const letter: any = await (await fetch(`${mailUrl}/api/v1/message/${encodeURIComponent(item.ID)}`)).json();
      if (!(letter.To ?? item.To ?? []).some((to: any) => to.Address?.toLowerCase() === email)) continue;
      code = String(letter.Text ?? letter.HTML ?? "").match(/\b(\d{6})\b/)?.[1];
      if (code) break;
    }
    assert.ok(code, "Local verification message must arrive");
    const verified = await employer.api("/auth/verify-email", "POST", { email, code });
    assert.equal(verified.user.id, user.id);
  } else {
    assert.equal(fixture.employer.email, `${fixture.fixtureId}-employer@example.test`);
    await employer.api("/auth/login", "POST", { email: fixture.employer.email, password: fixture.employer.password });
  }
  await candidate.api("/auth/login", "POST", { email: fixture.candidate.email, password: fixture.candidate.password });
  const profile = await candidate.api("/me/candidate-profile");
  assert.equal(profile.userId, fixture.candidate.id);
  assert.equal(profile.specialization, "Frontend / TypeScript");
  assert.equal(profile.verifiedGrade, "Middle", "Record the assessment through UI before making the employer fixture");
  const company = await employer.api("/employer/company", "PUT", { name: "Линия", description: "Продуктовая команда: создаём понятные инструменты для совместной работы. Ценим доступность интерфейса, аккуратные решения и открытую обратную связь.", industry: "Информационные технологии", contactEmail: fixture.employer.email, contactPhone: null, contactMethod: "Электронная почта" });
  fixture.employer.companyId = company.company.id;
  fixture.opportunities ??= { provenance: "All company, vacancy and task descriptions are original fictional browser-recording fixtures. Prepared through ordinary HTTP. Candidate category was obtained separately through the UI; no acceptance, application, answer or evaluation is pre-filled by this tool." };
  await save();
  if (!fixture.opportunities.needId) {
    const need = await employer.api("/employer/needs", "POST", { ...role, requiredSkills: ["TypeScript"], desirableSkills: ["Accessibility", "Frontend state"] });
    fixture.opportunities.needId = need.id; await save();
  }
  if (!fixture.opportunities.invitationId) {
    const invite = await employer.api("/employer/invitations", "POST", { needId: fixture.opportunities.needId, candidateId: fixture.candidate.id, title: role.title, message: "Мария, приглашаем обсудить развитие личного кабинета. У нас небольшая продуктовая команда, удалённая работа и прозрачные условия. Будем рады познакомиться.", reason: "Подтверждённый TypeScript уровня Middle и сильные результаты по доступности и состоянию интерфейса соответствуют задачам команды.", salaryMin: role.salaryMin, salaryMax: role.salaryMax, salaryPeriod: role.salaryPeriod, salaryType: role.salaryType, workFormat: role.workFormat });
    fixture.opportunities.invitationId = invite.id; await save();
  }
  if (!fixture.opportunities.jobId) {
    const job = await employer.api("/employer/jobs", "POST", { ...role, skills: ["TypeScript", "Accessibility", "Frontend state"] });
    fixture.opportunities.jobId = job.id; await save();
    await employer.api(`/employer/jobs/${job.id}/status`, "POST", { status: "published" });
  }
  if (!fixture.opportunities.templateId) {
    const template = await employer.api("/employer/microtasks", "POST", {
      title: "Доступная форма без ошибок", competency: "Доступность форм",
      scenario: "В учебном интерфейсе пользователь подписывается на рассылку. После отправки неверного адреса появляется сообщение об ошибке, но клавиатурный фокус теряется, а экранный диктор молчит. Опишите порядок фокуса, связь ошибки с полем и поведение после успешного исправления. Предложите два проверяемых сценария. Используйте только вымышленную ситуацию; код для внедрения и реальные адреса не нужны.",
      expectedMinutes: 15, intervalDays: 7, deadlineDays: 3, educationalOnly: true,
      rubric: [
        { id: "focus", label: "Понятный порядок фокуса и возврат к ошибке", maxPoints: 4 },
        { id: "announcement", label: "Связь ошибки с полем и сообщение диктору", maxPoints: 3 },
        { id: "checks", label: "Два сценария с ожидаемым результатом", maxPoints: 3 },
      ],
    });
    fixture.opportunities.templateId = template.id; await save();
  }
  if (!fixture.opportunities.subscriptionId) {
    await candidate.api("/me/microtasks/preferences", "PUT", { enabled: true });
    const subscription = await employer.api(`/employer/microtasks/${fixture.opportunities.templateId}/subscriptions`, "POST", { candidateId: fixture.candidate.id });
    fixture.opportunities.subscriptionId = subscription.id;
    const practice = await candidate.api("/me/microtasks");
    fixture.opportunities.offerId = practice.offers.find((offer: any) => offer.subscriptionId === subscription.id)?.id ?? null;
    fixture.opportunities.practiceOptInPreparedByFixture = true;
    await save();
  }
  fixture.opportunities.setupCompletedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ ready: true, candidateId: fixture.candidate.id, employerId: fixture.employer.id, ...Object.fromEntries(Object.entries(fixture.opportunities).filter(([key]) => key.endsWith("Id"))) }));
} finally { await pool.end(); }
