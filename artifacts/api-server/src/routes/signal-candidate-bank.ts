import { skillModulesEnabled } from '../lib/skill-module-service';
import { loadNeedSkillLevels } from '../lib/need-skill-levels';
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  signalCompaniesTable as companies,
  signalNeedsTable as needs,
} from "@workspace/db";
import { SKILL_CATALOG_VERSION } from "../lib/skill-catalog";
import { getSessionUser } from "../lib/signal-auth";
import { poolScopeForAccount } from "../lib/signal-pool-scope";
import {
  postgresIntIdInputSchema,
  postgresIntIdParam,
} from "../lib/postgres-id";
import {
  loadResumeCandidates,
  withResumeSkillEvidence,
  withResumePhotos,
} from "../lib/signal-resume-matching";
import { withAssessmentRankingEvidence } from "../lib/assessment-ranking-evidence";
import { evaluateResumeCandidates } from "../lib/signal-resume-evaluation";
import { catalogueComputation } from '../lib/signal-catalog-computation';
import {presentFspSignal} from '../lib/fsp-results';
import {
  evaluateMatch,
  rankMatches,
  type MatchNeed,
} from "../lib/signal-matching";
import {
  CATALOG_POLICY_VERSION,
  availableResumeSummary,
  catalogVisible,
  deduplicateResumes,
  factBadges,
  matchesCatalogFilters,
  prepareCatalogFilters,
  orderCatalog,
  isCatalogConfirmed,
  safeCatalogResume,
  selectMatchingResumes,
  type CatalogResume,
} from "../lib/signal-resume-catalog";

const router: IRouter = Router();
router.param("resumeId", postgresIntIdParam);
const BankQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    specialization: z.string().trim().max(120).optional(),
    grade: z.enum(["Junior", "Middle", "Senior", "unconfirmed"]).optional(),
    skill: z.string().trim().max(80).optional(),
    skills: z.string().max(1600).optional(),
    fsp: z.enum(["yes", "no"]).optional(),
    experienceMin: z.coerce.number().int().min(0).max(80).optional(),
    experienceMax: z.coerce.number().int().min(0).max(80).optional(),
    workFormat: z.string().trim().max(120).optional(),
    salaryMin: z.coerce.number().int().min(0).max(2000000000).optional(),
    salaryMax: z.coerce.number().int().min(0).max(2000000000).optional(),
    salaryPeriod: z.enum(["month", "year"]).optional(),
    salaryType: z.enum(["gross", "net"]).optional(),
    hasPhoto: z.enum(["yes", "no"]).optional(),
    readyForOffers: z.enum(["yes", "no"]).optional(),
    checkedWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
    needId: postgresIntIdInputSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      (v.salaryMin !== undefined || v.salaryMax !== undefined) &&
      (!v.salaryPeriod || !v.salaryType)
    )
      c.addIssue({
        code: "custom",
        message: "Для зарплаты укажите период и gross/net.",
      });
    if ((v.salaryMin ?? 0) > (v.salaryMax ?? Number.MAX_SAFE_INTEGER))
      c.addIssue({ code: "custom", message: "Проверьте зарплатный диапазон." });
    if ((v.experienceMin ?? 0) > (v.experienceMax ?? 80))
      c.addIssue({ code: "custom", message: "Проверьте опыт." });
  });
const pageSize = 24;
async function card(
  resume: CatalogResume,
  alternatives: CatalogResume[],
  now: Date,
) {
  const evidence = resume.skillEvidence ?? [];
  return {
    ...safeCatalogResume(resume),
    candidateId: resume.userId,
    alias: resume.alias,
    publicName: resume.visibility === "public" ? resume.publicName : null,
    avatarDataUrl: resume.visibility === "public" ? resume.avatarDataUrl : null,
    fspHistory: resume.hasFspHistory,
    skillEvidence: evidence,
    categoryEvidence: resume.categoryEvidence?.grade === resume.verifiedGrade ? resume.categoryEvidence : null,
    badges: factBadges(evidence, now),
    qualificationBasis: resume.assessmentEvidence
      ? {
          programId: resume.assessmentEvidence.programId,
          programVersion: resume.assessmentEvidence.programVersion,
          rubricKey: resume.assessmentEvidence.rubricKey,
          state: resume.assessmentEvidence.state,
        }
      : null,
    availableResumes: alternatives.map(availableResumeSummary),
  };
}
router.get("/employer/candidates", async (req, res): Promise<void> => {
  const session = await getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Войдите в аккаунт работодателя." });
    return;
  }
  if (session.user.role !== "employer") {
    res.status(403).json({ error: "Этот раздел доступен работодателю." });
    return;
  }
  const parsed = BankQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Проверьте фильтры поиска, период зарплаты и gross/net.",
    });
    return;
  }
  const input = parsed.data,
    now = new Date();
  const raw = await loadResumeCandidates(poolScopeForAccount(session.user), {
    purpose: "catalog",
    immutableProjection:true,
  });
  const legacyEnriched = await withAssessmentRankingEvidence(raw, db, undefined, {
    mutateLocalProjection: true,
  });
  const enriched = skillModulesEnabled() ? await withResumeSkillEvidence(legacyEnriched,db,{includePhotos:false}) : legacyEnriched;
  const {page:_page,needId:_needId,...filterInput}=input;
  const filters = {
    ...filterInput,
    skills: input.skills
      ?.split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  };
  const computation=catalogueComputation(enriched,filters,poolScopeForAccount(session.user),now,!input.needId,Boolean(input.needId));
  const {visible,filtered}=computation;
  let people=computation.people,order=computation.order,orderNote=computation.orderNote;
  const matchByResume = new Map<number, ReturnType<typeof evaluateMatch>>();
  if (input.needId) {
    const [company] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.ownerUserId, session.user.id))
      .limit(1);
    const [need] = company
      ? await db
          .select()
          .from(needs)
          .where(
            and(eq(needs.id, input.needId), eq(needs.companyId, company.id)),
          )
          .limit(1)
      : [];
    if (!need) {
      res.status(404).json({ error: "Потребность не найдена." });
      return;
    }
    const definition: MatchNeed = { ...need, grade: need.grade, requiredSkillLevels: (await loadNeedSkillLevels([need.id])).get(need.id) ?? {} };
    const entries = evaluateResumeCandidates(
      definition,
      filtered,
      session.demoMode,
      now,
    ).filter((entry) => entry.evaluation.eligible);
    const ranked = rankMatches(selectMatchingResumes(entries));
    people = ranked.map((row) => {
      matchByResume.set(row.candidate.resumeId, row.evaluation);
      return { selected: row.candidate, alternatives: row.alternatives };
    });
    order = "need-fit";
    orderNote =
      "Соответствие выбранной потребности по действующей формуле Signal; один человек занимает одно место.";
  }
  const start = (input.page - 1) * pageSize;
  const pagePeople = people.slice(start, start + pageSize);
  const selectedPage=pagePeople.map(person=>person.selected);
  const proofRows=skillModulesEnabled()?await withResumePhotos(selectedPage):await withResumeSkillEvidence(selectedPage);
  const candidates = await Promise.all(
    pagePeople.map(async (person, index) => ({
      ...(await card(proofRows[index]!, person.alternatives, now)),
      whySuitable: matchByResume.get(person.selected.resumeId)?.strengths ?? [
        "Все выбранные фильтры совпали в этом резюме.",
      ],
      matching: matchByResume.has(person.selected.resumeId)?{...matchByResume.get(person.selected.resumeId)!,fspSignal:presentFspSignal(matchByResume.get(person.selected.resumeId)!.fspSignal)}:null,
    })),
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({
    candidates,
    catalogVersion: SKILL_CATALOG_VERSION,
    policyVersion: CATALOG_POLICY_VERSION,
    availableTotal: computation.availableTotal,
    total: people.length,
    page: input.page,
    pageSize,
    order,
    orderNote,
    confirmedOrder: input.needId ? 'need-fit' : computation.confirmedOrder,
    confirmedTotal: input.needId ? people.filter(person=>isCatalogConfirmed(person.selected)).length : computation.confirmedTotal,
    unconfirmedTotal: input.needId ? people.filter(person=>!isCatalogConfirmed(person.selected)).length : computation.unconfirmedTotal,
    specializations: computation.specializations,
  });
});
router.get(
  "/employer/candidates/:resumeId",
  async (req, res): Promise<void> => {
    const session = await getSessionUser(req);
    if (!session) {
      res.status(401).json({ error: "Войдите в аккаунт." });
      return;
    }
    if (session.user.role !== "employer") {
      res.status(403).json({ error: "Этот раздел доступен работодателю." });
      return;
    }
    const id = postgresIntIdInputSchema.safeParse(req.params.resumeId);
    const rows = id.success
      ? await loadResumeCandidates(poolScopeForAccount(session.user), {
          purpose: "catalog",
          resumeId: id.data,
        })
      : [];
    const [candidate] = await withAssessmentRankingEvidence(
      await withResumeSkillEvidence(rows),
    );
    if (!candidate || !catalogVisible(candidate, session.demoMode)) {
      res.status(404).json({ error: "Резюме не найдено." });
      return;
    }
    const current =
      candidate.assessmentEvidence?.state === "revoked"
        ? {
            ...candidate,
            verifiedGrade: null,
            verifiedScore: null,
            verifiedSkills: [],
            latestAssessmentAt: null,
          }
        : candidate;
    res.setHeader("Cache-Control", "no-store");
    res.json(await card(current, [current], new Date()));
  },
);
export default router;
