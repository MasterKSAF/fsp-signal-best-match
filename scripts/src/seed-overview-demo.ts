import { randomBytes, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, signalUsersTable as users, signalCandidateProfilesTable as profiles,
  signalCandidateResumesTable as resumes, signalCompaniesTable as companies, signalDemoSeedTable as markers,
  signalMicroPreferencesTable as preferences, signalMicroTemplatesTable as templates,
  signalMicroSubscriptionsTable as subscriptions, signalMicroOffersTable as offers } from "@workspace/db";
import { captureMicroResume } from "../../artifacts/api-server/src/lib/microtask-resume-policy";
import { MICRO_LIMITS } from "../../artifacts/api-server/src/lib/opportunity-rules";
import { validateAvatarDataUrl } from "../../artifacts/api-server/src/lib/signal-avatar";

export const OVERVIEW_DEMO_MARKER = "overview-demo-content-v060-20261007";
const fixedDate = new Date("2026-10-01T09:00:00.000Z");
const qualificationLimitation = "Синтетический обзорный пример: исторический грейд и навыки, без полного экзаменационного протокола. Это не результат человека или reviewer-экзамена.";
type Grade = "Junior" | "Middle" | "Senior";
type DemoPerson = { slug: string; alias: string; specialization: "Backend / Python" | "Frontend / TypeScript";
  grade: Grade | null; skills: string[]; years: number; public?: boolean; multiple?: boolean };
const people: DemoPerson[] = [
  { slug: "backend-junior", alias: "Demo · First Endpoint", specialization: "Backend / Python", grade: "Junior", skills: ["Python", "SQL", "API contracts"], years: 1 },
  { slug: "backend-middle", alias: "Demo · Reliable API", specialization: "Backend / Python", grade: "Middle", skills: ["Python", "SQL", "API contracts", "Idempotency"], years: 4, public: true, multiple: true },
  { slug: "backend-senior", alias: "Demo · System Builder", specialization: "Backend / Python", grade: "Senior", skills: ["Python", "SQL", "API contracts", "Idempotency", "Architecture"], years: 7, public: true },
  { slug: "frontend-junior", alias: "Demo · Accessible UI", specialization: "Frontend / TypeScript", grade: "Junior", skills: ["TypeScript", "Accessibility"], years: 1, public: true },
  { slug: "frontend-middle", alias: "Demo · Typed State", specialization: "Frontend / TypeScript", grade: "Middle", skills: ["TypeScript", "Accessibility", "Frontend state", "Frontend performance"], years: 3 },
  { slug: "frontend-ungraded", alias: "Demo · New Interface", specialization: "Frontend / TypeScript", grade: null, skills: ["TypeScript", "React"], years: 0 },
];

/** Adds only its own synthetic records once. It never repairs/reset users' actions. */
export async function seedOverviewDemo() {
  if (process.env.DEMO_MODE !== "true") throw new Error("Overview preparation requires explicit DEMO_MODE=true");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OVERVIEW_DEMO_MARKER}))`);
    const [marker] = await tx.select().from(markers).where(eq(markers.key, OVERVIEW_DEMO_MARKER));
    if (marker) return { created: false, marker: OVERVIEW_DEMO_MARKER };
    const [employer] = await tx.select({ user: users, company: companies }).from(users)
      .innerJoin(companies, eq(companies.ownerUserId, users.id))
      .where(and(eq(users.email, "employer-demo@example.test"), eq(users.role, "employer"), eq(users.demoMode, true), isNull(users.reviewScopeId)));
    if (!employer) throw new Error("Prepare the reserved overview employer before content; ordinary/reviewer accounts are excluded");
    const avatarBytes = await readFile(new URL("../fixtures/overview-synthetic-avatar.png", import.meta.url));
    const avatar = validateAvatarDataUrl(`data:image/png;base64,${avatarBytes.toString("base64")}`);
    if (!avatar) throw new Error("Synthetic overview avatar is invalid");
    let practicePerson: { userId: number; alias: string; resume: typeof resumes.$inferSelect } | undefined;
    for (const person of people) {
      const email = `overview-v060-${person.slug}@example.test`;
      const [collision] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (collision) throw new Error("Reserved overview identity already exists without its content marker; refusing to modify any existing actions");
      const salt = randomBytes(16).toString("hex"), unusablePassword = randomBytes(32).toString("hex");
      const [user] = await tx.insert(users).values({ email, role: "candidate", displayName: `${person.alias} · синтетический профиль`,
        demoMode: true, reviewScopeId: null, emailVerified: true,
        passwordHash: `scrypt:${salt}:${scryptSync(unusablePassword, salt, 64).toString("hex")}` }).returning();
      const qualification = person.grade ? { specialization: person.specialization, grade: person.grade, score: null,
        skills: person.skills, assessedAt: fixedDate.toISOString(), gradeChangedAt: null, attemptId: null, limitation: qualificationLimitation } : null;
      await tx.insert(profiles).values({ userId: user!.id, professionalAlias: person.alias,
        specialization: person.specialization, assumedGrade: person.grade ?? "Junior", verifiedGrade: person.grade,
        verifiedSkills: person.grade ? person.skills : [], legacyQualification: qualification,
        stack: person.skills, skills: person.skills, yearsExperience: person.years, visibility: "private", consentMatching: false,
        avatarDataUrl: person.multiple ? avatar.dataUrl : null, avatarUpdatedAt: person.multiple ? fixedDate : null,
        contactEmail: email, updatedAt: fixedDate });
      const profileFields = { userId: user!.id, specialization: person.specialization,
        assumedGrade: person.grade ?? "Junior", verifiedGrade: person.grade, verifiedSkills: person.grade ? person.skills : [],
        legacyQualification: qualification, stack: person.skills, skills: person.skills, yearsExperience: person.years,
        workFormat: person.years % 2 ? "Гибрид" : "Удалённо", salaryMin: person.grade === "Senior" ? 280000 : person.grade === "Middle" ? 180000 : 80000,
        salaryMax: person.grade === "Senior" ? 360000 : person.grade === "Middle" ? 240000 : 130000,
        latestAssessmentAt: person.grade ? fixedDate : null, summary: "Синтетический обзорный профиль. Навыки перечислены по существу; контакты доступны только по отдельному согласию.",
        updatedAt: fixedDate };
      if (person.multiple) {
        await tx.insert(resumes).values({ ...profileFields, title: "Личное основное резюме · Demo", isPrimary: true, visibility: "private",
          consentMatching: false, consentCatalog: false, readyForOffers: false });
      }
      const [visible] = await tx.insert(resumes).values({ ...profileFields, title: `${person.specialization.split(" / ")[0]} · ${person.grade ?? "без подтверждения"} · Demo`,
        isPrimary: !person.multiple, visibility: person.public ? "public" : "pseudonymous", consentCatalog: true,
        consentMatching: Boolean(person.grade), readyForOffers: Boolean(person.grade) }).returning();
      if (person.multiple) {
        await tx.insert(resumes).values({ ...profileFields, title: "Frontend · новое направление · Demo", isPrimary: false,
          specialization: "Frontend / TypeScript", assumedGrade: "Junior", verifiedGrade: null, verifiedSkills: [], legacyQualification: null,
          stack: ["TypeScript", "React"], skills: ["TypeScript", "React"], latestAssessmentAt: null,
          visibility: "pseudonymous", consentCatalog: true, consentMatching: false, readyForOffers: false });
        practicePerson = { userId: user!.id, alias: person.alias, resume: visible! };
      }
      await tx.insert(preferences).values({ candidateUserId: user!.id, enabled: Boolean(person.grade), updatedAt: fixedDate });
    }
    const rubric = [{ id: "repeat", label: "Правило повторного идентификатора", maxPoints: 4 },
      { id: "atomic", label: "Согласованность результата при сбое", maxPoints: 3 },
      { id: "tests", label: "Два тестовых сценария", maxPoints: 3 }];
    const [template] = await tx.insert(templates).values({ companyId: employer.company.id,
      title: "Учебный счётчик библиотеки · Demo", specialization: "Backend / Python", competency: "Idempotency",
      scenario: "Синтетическая практика. Вымышленная библиотека считает посещения. Объясните повтор запроса, атомарную запись и два теста. Производственный код и доступ к инфраструктуре не нужны.",
      expectedMinutes: 20, intervalDays: 7, deadlineDays: 3, rubric, educationalOnly: true, active: true, createdAt: fixedDate }).returning();
    const person = practicePerson!;
    const binding = captureMicroResume(person.resume, person.alias);
    const [subscription] = await tx.insert(subscriptions).values({ ...binding, candidateUserId: person.userId, templateId: template!.id,
      active: false, nextDueAt: new Date("2026-10-08T09:00:00Z"), lastOfferedAt: fixedDate, createdAt: fixedDate }).returning();
    await tx.insert(offers).values({ ...binding, subscriptionId: subscription!.id, companyId: employer.company.id,
      candidateUserId: person.userId, snapshot: { title: template!.title, competency: template!.competency,
        scenario: template!.scenario, expectedMinutes: template!.expectedMinutes, rubric, version: template!.version,
        companyName: employer.company.name, limits: MICRO_LIMITS }, status: "evaluated", scheduledFor: fixedDate,
      dueAt: new Date("2026-10-04T09:00:00Z"), createdAt: fixedDate, acceptedAt: fixedDate,
      submittedAt: new Date("2026-10-01T10:00:00Z"), answer: "Синтетический обзорный ответ: ключ повтора сохраняется атомарно с результатом; повтор возвращает прежний результат. Проверки: повтор идентификатора и сбой до фиксации.",
      shareResult: true, result: { purpose: "company_task", qualificationEffect: "none", source: "company_task",
        evaluatorUserId: employer.user.id, evaluatedAt: "2026-10-02T09:00:00Z", competency: template!.competency, templateVersion: template!.version,
        scores: [{ criterionId: "repeat", points: 4, comment: "Синтетический пример обратной связи." },
          { criterionId: "atomic", points: 2, comment: "Не все границы сбоя разобраны." },
          { criterionId: "tests", points: 2, comment: "Два базовых сценария; можно добавить конкурентный повтор." }],
        total: 8, max: 10, feedback: "Синтетический пример оценки компании. 8/10 за учебное рассуждение; грейд и экзамен Signal не изменяются." } });
    await tx.insert(markers).values({ key: OVERVIEW_DEMO_MARKER, version: "six-people-eight-resumes-one-program-v1" });
    return { created: true, marker: OVERVIEW_DEMO_MARKER, people: people.length, resumes: 8, templates: 1, offers: 1 };
  });
}
