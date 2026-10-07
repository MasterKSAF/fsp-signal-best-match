import { randomBytes, scryptSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  signalCandidateProfilesTable,
  signalCandidateResumesTable,
  signalCompaniesTable,
  signalDemoSeedTable,
  signalInvitationsTable,
  signalNeedsTable,
  signalUsersTable,
} from "@workspace/db";
import { ensureCandidateResume, snapshotCandidateResume } from "../../artifacts/api-server/src/lib/signal-resume";

const datasetVersion = "fsp-signal-demo-v2-220x22";
// Seeded accounts are entered only through the explicitly enabled isolated demo.
const demoPassword = randomBytes(32).toString("hex");
const passwordHash = () => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(demoPassword, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
};

type CandidateSeed = {
  email: string; name: string; alias: string;
  grade: "Junior" | "Middle" | "Senior" | null; score: number | null;
  skills: string[]; stack: string[]; years: number; fsp: boolean;
  salaryMin: number | null; salaryMax: number | null;
  visibility?: "private" | "pseudonymous" | "public";
};
const candidateData: CandidateSeed[] = [
  {
    email: "candidate-demo@example.test",
    name: "Алексей Орлов",
    alias: "Python Pilot",
    grade: "Middle" as const,
    score: 92,
    skills: ["Python", "FastAPI", "PostgreSQL", "Redis", "API contracts"],
    stack: ["Python", "FastAPI", "PostgreSQL", "Redis", "Docker"],
    years: 4,
    fsp: false,
    salaryMin: 220000,
    salaryMax: 280000,
  },
  {
    email: "candidate-02@example.test",
    name: "Мария Лебедева",
    alias: "Data Harbor",
    grade: "Middle" as const,
    score: 89,
    skills: ["Python", "PostgreSQL", "SQL", "API contracts"],
    stack: ["Python", "Django", "PostgreSQL", "Docker"],
    years: 5,
    fsp: true,
    salaryMin: 230000,
    salaryMax: 290000,
  },
  {
    email: "candidate-03@example.test",
    name: "Илья Соколов",
    alias: "Quiet Compiler",
    grade: "Senior" as const,
    score: 94,
    skills: ["Python", "FastAPI", "PostgreSQL", "Idempotency", "Architecture"],
    stack: ["Python", "FastAPI", "PostgreSQL", "Kafka", "Kubernetes"],
    years: 8,
    fsp: true,
    salaryMin: 300000,
    salaryMax: 380000,
  },
  {
    email: "candidate-04@example.test",
    name: "Екатерина Белова",
    alias: "Practical Query",
    grade: "Middle" as const,
    score: 86,
    skills: ["Python", "PostgreSQL", "Incident diagnosis", "SQL"],
    stack: ["Python", "Flask", "PostgreSQL", "RabbitMQ"],
    years: 3,
    fsp: false,
    salaryMin: null,
    salaryMax: null,
  },
  {
    email: "candidate-05@example.test",
    name: "Дмитрий Волков",
    alias: "Northbound API",
    grade: "Junior" as const,
    score: 78,
    skills: ["Python", "SQL", "API contracts"],
    stack: ["Python", "FastAPI", "SQLite"],
    years: 1,
    fsp: true,
    salaryMin: 120000,
    salaryMax: 160000,
  },
  {
    email: "candidate-06@example.test",
    name: "Анна Морозова",
    alias: "Safe Retry",
    grade: "Middle" as const,
    score: 91,
    skills: ["Python", "FastAPI", "PostgreSQL", "Idempotency"],
    stack: ["Python", "FastAPI", "PostgreSQL", "Redis"],
    years: 6,
    fsp: false,
    salaryMin: 260000,
    salaryMax: 320000,
  },
  {
    email: "candidate-07@example.test",
    name: "Павел Никитин",
    alias: "Blue Schema",
    grade: "Middle" as const,
    score: 82,
    skills: ["Python", "SQL", "PostgreSQL"],
    stack: ["Python", "Django", "PostgreSQL", "Celery"],
    years: 4,
    fsp: true,
    salaryMin: 200000,
    salaryMax: 250000,
  },
  {
    email: "candidate-08@example.test",
    name: "Софья Павлова",
    alias: "Signal Trace",
    grade: "Senior" as const,
    score: 88,
    skills: ["Python", "Incident diagnosis", "Architecture", "API contracts"],
    stack: ["Python", "FastAPI", "PostgreSQL", "AWS"],
    years: 9,
    fsp: false,
    salaryMin: 280000,
    salaryMax: 360000,
  },
  {
    email: "candidate-09@example.test",
    name: "Никита Захаров",
    alias: "First Endpoint",
    grade: null,
    score: null,
    skills: ["Python", "SQL"],
    stack: ["Python", "Flask", "SQLite"],
    years: 1,
    fsp: false,
    salaryMin: 100000,
    salaryMax: 140000,
  },
  {
    email: "candidate-10@example.test",
    name: "Вера Фомина",
    alias: "Latency Note",
    grade: "Middle" as const,
    score: 80,
    skills: ["Python", "FastAPI", "Incident diagnosis"],
    stack: ["Python", "FastAPI", "PostgreSQL", "Prometheus"],
    years: 5,
    fsp: true,
    salaryMin: 240000,
    salaryMax: 300000,
  },
  {
    email: "candidate-11@example.test",
    name: "Михаил Громов",
    alias: "Table Garden",
    grade: "Middle" as const,
    score: 87,
    skills: ["Python", "PostgreSQL", "SQL", "Architecture"],
    stack: ["Python", "Django", "PostgreSQL", "Docker"],
    years: 7,
    fsp: false,
    salaryMin: 250000,
    salaryMax: 310000,
  },
  {
    email: "candidate-12@example.test",
    name: "Алина Крылова",
    alias: "Open Transaction",
    grade: "Junior" as const,
    score: 74,
    skills: ["Python", "API contracts", "SQL"],
    stack: ["Python", "FastAPI", "PostgreSQL"],
    years: 2,
    fsp: true,
    salaryMin: 150000,
    salaryMax: 190000,
  },
  {
    email: "candidate-13@example.test",
    name: "Роман Егоров",
    alias: "Fresh Evidence",
    grade: "Middle" as const,
    score: 84,
    skills: ["Python", "PostgreSQL", "Idempotency"],
    stack: ["Python", "FastAPI", "PostgreSQL", "RabbitMQ"],
    years: 4,
    fsp: false,
    salaryMin: 220000,
    salaryMax: 270000,
  },
  {
    email: "candidate-14@example.test",
    name: "Дарья Комарова",
    alias: "Stated Stack",
    grade: "Middle" as const,
    score: 77,
    skills: ["Python", "SQL", "API contracts"],
    stack: ["Python", "FastAPI", "PostgreSQL"],
    years: 3,
    fsp: false,
    salaryMin: null,
    salaryMax: null,
  },
  {
    email: "candidate-15@example.test",
    name: "Тимур Васильев",
    alias: "Hidden Profile",
    grade: "Middle" as const,
    score: 90,
    skills: ["Python", "FastAPI", "PostgreSQL", "Architecture"],
    stack: ["Python", "FastAPI", "PostgreSQL", "Kafka"],
    years: 6,
    fsp: true,
    salaryMin: 240000,
    salaryMax: 300000,
    visibility: "private" as const,
  },
  {
    email: "candidate-16@example.test",
    name: "Полина Андреева",
    alias: "Review Needed",
    grade: "Middle" as const,
    score: 76,
    skills: ["Python", "SQL", "PostgreSQL"],
    stack: ["Python", "Django", "PostgreSQL"],
    years: 4,
    fsp: false,
    salaryMin: 210000,
    salaryMax: 260000,
  },
];

// Deterministic synthetic variety. These rows are demonstrations, not independent expert labels.
for (let i = 16; i < 220; i++) {
  const grade = (['Junior', 'Middle', 'Senior'] as const)[i % 3];
  const score = 58 + ((i * 17) % 42);
  const sets = [
    ['Python', 'PostgreSQL', 'API contracts', 'FastAPI'],
    ['Python', 'PostgreSQL', 'Idempotency', 'Architecture'],
    ['Python', 'SQL', 'Incident diagnosis', 'PostgreSQL'],
    ['Python', 'API contracts', 'SQL', 'Idempotency'],
    ['Python', 'PostgreSQL', 'Architecture', 'Incident diagnosis', 'Idempotency'],
  ];
  candidateData.push({
    email: `synthetic-${i + 1}@candidate.example.test`,
    name: `Демо-участник ${String(i + 1).padStart(3, '0')}`,
    alias: `Инженер #${String(i + 1).padStart(3, '0')}`,
    grade, score, skills: sets[i % sets.length],
    stack: [...sets[i % sets.length].filter(s => ['Python','SQL','PostgreSQL','FastAPI'].includes(s)), i % 2 ? 'Redis' : 'Docker'],
    years: 1 + (i % 9), fsp: i % 4 === 0,
    salaryMin: grade === 'Junior' ? 100000 : grade === 'Middle' ? 210000 : 300000,
    salaryMax: grade === 'Junior' ? 160000 : grade === 'Middle' ? 290000 : 420000,
    ...(i % 17 === 0 ? {visibility: 'private' as const} : {}),
  });
}

async function getOrCreateUser(input: {
  email: string;
  displayName: string;
  role: "candidate" | "employer";
}) {
  await db
    .insert(signalUsersTable)
    .values({
      ...input,
      passwordHash: passwordHash(),
      emailVerified: true,
      demoMode: true,
    })
    .onConflictDoNothing({ target: signalUsersTable.email });
  const [user] = await db
    .select()
    .from(signalUsersTable)
    .where(eq(signalUsersTable.email, input.email))
    .limit(1);
  if (!user) throw new Error(`Failed to seed demo user ${input.email}`);
  if (!user.demoMode || user.role !== input.role) throw new Error('A reserved demo identity conflicts with a regular account. Seed stopped without modifying that account.');
  return user;
}

async function main() {
  if (process.env.DEMO_MODE !== "true") throw new Error("Seeding requires explicit DEMO_MODE=true; demo data must not be inserted into a live pool.");
  const candidates = [];
  const [resumeSeedMarker] = await db.select({key:signalDemoSeedTable.key}).from(signalDemoSeedTable).where(eq(signalDemoSeedTable.key,'multi-resume-demo-v1')).limit(1);
  for (const [index, candidate] of candidateData.entries()) {
    const user = await getOrCreateUser({
      email: candidate.email,
      displayName: candidate.name,
      role: "candidate",
    });
    await db
      .insert(signalCandidateProfilesTable)
      .values({
        userId: user.id,
        professionalAlias: candidate.alias,
        specialization: "Backend / Python",
        assumedGrade: candidate.grade ?? "Junior",
        verifiedGrade: candidate.grade,
        verifiedGradeChangedAt: null,
        verifiedScore: candidate.score,
        verifiedSkills: candidate.score
          ? [
              ...new Set([
                ...candidate.skills.slice(0, 3),
                ...(candidate.skills.includes("API contracts") ? ["API contracts"] : []),
              ]),
            ]
          : [],
        stack: candidate.stack,
        skills: candidate.skills,
        yearsExperience: candidate.years,
        workFormat: index % 3 === 0 ? "Удалённо" : "Гибрид",
        salaryMin: candidate.salaryMin ?? null,
        salaryMax: candidate.salaryMax ?? null,
        salaryPeriod: "month",
        salaryType: index % 2 === 0 ? "gross" : "net",
        visibility: candidate.visibility ?? "pseudonymous",
        consentMatching: candidate.visibility !== "private",
        contactEmail: candidate.email,
        phone: `+7 900 000-${String(index + 1).padStart(2, "0")}-${String(index + 11).padStart(2, "0")}`,
        hasFspHistory: candidate.fsp,
        latestAssessmentAt: candidate.score ? new Date("2026-09-18T09:00:00.000Z") : null,
        updatedAt: new Date("2026-09-18T09:00:00.000Z"),
      })
      .onConflictDoNothing({ target: signalCandidateProfilesTable.userId });
    candidates.push(user);
    // New installations seed after migrations. Materialize each synthetic owner's
    // initial resume now so the employer catalogue does not depend on their login.
    const resume = await ensureCandidateResume(user.id);
    if (resume && !resumeSeedMarker) await db.update(signalCandidateResumesTable).set({consentCatalog:resume.visibility !== 'private',readyForOffers:resume.visibility !== 'private' && index % 4 !== 0}).where(and(eq(signalCandidateResumesTable.id,resume.id),eq(signalCandidateResumesTable.userId,user.id)));
  }
  if (!resumeSeedMarker) await db.insert(signalDemoSeedTable).values({key:'multi-resume-demo-v1',version:'demo-only-publication-v1'}).onConflictDoNothing({target:signalDemoSeedTable.key});

  const employer = await getOrCreateUser({
    email: "employer-demo@example.test",
    displayName: "Команда Northstar",
    role: "employer",
  });
  const secondEmployer = await getOrCreateUser({
    email: "employer-alt@example.test",
    displayName: "Команда Meridian",
    role: "employer",
  });

  const companyDetails = [
    { userId: employer.id, name: "Northstar Systems", email: "team@northstar.example.test" },
    { userId: secondEmployer.id, name: "Meridian Lab", email: "people@meridian.example.test" },
  ];
  const companyIds: number[] = [];
  for (const details of companyDetails) {
    await db
      .insert(signalCompaniesTable)
      .values({
        ownerUserId: details.userId,
        name: details.name,
        description: "Демонстрационная команда продуктовой разработки.",
        contactEmail: details.email,
        contactMethod: "Электронная почта",
      })
      .onConflictDoNothing({ target: signalCompaniesTable.ownerUserId });
    const [company] = await db
      .select()
      .from(signalCompaniesTable)
      .where(eq(signalCompaniesTable.ownerUserId, details.userId))
      .limit(1);
    if (!company) throw new Error(`Failed to seed company for ${details.name}`);
    companyIds.push(company.id);
  }

  const [existingNeed] = await db
    .select()
    .from(signalNeedsTable)
    .where(and(eq(signalNeedsTable.companyId, companyIds[0]), eq(signalNeedsTable.title, "Backend-разработчик Python")))
    .limit(1);
  if (!existingNeed) {
    await db.insert(signalNeedsTable).values({
      companyId: companyIds[0],
      title: "Backend-разработчик Python",
      specialization: "Backend / Python",
      grade: "Middle",
      requiredSkills: ["Python", "PostgreSQL"],
      desirableSkills: ["API contracts", "FastAPI", "Idempotency"],
      description: "Развивать API для внутренних продуктовых команд: проектировать контракты, поддерживать надёжность интеграций и участвовать в разборе инцидентов.",
      workFormat: "Удалённо или гибрид",
      salaryMin: 220000,
      salaryMax: 280000,
      salaryPeriod: "month",
      salaryType: "gross",
    });
  }
  const [need] = await db
    .select()
    .from(signalNeedsTable)
    .where(and(eq(signalNeedsTable.companyId, companyIds[0]), eq(signalNeedsTable.title, "Backend-разработчик Python")))
    .limit(1);
  if (!need) throw new Error("Failed to seed demo need");

  // Twenty-one additional needs; the primary need remains the default demonstration.
  const focusSets = [
    { title: 'Платёжные интеграции', required: ['Python','Idempotency'], desirable: ['PostgreSQL','Architecture'] },
    { title: 'Платформа данных', required: ['Python','SQL'], desirable: ['PostgreSQL','Incident diagnosis'] },
    { title: 'Контракты продуктового API', required: ['Python','API contracts'], desirable: ['FastAPI','PostgreSQL'] },
    { title: 'Надёжность сервисов', required: ['Python','Architecture'], desirable: ['Idempotency','Incident diagnosis'] },
    { title: 'Разбор производительности', required: ['Python','PostgreSQL'], desirable: ['Incident diagnosis','SQL'] },
    { title: 'Асинхронные операции', required: ['Python','Idempotency'], desirable: ['API contracts','Architecture'] },
    { title: 'Сервисы команды роста', required: ['Python','API contracts'], desirable: ['SQL','FastAPI'] },
  ];
  for (let i = 0; i < 21; i++) {
    const focus = focusSets[i % focusSets.length];
    const grade = (['Junior','Middle','Senior'] as const)[Math.floor(i / 7)];
    const title = `${focus.title} · ${grade}`;
    const companyId = companyIds[i % companyIds.length];
    const [found] = await db.select({id: signalNeedsTable.id}).from(signalNeedsTable).where(and(eq(signalNeedsTable.companyId, companyId),eq(signalNeedsTable.title,title))).limit(1);
    if (found) continue;
    await db.insert(signalNeedsTable).values({companyId,title,specialization:'Backend / Python',grade,
      requiredSkills:focus.required,desirableSkills:focus.desirable,
      description:`Синтетическая потребность: ${focus.title.toLowerCase()}. Проверяем навыки на инженерных кейсах; условия обсуждаются с кандидатом.`,
      workFormat:i % 3 === 0 ? 'Гибрид' : 'Удалённо',
      salaryMin:grade === 'Junior' ? 120000 : grade === 'Middle' ? 220000 : 320000,
      salaryMax:grade === 'Junior' ? 180000 : grade === 'Middle' ? 290000 : 430000,
      salaryPeriod:'month',salaryType:'gross'});
  }
  const candidate = candidates[0];
  if (candidate) {
    const [existingInvitation] = await db
      .select({ id: signalInvitationsTable.id })
      .from(signalInvitationsTable)
      .where(and(eq(signalInvitationsTable.needId, need.id), eq(signalInvitationsTable.candidateUserId, candidate.id)))
      .limit(1);
    if (!existingInvitation) {
      const target = await ensureCandidateResume(candidate.id);
      await db.insert(signalInvitationsTable).values({
        needId: need.id,
        companyId: companyIds[0],
        candidateUserId: candidate.id,
        resumeId: target?.id ?? null,
        resumeSnapshot: target ? snapshotCandidateResume(target) : null,
        title: "Приглашение обсудить роль Backend-разработчика",
        message: "Ваш подтверждённый опыт с Python и PostgreSQL подходит задаче команды. Предлагаем обсудить роль и формат работы.",
        reason: "Совпали подтверждённые навыки Python, PostgreSQL и API-контрактов; опыт подтверждён КАЛИБР.",
        salaryMin: 220000,
        salaryMax: 280000,
        salaryPeriod: "month",
        salaryType: "gross",
        workFormat: "Удалённо или гибрид",
        status: "sent",
      });
    }
  }

  await db
    .insert(signalDemoSeedTable)
    .values({ key: "default", version: datasetVersion })
    .onConflictDoNothing({ target: signalDemoSeedTable.key });

  console.info(`FSP SIGNAL synthetic seed is ready (${datasetVersion}; ${candidateData.length} candidate profiles).`);
}

main()
  .catch((error: unknown) => {
    console.error("FSP SIGNAL seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
