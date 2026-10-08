import { and, desc, eq, isNull } from "drizzle-orm";
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
  signalNeedSkillLevelsTable,
  signalUsersTable,
  signalShortlistTable,
} from "@workspace/db";
import { NeedPatchBody, NeedDeleteBody, contextBaseFields } from '../lib/employer-context-edit';
import { CompanyUpdateBody, companyInnUpdate } from '../lib/company-profile-input';
import { signalBankTemplateOverridesTable } from '@workspace/db';
import { CURRENT_SKILL_COVERAGE_VERSION, currentSkillCoverage } from '../lib/current-skill-coverage';
import { skillModulesEnabled } from '../lib/skill-module-service';
import { mergePresentFields, selectionContextKey } from '../lib/selection-context-contract';
import { loadSelectionCounters } from '../lib/signal-employer-context';
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
  resolveSkill,
} from "../lib/skill-catalog";
import { withAssessmentRankingEvidence } from "../lib/assessment-ranking-evidence";
import {
  loadResumeCandidates,
  rankedResumePool,
  respondRankedResumeMatches,
  withResumeSkillEvidence,
} from "../lib/signal-resume-matching";
import {
  safeCatalogResume,
  availableResumeSummary,
} from "../lib/signal-resume-catalog";
import { compareResumeFacts } from "../lib/signal-resume-comparison";
import {presentFspSignal} from '../lib/fsp-results';
import {SkillCoverageQuerySchema} from '../lib/skill-coverage-input';
import { EmployerRequiredSkills, hasMeaningfulRequiredSkills } from '../lib/employer-required-skills';
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

import { loadNeedSkillLevels, validateSkillLevelRequirements, retainedSkillLevelRequirements } from "../lib/need-skill-levels";

const router: IRouter = Router();
router.param("id", postgresIntIdParam);

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

async function needForMatch(need: typeof signalNeedsTable.$inferSelect): Promise<MatchNeed> {
  const levels = (await loadNeedSkillLevels([need.id])).get(need.id) ?? {};
  return {
    specialization: need.specialization,
    grade: need.grade as SignalGrade,
    requiredSkills: need.requiredSkills,
    requiredSkillLevels: levels,
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
    inn: company.inn??'',
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
    revision: need.revision,
    status: need.status,
    updatedAt: need.updatedAt.toISOString(),
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
        isNull(signalNeedsTable.deletedAt),
        eq(signalNeedsTable.status, 'active'),
      ),
    )
    .limit(1);
  return need ?? null;
}

async function rankedNeedPool(
  need: typeof signalNeedsTable.$inferSelect,
  context: EmployerContext,
  overrides: ReadonlyMap<number, number> = new Map(),
  onlyDefault?: {userId:number;resumeId:number},
) {
  return rankedResumePool(await needForMatch(need), context, overrides,undefined,onlyDefault);
}

async function activeSkillCoverage(skills: readonly string[]) {
  const disabled=await db.select({templateId:signalBankTemplateOverridesTable.templateId}).from(signalBankTemplateOverridesTable).where(eq(signalBankTemplateOverridesTable.status,'disabled'));
  return currentSkillCoverage(skills,{enabled:skillModulesEnabled(),disabled:new Set(disabled.map(item=>item.templateId))});
}
router.get("/skills/coverage", async (req, res): Promise<void> => {
  const query = SkillCoverageQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Проверьте требования." });
    return;
  }
  res.setHeader('Cache-Control','no-store');
  res.json({catalogVersion:CURRENT_SKILL_COVERAGE_VERSION,coverage:await activeSkillCoverage(query.data.skills.split(','))});
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
    const coverage = await activeSkillCoverage(need.requiredSkills);
    const matches = (await rankedNeedPool(need, context)).length;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      catalogVersion: CURRENT_SKILL_COVERAGE_VERSION,
      coverage,
      eligibleCount: matches,
      status: !hasMeaningfulRequiredSkills(need.requiredSkills)
        ? "invalid_requirements"
        : matches
        ? "available"
        : coverage.some((item) => !item.supported)
          ? "unsupported_requirements"
          : "no_verified_candidates",
      minimumGrade: need.grade,
      note: hasMeaningfulRequiredSkills(need.requiredSkills)
        ? "Обязательные требования сохраняются. Измените условия явно в новой потребности; неподтверждённые навыки не дают допуска."
        : "В сохранённой потребности есть пустые обязательные навыки. Подбор приостановлен. Создайте потребность с содержательными требованиями; эта запись сохранится в истории.",
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
    const innIssue=parsed.error.issues.find(issue=>issue.path[0]==='inn');
    res.status(400).json({ error: innIssue ? (typeof req.body?.inn==='string'?innIssue.message:'ИНН должен быть строкой из 10 или 12 цифр.') : "Проверьте данные профиля компании.",...(innIssue?{code:'INVALID_INN'}:{}) });
    return;
  }
  const input = parsed.data;
  const [company] = await db
    .update(signalCompaniesTable)
    .set({
      name: input.name,
      description: input.description,
      industry: input.industry,
      ...companyInnUpdate(input.inn),
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
    .where(and(eq(signalNeedsTable.companyId, context.companyId),isNull(signalNeedsTable.deletedAt)))
    .orderBy(desc(signalNeedsTable.createdAt));
  const levels = await loadNeedSkillLevels(needs.map(need => need.id));
  const counters = await loadSelectionCounters(context.companyId);
  res.setHeader('Cache-Control','no-store');
  res.json(needs.map(need => ({ ...ListEmployerNeedsResponse.parse([{...needPayload(need),requiredSkillLevels:levels.get(need.id)??{}}])[0],
    revision:need.revision,status:need.status,updatedAt:need.updatedAt.toISOString(),
    shortlistCount:counters.shortlist.get(selectionContextKey({type:'need',id:need.id}))??0 })));
});

router.post("/employer/needs", async (req, res): Promise<void> => {
  const context = await employerContext(req, res);
  if (!context) return;
  const required = EmployerRequiredSkills.safeParse(req.body?.requiredSkills);
  if (!required.success) {
    res.status(400).json({ error: "Укажите от 1 до 40 обязательных навыков: каждый должен содержать текст и не превышать 100 символов.", code: "INVALID_REQUIRED_SKILLS" });
    return;
  }
  const parsed = CreateEmployerNeedBody.safeParse({ ...req.body, requiredSkills: required.data });
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
  const levelInput = validateSkillLevelRequirements(req.body?.requiredSkillLevels, input.requiredSkills);
  if (!levelInput.success) { res.status(400).json({ error: 'Укажите допустимые уровни только для обязательных навыков.', code: 'INVALID_SKILL_LEVELS' }); return; }
  if (Object.keys(levelInput.data).length && process.env.SIGNAL_WORKSPACE_ENABLED !== 'true') { res.status(503).json({ error: 'Требования по уровням пока недоступны.' }); return; }
  const need = await db.transaction(async tx => {
    const { requiredSkillLevels: _levels, ...baseInput } = input as typeof input & { requiredSkillLevels?: unknown };
    const [created] = await tx.insert(signalNeedsTable).values({ ...baseInput, companyId: context.companyId }).returning();
    if (created && process.env.SIGNAL_WORKSPACE_ENABLED === 'true') await tx.insert(signalNeedSkillLevelsTable).values({ needId: created.id, levels: levelInput.data });
    return created;
  });
  if (!need) {
    res.status(500).json({ error: "Не удалось сохранить потребность." });
    return;
  }
  res.status(201).json({
    ...CreateEmployerNeedResponse.parse({ ...needPayload(need), requiredSkillLevels: levelInput.data }),
    revision:need.revision,status:need.status,updatedAt:need.updatedAt.toISOString(),shortlistCount:0,
    catalogVersion: CURRENT_SKILL_COVERAGE_VERSION,
    requirements: need.requiredSkills.map(resolveSkill),
    coverage: await activeSkillCoverage(need.requiredSkills),
  });
});

router.put('/employer/needs/:id', async (req,res):Promise<void> => {
  const actor = await employerContext(req,res); if(!actor)return;
  const parsed = NeedPatchBody.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:'Проверьте изменения запроса.',code:'INVALID_NEED_PATCH'});return;}
  const result = await db.transaction(async tx => {
    const [current] = await tx.select().from(signalNeedsTable).where(and(eq(signalNeedsTable.id,Number(req.params.id)),eq(signalNeedsTable.companyId,actor.companyId),isNull(signalNeedsTable.deletedAt))).for('update');
    if(!current)return {code:404 as const};
    if(current.revision!==parsed.data.revision)return {code:409 as const};
    const {revision:_revision,status,requiredSkillLevels:levelPatch,...basePatch}=parsed.data;
    const merged = CreateEmployerNeedBody.safeParse(mergePresentFields(contextBaseFields(current,CreateEmployerNeedBody.shape),basePatch));
    if(!merged.success||merged.data.salaryMin>merged.data.salaryMax)return {code:400 as const};
    const [existingLevels] = await tx.select().from(signalNeedSkillLevelsTable).where(eq(signalNeedSkillLevelsTable.needId,current.id)).limit(1);
    const preservedLevels = retainedSkillLevelRequirements(existingLevels?.levels??{},merged.data.requiredSkills);
    const validated = validateSkillLevelRequirements(levelPatch===undefined?preservedLevels:levelPatch,merged.data.requiredSkills);
    if(!validated.success)return {code:400 as const};
    const {requiredSkillLevels:_levels,...base}=merged.data;
    const [need] = await tx.update(signalNeedsTable).set({...base,status:status??current.status,revision:current.revision+1,updatedAt:new Date()})
      .where(and(eq(signalNeedsTable.id,current.id),eq(signalNeedsTable.companyId,actor.companyId),eq(signalNeedsTable.revision,parsed.data.revision))).returning();
    if(!need)return {code:409 as const};
    await tx.insert(signalNeedSkillLevelsTable).values({needId:need.id,levels:validated.data}).onConflictDoUpdate({target:signalNeedSkillLevelsTable.needId,set:{levels:validated.data}});
    if(status==='archived')await tx.delete(signalShortlistTable).where(and(eq(signalShortlistTable.companyId,actor.companyId),eq(signalShortlistTable.contextType,'need'),eq(signalShortlistTable.contextId,need.id)));
    return {need,levels:validated.data};
  });
  if(!result.need){res.status(result.code!).json({error:result.code===409?'Запрос изменился. Обновите данные и повторите сохранение.':result.code===404?'Запрос не найден.':'Проверьте требования и зарплатную вилку.',code:result.code===409?'VERSION_CONFLICT':undefined});return;}
  const counters=await loadSelectionCounters(actor.companyId);
  res.json({...needPayload(result.need),requiredSkillLevels:result.levels,shortlistCount:counters.shortlist.get(`need:${result.need.id}`)??0});
});

router.delete('/employer/needs/:id', async(req,res):Promise<void> => {
  const actor=await employerContext(req,res);if(!actor)return;
  const input=NeedDeleteBody.safeParse(req.body);if(!input.success){res.status(400).json({error:'Укажите текущую редакцию запроса.'});return;}
  const result=await db.transaction(async tx=>{
    const [current]=await tx.select().from(signalNeedsTable).where(and(eq(signalNeedsTable.id,Number(req.params.id)),eq(signalNeedsTable.companyId,actor.companyId))).for('update');
    if(!current)return 404;
    if(current.deletedAt)return 200;
    if(current.revision!==input.data.revision)return 409;
    const now=new Date();
    await tx.update(signalNeedsTable).set({deletedAt:now,status:'archived',updatedAt:now,revision:current.revision+1}).where(eq(signalNeedsTable.id,current.id));
    await tx.delete(signalShortlistTable).where(and(eq(signalShortlistTable.companyId,actor.companyId),eq(signalShortlistTable.contextType,'need'),eq(signalShortlistTable.contextId,current.id)));
    return 200;
  });
  res.status(result).json(result===200?{deleted:true}:{error:result===409?'Запрос изменился. Обновите данные.':'Запрос не найден.',code:result===409?'VERSION_CONFLICT':undefined});
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
  res.setHeader('Cache-Control','no-store');
  respondRankedResumeMatches(matches,()=>{
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
      categoryEvidence: matches[index]?.candidate.categoryEvidence ?? null,
      skillProofs: matches[index]?.candidate.skillEvidence?.filter(proof=>proof.sourceType==='signal_skill_module'&&proof.level).map(({skill,sourceType,level,programVersion})=>({skill,sourceType,level,programVersion})) ?? [],
      qualificationSource: matches[index]?.candidate.categoryEvidence?.grade===match.verifiedGrade ? 'skill_matrix' : matches[index]?.candidate.assessmentEvidence ? 'assessment' : 'legacy',
      rankingScore: matches[index]?.evaluation.rankingScore,
      salaryCompatibility: matches[index]?.evaluation.salaryCompatibility,
      ranking: matches[index]?.evaluation.ranking,
      fspSignal: presentFspSignal(matches[index]?.evaluation.fspSignal),
      scoreScope: matches[index]?.evaluation.scoreScope,
    })),
  );
  },res);
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
  const [candidate] = candidates;
  if (!need || !candidate) {
    res.status(404).json({ error: "Кандидат или потребность не найдены." });
    return;
  }
  // The addressed read checks current visibility/consent/pool ownership. The
  // full ranked pool below is the single fresh proof/evaluation pass and still
  // decides eligibility, alternatives and the original whole-pool ordinal.
  const selected = (
    await rankedNeedPool(
      need,
      context,
      new Map([[candidate.userId, candidate.resumeId]]),
      {userId:candidate.userId,resumeId:candidate.resumeId},
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
  const enriched = selected.evaluation;
  const response = GetMatchExplanationResponse.parse({
    candidateId: candidate.userId,
    resumeId: candidate.resumeId,
    resumeRevision: selected.candidate.resumeRevision,
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
    resumeRevision: selected.candidate.resumeRevision,
    title: selected.candidate.title,
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
  const definition = await needForMatch(need);
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
