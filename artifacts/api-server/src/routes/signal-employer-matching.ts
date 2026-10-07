import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  CreateEmployerNeedBody,
  CreateEmployerNeedResponse,
  GetMatchExplanationQueryParams,
  GetMatchExplanationResponse,
  GetMatchesQueryParams,
  GetMatchesResponse,
  ListEmployerNeedsResponse,
} from "@workspace/api-zod";
import {
  db,
  signalCandidateProfilesTable,
  signalCompaniesTable,
  signalNeedsTable,
  signalUsersTable,
} from "@workspace/db";
import {
  evaluateMatch,
  rankMatches,
  MATCH_ALGORITHM_VERSION,
  type MatchCandidate,
  type MatchNeed,
  type SignalGrade,
} from "../lib/signal-matching";
import {
  SKILL_CATALOG_VERSION,
  skillCoverage,
  resolveSkill,
} from "../lib/skill-catalog";
import { withAssessmentRankingEvidence } from "../lib/assessment-ranking-evidence";
import {
  loadResumeCandidates,
  rankedResumePool,
  serializeRankedResumeMatches,
  withResumeSkillEvidence,
} from "../lib/signal-resume-matching";
import {
  safeCatalogResume,
  availableResumeSummary,
} from "../lib/signal-resume-catalog";
import { compareResumeFacts } from "../lib/signal-resume-comparison";
import {presentFspSignal} from '../lib/fsp-results';
import {SkillCoverageQuerySchema} from '../lib/skill-coverage-input';
import { getSessionUser } from "../lib/signal-auth";
import {
  poolScopeForAccount,
  type SignalPoolScope,
} from "../lib/signal-pool-scope";
import {
  postgresIntIdInputSchema,
  postgresIntIdTextSchema,
  postgresIntIdParam,
} from "../lib/postgres-id";

const router: IRouter = Router();
router.param("id", postgresIntIdParam);

const CompanyUpdateBody = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(3000),
    industry: z.string().trim().min(2).max(160),
    contactEmail: z.string().trim().email().max(320),
    contactPhone: z
      .string()
      .trim()
      .max(64)
      .regex(/^[0-9+() .-]*$/)
      .nullable()
      .optional(),
    contactMethod: z.enum(["Электронная почта", "Телефон", "Мессенджер"]),
  })
  .strict();

type EmployerContext = SignalPoolScope & {
  userId: number;
  companyId: number;
  demoMode: boolean;
};

type CandidateRow = MatchCandidate;

async function employerContext(
  req: Request,
  res: Response,
): Promise<EmployerContext | null> {
  const session = await getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Войдите в аккаунт работодателя." });
    return null;
  }
  if (session.user.role !== "employer") {
    res.status(403).json({ error: "Этот раздел доступен работодателю." });
    return null;
  }
  const [company] = await db
    .select({ id: signalCompaniesTable.id })
    .from(signalCompaniesTable)
    .where(eq(signalCompaniesTable.ownerUserId, session.user.id))
    .limit(1);
  if (!company) {
    res.status(400).json({ error: "Сначала заполните профиль компании." });
    return null;
  }
  return {
    userId: session.user.id,
    companyId: company.id,
    ...poolScopeForAccount(session.user),
  };
}

function needForMatch(need: typeof signalNeedsTable.$inferSelect): MatchNeed {
  return {
    specialization: need.specialization,
    grade: need.grade as SignalGrade,
    requiredSkills: need.requiredSkills,
    desirableSkills: need.desirableSkills,
    workFormat: need.workFormat,
    salaryMin: need.salaryMin,
    salaryMax: need.salaryMax,
    salaryPeriod: need.salaryPeriod,
    salaryType: need.salaryType,
  };
}

function companyPayload(company: typeof signalCompaniesTable.$inferSelect) {
  return {
    id: company.id,
    name: company.name,
    description: company.description,
    industry: company.industry,
    contactEmail: company.contactEmail,
    contactPhone: company.contactPhone,
    contactMethod: company.contactMethod,
  };
}

function needPayload(need: typeof signalNeedsTable.$inferSelect) {
  return {
    id: need.id,
    title: need.title,
    specialization: need.specialization,
    grade: need.grade,
    requiredSkills: need.requiredSkills,
    desirableSkills: need.desirableSkills,
    description: need.description,
    workFormat: need.workFormat,
    salaryMin: need.salaryMin,
    salaryMax: need.salaryMax,
    salaryPeriod: need.salaryPeriod,
    salaryType: need.salaryType,
    createdAt: need.createdAt.toISOString(),
  };
}

async function ownedNeed(
  needId: number,
  companyId: number,
): Promise<typeof signalNeedsTable.$inferSelect | null> {
  const [need] = await db
    .select()
    .from(signalNeedsTable)
    .where(
      and(
        eq(signalNeedsTable.id, needId),
        eq(signalNeedsTable.companyId, companyId),
      ),
    )
    .limit(1);
  return need ?? null;
}

async function rankedNeedPool(
  need: typeof signalNeedsTable.$inferSelect,
  context: EmployerContext,
  overrides: ReadonlyMap<number, number> = new Map(),
) {
  return rankedResumePool(needForMatch(need), context, overrides);
}

router.get("/skills/coverage", (req, res): void => {
  const query = SkillCoverageQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Проверьте требования." });
    return;
  }
  res.json({
    catalogVersion: SKILL_CATALOG_VERSION,
    coverage: skillCoverage(
      query.data.skills.split(","),
      query.data.specialization,
    ),
  });
});

router.get("/me/evidence", async (req, res): Promise<void> => {
  const session = await getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Войдите в аккаунт." });
    return;
  }
  if (session.user.role !== "candidate") {
    res.status(403).json({ error: "Раздел доступен кандидату." });
    return;
  }
  const input = z
    .object({ resumeId: postgresIntIdInputSchema })
    .strict()
    .safeParse(req.query);
  if (!input.success) {
    res
      .status(400)
      .json({ error: "Выберите резюме.", code: "RESUME_ID_REQUIRED" });
    return;
  }
  const [candidate] = await withResumeSkillEvidence(
    await loadResumeCandidates(poolScopeForAccount(session.user), {
      purpose: "owned",
      userId: session.user.id,
      resumeId: input.data.resumeId,
    }),
  );
  if (!candidate) {
    res.status(404).json({ error: "Резюме не найдено." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({
    resumeId: candidate.resumeId,
    resumeRevision: candidate.resumeRevision,
    catalogVersion: SKILL_CATALOG_VERSION,
    evidence: candidate.skillEvidence ?? [],
  });
});

router.get(
  "/employer/needs/:id/matching-status",
  async (req, res): Promise<void> => {
    const context = await employerContext(req, res);
    if (!context) return;
    const needId = postgresIntIdInputSchema.safeParse(req.params.id);
    const need = needId.success
      ? await ownedNeed(needId.data, context.companyId)
      : null;
    if (!need) {
      res.status(404).json({ error: "Потребность не найдена." });
      return;
    }
    const coverage = skillCoverage(need.requiredSkills, need.specialization);
    const matches = (await rankedNeedPool(need, context)).length;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      catalogVersion: SKILL_CATALOG_VERSION,
      coverage,
      eligibleCount: matches,
      status: matches
        ? "available"
        : coverage.some((item) => !item.supported)
          ? "unsupported_requirements"
          : "no_verified_candidates",
      minimumGrade: need.grade,
      note: "Обязательные требования сохраняются. Измените условия явно в новой потребности; неподтверждённые навыки не дают допуска.",
    });
  },
);

router.get("/employer/company", async (req, res): Promise<void> => {
  const context = await employerContext(req, res);
  if (!context) return;
  const [company] = await db
    .select()
    .from(signalCompaniesTable)
    .where(
      and(
        eq(signalCompaniesTable.id, context.companyId),
        eq(signalCompaniesTable.ownerUserId, context.userId),
      ),
    )
    .limit(1);
  if (!company) {
    res.status(404).json({ error: "Профиль компании не найден." });
    return;
  }
  res.json({ company: companyPayload(company) });
});

router.put("/employer/company", async (req, res): Promise<void> => {
  const context = await employerContext(req, res);
  if (!context) return;
  const parsed = CompanyUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Проверьте данные профиля компании." });
    return;
  }
  const input = parsed.data;
  const [company] = await db
    .update(signalCompaniesTable)
    .set({
      name: input.name,
      description: input.description,
      industry: input.industry,
      contactEmail: input.contactEmail.toLowerCase(),
      contactPhone: input.contactPhone?.trim() || null,
      contactMethod: input.contactMethod,
    })
    .where(
      and(
        eq(signalCompaniesTable.id, context.companyId),
        eq(signalCompaniesTable.ownerUserId, context.userId),
      ),
    )
    .returning();
  if (!company) {
    res.status(404).json({ error: "Профиль компании не найден." });
    return;
  }
  res.json({ company: companyPayload(company) });
});

router.get("/employer/needs", async (req, res): Promise<void> => {
  const context = await employerContext(req, res);
  if (!context) return;
  const needs = await db
    .select()
    .from(signalNeedsTable)
    .where(eq(signalNeedsTable.companyId, context.companyId))
    .orderBy(desc(signalNeedsTable.createdAt));
  res.json(ListEmployerNeedsResponse.parse(needs.map(needPayload)));
});

router.post("/employer/needs", async (req, res): Promise<void> => {
  const context = await employerContext(req, res);
  if (!context) return;
  const parsed = CreateEmployerNeedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Проверьте обязательные поля потребности." });
    return;
  }
  const input = parsed.data;
  if (input.salaryMin > input.salaryMax) {
    res
      .status(400)
      .json({ error: "Минимальная зарплата не может быть выше максимальной." });
    return;
  }
  const [need] = await db
    .insert(signalNeedsTable)
    .values({ ...input, companyId: context.companyId })
    .returning();
  if (!need) {
    res.status(500).json({ error: "Не удалось сохранить потребность." });
    return;
  }
  res.status(201).json({
    ...CreateEmployerNeedResponse.parse(needPayload(need)),
    catalogVersion: SKILL_CATALOG_VERSION,
    requirements: need.requiredSkills.map(resolveSkill),
    coverage: skillCoverage(need.requiredSkills, need.specialization),
  });
});

router.get("/matches", async (req, res): Promise<void> => {
  const context = await employerContext(req, res);
  if (!context) return;
  const parsed = GetMatchesQueryParams.extend({
    needId: postgresIntIdInputSchema,
    resumeId: postgresIntIdInputSchema.optional(),
    resumeIds: z
      .string()
      .max(3000)
      .transform((value) => value.split(","))
      .pipe(z.array(postgresIntIdTextSchema).min(1).max(100))
      .optional(),
  })
    .strict()
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Укажите потребность для подбора." });
    return;
  }
  const need = await ownedNeed(parsed.data.needId, context.companyId);
  if (!need) {
    res.status(404).json({ error: "Потребность не найдена." });
    return;
  }

  if (parsed.data.resumeId && parsed.data.resumeIds) {
    res.status(400).json({ error: "Передайте resumeId или resumeIds." });
    return;
  }
  const requestedIds =
    parsed.data.resumeIds ??
    (parsed.data.resumeId ? [parsed.data.resumeId] : []);
  const requested = requestedIds.length
    ? await loadResumeCandidates(context, {
        purpose: "matching",
        resumeIds: requestedIds,
      })
    : [];
  if (
    requested.length !== new Set(requestedIds).size ||
    new Set(requested.map((row) => row.userId)).size !== requested.length
  ) {
    res.status(404).json({
      error: "Резюме не найдены или выбрано несколько резюме одного человека.",
    });
    return;
  }
  const matches = await rankedNeedPool(
    need,
    context,
    new Map(requested.map((row) => [row.userId, row.resumeId])),
  );
  if (
    requested.some(
      (row) =>
        !matches.some((entry) => entry.candidate.resumeId === row.resumeId),
    )
  ) {
    res.status(404).json({ error: "Резюме не найдены." });
    return;
  }
  const serialized=serializeRankedResumeMatches(matches,()=>{
  const core = GetMatchesResponse.parse(
    matches.map(({ candidate, evaluation }) => ({
      candidateId: candidate.userId,
      resumeId: candidate.resumeId,
      resumeRevision: candidate.resumeRevision,
      title: candidate.title,
      alias: candidate.alias,
      specialization: candidate.specialization,
      verifiedGrade: candidate.verifiedGrade,
      // Kept for compatibility: score is the role-fit base on a 0..100 scale.
      score: evaluation.baseScore,
      fspBonus: evaluation.fspBonus,
      fspSignal: presentFspSignal(evaluation.fspSignal),
      scoreScope: evaluation.scoreScope,
      stack: [...candidate.stack],
      strengths: evaluation.strengths,
      gaps: evaluation.gaps,
      evidenceDate: candidate.latestAssessmentAt?.toISOString() ?? null,
      fspHistory: candidate.hasFspHistory,
    })),
  );
  return JSON.stringify(
    core.map((match, index) => ({
      ...match,
      resumeId: matches[index]?.candidate.resumeId,
      resumeRevision: matches[index]?.candidate.resumeRevision,
      title: matches[index]?.candidate.title,
      availableResumes: matches[index]?.alternatives.map(
        availableResumeSummary,
      ),
      baseScore: matches[index]?.evaluation.baseScore,
      rankingScore: matches[index]?.evaluation.rankingScore,
      salaryCompatibility: matches[index]?.evaluation.salaryCompatibility,
      ranking: matches[index]?.evaluation.ranking,
      fspSignal: presentFspSignal(matches[index]?.evaluation.fspSignal),
      scoreScope: matches[index]?.evaluation.scoreScope,
    })),
  );
  });
  res.setHeader('Cache-Control','no-store');
  res.type('application/json').send(serialized);
});

router.get("/matches/explanation", async (req, res): Promise<void> => {
  const context = await employerContext(req, res);
  if (!context) return;
  const parsed = GetMatchExplanationQueryParams.extend({
    needId: postgresIntIdInputSchema,
    candidateId: postgresIntIdInputSchema,
    resumeId: postgresIntIdInputSchema,
  })
    .strict()
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Укажите потребность и кандидата." });
    return;
  }
  const [need, candidates] = await Promise.all([
    ownedNeed(parsed.data.needId, context.companyId),
    loadResumeCandidates(context, {
      purpose: "matching",
      userId: parsed.data.candidateId,
      resumeId: parsed.data.resumeId,
    }),
  ]);
  const candidate = candidates[0];
  if (!need || !candidate) {
    res.status(404).json({ error: "Кандидат или потребность не найдены." });
    return;
  }
  const evaluation = evaluateMatch(
    needForMatch(need),
    candidate,
    context.demoMode,
  );
  if (!evaluation.eligible) {
    // Do not reveal whether a private, non-consenting or cross-pool profile
    // exists to a company.
    res.status(404).json({ error: "Кандидат или потребность не найдены." });
    return;
  }
  const selected = (
    await rankedNeedPool(
      need,
      context,
      new Map([[candidate.userId, candidate.resumeId]]),
    )
  ).find(
    (entry) =>
      entry.candidate.userId === candidate.userId &&
      entry.candidate.resumeId === candidate.resumeId,
  );
  if (!selected) {
    res.status(404).json({ error: "Кандидат или потребность не найдены." });
    return;
  }
  const [enrichedCandidate] = await withResumeSkillEvidence([
    selected.candidate,
  ]);
  const enriched = {
    ...selected.evaluation,
    evidence: evaluateMatch(
      needForMatch(need),
      enrichedCandidate,
      context.demoMode,
    ).evidence,
  };
  const response = GetMatchExplanationResponse.parse({
    candidateId: candidate.userId,
    resumeId: candidate.resumeId,
    resumeRevision: candidate.resumeRevision,
    alias: selected.candidate.alias,
    score: enriched.baseScore,
    fspBonus: enriched.fspBonus,
    fspSignal: presentFspSignal(enriched.fspSignal),
    scoreScope: enriched.scoreScope,
    algorithmVersion: MATCH_ALGORITHM_VERSION,
    factors: enriched.factors,
    evidence: enriched.evidence,
    strengths: enriched.strengths,
    gaps: enriched.gaps,
  });
  res.json({
    ...response,
    resumeId: candidate.resumeId,
    resumeRevision: candidate.resumeRevision,
    title: candidate.title,
    availableResumes: selected.alternatives.map(availableResumeSummary),
    evidence: enriched.evidence,
    catalogVersion: SKILL_CATALOG_VERSION,
    minimumGrade: need.grade,
    categoryNote: enriched.ranking.note,
    ranking: enriched.ranking,
    baseScore: enriched.baseScore,
    rankingScore: enriched.rankingScore,
    fspSignal: presentFspSignal(enriched.fspSignal),
    scoreScope: enriched.scoreScope,
    salaryCompatibility: enriched.salaryCompatibility,
    breakdown: {
      baseScore: enriched.baseScore,
      fspBonus: enriched.fspBonus,
      rankingScore: enriched.rankingScore,
      note: "Соответствие требованиям не включает ФСП. Лучший подтверждённый спортивный результат даёт приоритет +1/+2/+3 только внутри одного направления и подтверждённого уровня, после полного действующего экзамена. Он не заменяет грейд и обязательные навыки и не меняет порядок разных категорий.",
    },
  });
});

router.get("/employer/compare", async (req, res): Promise<void> => {
  const context = await employerContext(req, res);
  if (!context) return;
  const parsed = z
    .object({
      needId: postgresIntIdInputSchema,
      leftResumeId: postgresIntIdInputSchema,
      rightResumeId: postgresIntIdInputSchema,
    })
    .strict()
    .safeParse(req.query);
  if (
    !parsed.success ||
    parsed.data.leftResumeId === parsed.data.rightResumeId
  ) {
    res
      .status(400)
      .json({ error: "Выберите два разных резюме и потребность." });
    return;
  }
  const need = await ownedNeed(parsed.data.needId, context.companyId);
  if (!need) {
    res.status(404).json({ error: "Потребность не найдена." });
    return;
  }
  const raw = await Promise.all(
    [parsed.data.leftResumeId, parsed.data.rightResumeId].map((resumeId) =>
      loadResumeCandidates(context, { purpose: "owned", resumeId }),
    ),
  );
  const visible = raw
    .map((rows) => rows[0])
    .filter(
      (row) =>
        row &&
        row.visibility !== "private" &&
        (row.consentMatching || row.consentCatalog),
    );
  if (visible.length !== 2) {
    res.status(404).json({ error: "Резюме не найдены." });
    return;
  }
  const [left, right] = await withAssessmentRankingEvidence(
    await withResumeSkillEvidence(visible),
  );
  const [leftEvidence, rightEvidence] = [
    left!.skillEvidence ?? [],
    right!.skillEvidence ?? [],
  ];
  const definition = needForMatch(need);
  const evaluated = [left!, right!].map((candidate, index) => ({
    candidate: {
      ...candidate,
      skillEvidence: index ? rightEvidence : leftEvidence,
    },
    evaluation: evaluateMatch(
      definition,
      { ...candidate, skillEvidence: index ? rightEvidence : leftEvidence },
      context.demoMode,
    ),
  }));
  const overrides = new Map(
    evaluated.map((entry) => [
      entry.candidate.userId,
      entry.candidate.resumeId,
    ]),
  );
  const fullPool = await rankedNeedPool(need, context, overrides);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    needId: need.id,
    needCreatedAt: need.createdAt.toISOString(),
    algorithmVersion: MATCH_ALGORITHM_VERSION,
    left: {
      ...safeCatalogResume(left!),
      candidateId: left!.userId,
      alias: left!.alias,
      evaluation: {...evaluated[0]!.evaluation,fspSignal:presentFspSignal(evaluated[0]!.evaluation.fspSignal)},
    },
    right: {
      ...safeCatalogResume(right!),
      candidateId: right!.userId,
      alias: right!.alias,
      evaluation: {...evaluated[1]!.evaluation,fspSignal:presentFspSignal(evaluated[1]!.evaluation.fspSignal)},
    },
    ...compareResumeFacts(definition, evaluated[0]!, evaluated[1]!, fullPool),
  });
});

export default router;
