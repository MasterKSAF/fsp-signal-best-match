import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import ExcelJS from 'exceljs';
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  signalJobsTable as jobs,
  signalApplicationsTable as applications,
  signalCompaniesTable as companies,
  signalUsersTable as users,
  signalCandidateProfilesTable as profiles,
  signalContactGrantsTable as grants,
  signalCandidateResumesTable as resumes,
  signalShortlistTable as shortlist,
} from "@workspace/db";
import { JobPatchBody, JobDeleteBody, JobInputShape, contextBaseFields } from '../lib/employer-context-edit';
import { mergePresentFields } from '../lib/selection-context-contract';
import { loadSelectionCounters } from '../lib/signal-employer-context';
import { opportunityActor, positiveId } from "../lib/opportunity-auth";
import { signalPoolPredicate, poolScopeForAccount } from "../lib/signal-pool-scope";
import { getSessionUser } from "../lib/signal-auth";
import { postgresIntIdParam, postgresIntIdSchema } from "../lib/postgres-id";
import {
  historicalResumeVisible,
  loadResumeCandidates,
  publicHistoricalSnapshot,
  resumeSnapshot,
} from "../lib/signal-resume-matching";
import { assertCompanyActionAllowed } from "../lib/signal-trust";
import { jobInput, jobTransitionAllowed } from "../lib/opportunity-rules";
import { signalJobRequirementsTable as requirements } from '../../../../lib/db/src/schema/signal-job-discovery';
import { skillRequirementCovered } from '../lib/skill-module-qualification';
import { getCurrentResumeWorkspaceQualification } from '../lib/skill-module-service';
import { escapeLike, jobDetailsInput, jobSearchInput, parseSkillFilters, JOB_EXPORT_COLUMNS, JOB_EXPORT_LIMIT,
  jobExportCells, jobsCsv, type JobSearchFilters } from '../lib/job-discovery';
import { personalJobFilterConditions } from '../lib/job-personal-filters';
import {
  createContactPermission,
  lockContactOwner,
  readPermittedContacts,
  revokeCompanyPermissions,
} from "../lib/signal-contact-permissions";
const router: IRouter = Router();
router.param("id", postgresIntIdParam);
const workspaceEnabled = () => process.env.SIGNAL_WORKSPACE_ENABLED === 'true';
const companyJoin = () => {
  const query = db
    .select({ job: jobs, companyName: companies.name, location: workspaceEnabled() ? requirements.location : sql<string | null>`null`, skillRequirements: workspaceEnabled() ? requirements.skillRequirements : sql<typeof requirements.$inferSelect.skillRequirements | null>`null` })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .innerJoin(users, eq(companies.ownerUserId, users.id)).$dynamic();
  return workspaceEnabled() ? query.leftJoin(requirements, eq(requirements.jobId, jobs.id)) : query;
};
const snapshot = (job: typeof jobs.$inferSelect, companyName: string) => ({
  version: job.version,
  title: job.title,
  companyName,
  description: job.description,
  specialization: job.specialization,
  grade: job.grade,
  skills: job.skills,
  workFormat: job.workFormat,
  salaryMin: job.salaryMin,
  salaryMax: job.salaryMax,
  salaryPeriod: job.salaryPeriod,
  salaryType: job.salaryType,
});
const publicJob = (row: {
  job: typeof jobs.$inferSelect;
  companyName: string;
  location?: string | null;
  skillRequirements?: typeof requirements.$inferSelect.skillRequirements | null;
}) => ({
  id: row.job.id,
  companyId: row.job.companyId,
  status: row.job.status,
  ...snapshot(row.job, row.companyName),
  publishedAt: row.job.publishedAt,
  updatedAt: row.job.updatedAt,
  location: row.location ?? '',
  skillRequirements: row.skillRequirements ?? [],
  salaryCurrency: 'RUB',
});

function jobFilterConditions(filters: JobSearchFilters, scope: ReturnType<typeof poolScopeForAccount>, actor?: { id: number; role: string } | null) {
  const conditions: SQL[] = [eq(jobs.status, 'published'), signalPoolPredicate(users, scope), ...personalJobFilterConditions(filters, actor)];
  if (filters.q) conditions.push(or(ilike(jobs.title, `%${escapeLike(filters.q)}%`), ilike(companies.name, `%${escapeLike(filters.q)}%`))!);
  if (filters.specialization) conditions.push(eq(jobs.specialization, filters.specialization));
  if (filters.grade) conditions.push(eq(jobs.grade, filters.grade));
  if (filters.workFormat) conditions.push(eq(jobs.workFormat, filters.workFormat));
  if (filters.location) conditions.push(ilike(requirements.location, `%${escapeLike(filters.location)}%`));
  const multiplier = filters.salaryPeriod === 'year' ? 12 : 1;
  const normalizedMin = sql`case when ${jobs.salaryPeriod}='year' then ${jobs.salaryMin}::numeric/12 else ${jobs.salaryMin} end * ${multiplier}`;
  const normalizedMax = sql`case when ${jobs.salaryPeriod}='year' then ${jobs.salaryMax}::numeric/12 else ${jobs.salaryMax} end * ${multiplier}`;
  if (filters.salaryMin !== undefined) conditions.push(gte(normalizedMax, filters.salaryMin));
  if (filters.salaryMax !== undefined) conditions.push(lte(normalizedMin, filters.salaryMax));
  for (const skill of parseSkillFilters(filters.skills)) {
    const level = ({ Junior: 1, Middle: 2, Senior: 3 } as const)[skill.level ?? 'Junior'];
    conditions.push(sql`(exists(select 1 from jsonb_array_elements(coalesce(${requirements.skillRequirements},'[]'::jsonb)) as r where lower(r->>'skill')=lower(${skill.skill})
      and (${skill.level ?? null}::text is null or (case r->>'level' when 'Junior' then 1 when 'Middle' then 2 when 'Senior' then 3 else 0 end)>=${level}))
      or (${skill.level ?? null}::text is null and exists(select 1 from unnest(${jobs.skills}) s where lower(s)=lower(${skill.skill}))))`);
  }
  return and(...conditions)!;
}
function jobSearchOrder(sort: JobSearchFilters['sort']) {
  const salary = sql`case when ${jobs.salaryPeriod}='year' then ${jobs.salaryMax}::numeric/12 else ${jobs.salaryMax} end`;
  return sort === 'salary_desc' ? [desc(salary), desc(jobs.id)] : sort === 'salary_asc' ? [asc(salary), asc(jobs.id)] :
    sort === 'oldest' ? [asc(jobs.publishedAt), asc(jobs.id)] : [desc(jobs.publishedAt), desc(jobs.id)];
}
async function filteredJobCount(condition: SQL) {
  const [row] = await db.select({ total: count() }).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id))
    .innerJoin(users, eq(companies.ownerUserId, users.id)).leftJoin(requirements, eq(requirements.jobId, jobs.id)).where(condition);
  return row.total;
}
async function jobResumeContext(userId: number, resumeId: number) {
  const [resume] = await db.select().from(resumes).where(and(eq(resumes.userId,userId),eq(resumes.id,resumeId),isNull(resumes.deletedAt))).limit(1);
  if (!resume) return null;
  return { resume, qualification:await getCurrentResumeWorkspaceQualification(resume) };
}
function withJobCoverage(job: ReturnType<typeof publicJob>, context: Awaited<ReturnType<typeof jobResumeContext>>) {
  if (!context) return job;
  const explicit = new Map(job.skillRequirements.map(item=>[item.skill.toLowerCase(),item]));
  const expected = [...new Set([...job.skills,...job.skillRequirements.map(item=>item.skill)])].map(skill=>explicit.get(skill.toLowerCase())??{skill});
  return { ...job,skillCoverage:{verified:expected.filter(item=>skillRequirementCovered(item,context.qualification.skills)).length,required:expected.length},
    gradeRequirement:{required:job.grade,verified:context.qualification.verifiedGrade,specializationMatches:context.resume.specialization===job.specialization} };
}
router.get('/public/jobs/search', async (req, res) => {
  if (!workspaceEnabled()) { res.status(503).json({ error: 'Новая выдача доступна на отдельном стенде Signal.' }); return; }
  const parsed = jobSearchInput.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Проверьте параметры фильтра.', details: parsed.error.flatten() }); return; }
  const session = await getSessionUser(req), filters = parsed.data;
  const context = session?.user.role==='candidate' && filters.resumeId ? await jobResumeContext(session.user.id,filters.resumeId) : null;
  if (session?.user.role==='candidate' && filters.resumeId && !context) { res.status(404).json({error:'Выбранное резюме недоступно.'});return; }
  const condition = jobFilterConditions(filters, poolScopeForAccount(session?.user ?? false), session?.user);
  const total = await filteredJobCount(condition);
  const page = Math.min(filters.page,Math.max(1,Math.ceil(total/filters.pageSize)));
  const rows = await companyJoin().where(condition).orderBy(...jobSearchOrder(filters.sort)).limit(filters.pageSize).offset((page-1)*filters.pageSize);
  // Browsing and sending an explicitly consented application do not award a grade.
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items: rows.map(row=>withJobCoverage(publicJob(row),context)), total, page, pageSize: filters.pageSize, pageCount: Math.ceil(total/filters.pageSize), exportLimit: JOB_EXPORT_LIMIT,
    applicationPolicy: 'Можно откликнуться с собственным резюме. Требования компании показываются отдельно; отклик не подтверждает квалификацию.' });
});
router.get('/public/jobs/export', async (req, res) => {
  if (!workspaceEnabled()) { res.status(503).json({ error: 'Выгрузка доступна на отдельном стенде Signal.' }); return; }
  const parsed = jobSearchInput.safeParse(req.query), format = z.enum(['csv', 'xlsx']).safeParse(req.query.format);
  if (!parsed.success || !format.success) { res.status(400).json({ error: 'Проверьте фильтры и формат выгрузки.' }); return; }
  const session = await getSessionUser(req), condition = jobFilterConditions(parsed.data, poolScopeForAccount(session?.user ?? false), session?.user);
  const total = await filteredJobCount(condition);
  if (total > JOB_EXPORT_LIMIT) { res.status(422).json({ error: `Найдено ${total} вакансий. Предел выгрузки — ${JOB_EXPORT_LIMIT}; уточните фильтры.`, total, exportLimit: JOB_EXPORT_LIMIT }); return; }
  const rows = (await companyJoin().where(condition).orderBy(...jobSearchOrder(parsed.data.sort)).limit(JOB_EXPORT_LIMIT + 1)).map(publicJob);
  if (rows.length > JOB_EXPORT_LIMIT) { res.status(422).json({ error: 'Выдача изменилась и превышает предел. Уточните фильтры.', total: rows.length, exportLimit: JOB_EXPORT_LIMIT }); return; }
  const base = process.env.PUBLIC_URL || 'http://localhost:4368';
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Export-Row-Count', String(rows.length));
  res.setHeader('Content-Disposition', `attachment; filename="signal-jobs.${format.data}"`);
  if (format.data === 'csv') { res.type('text/csv; charset=utf-8').send(jobsCsv(rows, base)); return; }
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'Signal';
  const sheet = workbook.addWorksheet('Вакансии', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = JOB_EXPORT_COLUMNS.map((header, index) => ({ header, key: String(index), width: [24,35,25,15,55,18,18,12,14,17,18,25,25,55][index] }));
  for (const job of rows) sheet.addRow(jobExportCells(job, base));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFF2ECE6' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF402FFF' } };
  sheet.autoFilter = { from: 'A1', to: `N${Math.max(1, rows.length+1)}` }; sheet.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true }; });
  // Every data value is assigned as a string, never as ExcelJS formula objects.
  const bytes = await workbook.xlsx.writeBuffer();
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(bytes));
});

router.get("/public/jobs", async (req, res) => {
  const session = await getSessionUser(req);
  const scope = poolScopeForAccount(session?.user ?? false);
  const rows = await companyJoin()
    .where(and(eq(jobs.status, "published"), signalPoolPredicate(users, scope)))
    .orderBy(desc(jobs.publishedAt), desc(jobs.id)).limit(200);
  res.json(rows.map(publicJob));
});
router.get("/public/jobs/:id", async (req, res) => {
  const session = await getSessionUser(req);
  const [row] = await companyJoin()
    .where(
      and(
        eq(jobs.id, positiveId(req.params.id)),
        eq(jobs.status, "published"),
        signalPoolPredicate(users, poolScopeForAccount(session?.user ?? false)),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Вакансия не найдена или закрыта." });
    return;
  }
  res.json(publicJob(row));
});
router.get("/employer/jobs", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const [rows,counters] = await Promise.all([
    companyJoin().where(and(eq(jobs.companyId, actor.company.id),isNull(jobs.deletedAt))).orderBy(desc(jobs.updatedAt),desc(jobs.id)),
    loadSelectionCounters(actor.company.id),
  ]);
  res.setHeader('Cache-Control','no-store');
  res.json(rows.map(row=>({...publicJob(row),shortlistCount:counters.shortlist.get(`job:${row.job.id}`)??0,applicationCount:counters.applications.get(row.job.id)??0})));
});
router.post("/employer/jobs", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const { location, skillRequirements, ...base } = req.body ?? {};
  const input = jobInput.safeParse(base), details = jobDetailsInput.safeParse({ location, skillRequirements });
  if (!input.success || !details.success || details.data.skillRequirements?.some(item => !input.data.skills.some(skill => skill.toLowerCase()===item.skill.toLowerCase()))) {
    res.status(400).json({
      error: "Заполните условия, описание и зарплатную вилку в рублях.",
    });
    return;
  }
  const job = await db.transaction(async tx => {
    const [created] = await tx.insert(jobs).values({ ...input.data, companyId: actor.company!.id }).returning();
    if (workspaceEnabled()) await tx.insert(requirements).values({ jobId: created.id, ...details.data });
    return created;
  });
  res.status(201).json(publicJob({ job, companyName: actor.company.name, ...details.data }));
});
router.put("/employer/jobs/:id", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const patch = JobPatchBody.safeParse(req.body);
  if (!patch.success) {
    res.status(400).json({ error: "Проверьте условия вакансии." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, positiveId(req.params.id)),
          eq(jobs.companyId, actor.company!.id),
          isNull(jobs.deletedAt),
        ),
      )
      .for("update");
    if (!current || current.status === "archived") return {code:404 as const};
    if(current.version!==patch.data.version)return {code:409 as const};
    const {version:_version,location,skillRequirements,...basePatch}=patch.data;
    const input = jobInput.safeParse(mergePresentFields(contextBaseFields(current,JobInputShape),basePatch));
    if(!input.success || skillRequirements?.some(item=>!input.data.skills.some(skill=>skill.toLowerCase()===item.skill.toLowerCase())))return {code:400 as const};
    const [updated] = await tx
      .update(jobs)
      .set({
        ...input.data,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, current.id),eq(jobs.companyId,actor.company!.id),eq(jobs.version,patch.data.version)))
      .returning();
    // Omitted add-on fields preserve the current requirements. No legacy level is inferred.
    if (workspaceEnabled()) {
    const [existingDetails] = await tx.select().from(requirements).where(eq(requirements.jobId, current.id)).limit(1);
    const nextDetails = { location: location ?? existingDetails?.location ?? '',
      skillRequirements: (skillRequirements ?? existingDetails?.skillRequirements ?? []).filter(item => input.data.skills.some(skill => skill.toLowerCase()===item.skill.toLowerCase())) };
    await tx.insert(requirements).values({ jobId: current.id, ...nextDetails }).onConflictDoUpdate({ target: requirements.jobId, set: nextDetails });
    }
    return {job:updated};
  });
  if (!result.job) {
    res.status(result.code??409).json({ error: result.code===409?'Вакансия изменилась. Обновите данные и повторите сохранение.':result.code===400?'Проверьте требования и зарплатную вилку.':"Вакансия недоступна для изменения.",code:result.code===409?'VERSION_CONFLICT':undefined });
    return;
  }
  const job=result.job;
  const [jobDetails] = workspaceEnabled() ? await db.select().from(requirements).where(eq(requirements.jobId, job.id)).limit(1) : [];
  res.json(publicJob({ job, companyName: actor.company.name, ...jobDetails }));
});
router.post("/employer/jobs/:id/status", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = z
    .object({ status: z.enum(["published", "closed", "archived"]), version:postgresIntIdSchema.optional() })
    .strict()
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Некорректный статус." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, positiveId(req.params.id)),
          eq(jobs.companyId, actor.company!.id),
          isNull(jobs.deletedAt),
        ),
      )
      .for("update");
    if (!job) return { code: 404 as const };
    if(input.data.version!==undefined && job.version!==input.data.version)return {code:409 as const,restrictionCode:'VERSION_CONFLICT'};
    if (input.data.status === "published") {
      const permission = await assertCompanyActionAllowed(
        actor.company!.id,
        undefined,
        tx,
        "publishing",
      );
      if (!permission.allowed)
        return {
          code: 403 as const,
          publicReason: permission.publicReason,
          restrictionCode: permission.code,
          retryAt: permission.retryAt,
        };
    }
    if (!jobTransitionAllowed(job.status, input.data.status))
      return { code: 409 as const };
    if (job.status === input.data.status) return { job };
    const [updated] = await tx
      .update(jobs)
      .set({
        status: input.data.status,
        version:job.version+1,
        updatedAt: new Date(),
        ...(input.data.status === "published"
          ? { publishedAt: new Date() }
          : {}),
      })
      .where(eq(jobs.id, job.id))
      .returning();
    if(input.data.status==='archived')await tx.delete(shortlist).where(and(eq(shortlist.companyId,actor.company!.id),eq(shortlist.contextType,'job'),eq(shortlist.contextId,job.id)));
    return { job: updated };
  });
  if (!result.job) {
    res.status(result.code!).json({
      error: result.publicReason ?? "Этот переход недоступен.",
      code: result.restrictionCode ?? null,
      retryAt: result.retryAt ?? null,
    });
    return;
  }
  res.json(publicJob({ job: result.job, companyName: actor.company.name }));
});

router.post("/jobs/:id/applications", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const input = z
    .object({
      message: z.string().trim().max(2000).default(""),
      consentDisclosure: z.literal(true),
      companyId: postgresIntIdSchema,
      jobVersion: z.number().int().positive(),
      resumeId: postgresIntIdSchema,
    })
    .strict()
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
      error:
        "Подтвердите передачу имени, email, телефона и профессионального профиля выбранной компании.",
    });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, input.data.companyId))
      .for("update");
    await lockContactOwner(tx, actor.userId);
    const permission = await assertCompanyActionAllowed(
      input.data.companyId,
      actor.userId,
      tx,
      "contacts",
    );
    if (!permission.allowed)
      return {
        error: 403,
        code: permission.code,
        publicReason: permission.publicReason,
        retryAt: permission.retryAt,
      };
    const [resume] = await loadResumeCandidates(
      actor,
      { purpose: "owned", userId: actor.userId, resumeId: input.data.resumeId },
      tx,
    );
    if (!resume) return { error: 404 };
    const [existing] = await tx
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.jobId, positiveId(req.params.id)),
          eq(applications.candidateUserId, actor.userId),
        ),
      )
      .limit(1);
    if (existing)
      return existing.companyId !== input.data.companyId
        ? { error: 404 }
        : existing.resumeId !== input.data.resumeId
          ? {
              error: 409,
              code: "ALREADY_APPLIED_WITH_RESUME",
              publicReason:
                "На эту вакансию уже отправлен отклик с другим резюме.",
            }
          : { application: existing, created: false };
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, positiveId(req.params.id)))
      .for("update");
    if (
      !job ||
      job.status !== "published" ||
      job.companyId !== input.data.companyId
    )
      return { error: 404 };
    if (job.version !== input.data.jobVersion) return { error: 409 };
    const [company] = await tx
      .select({ name: companies.name })
      .from(companies)
      .innerJoin(users, eq(companies.ownerUserId, users.id))
      .where(
        and(
          eq(companies.id, job.companyId),
          signalPoolPredicate(users, actor),
        ),
      )
      .limit(1);
    if (!company) return { error: 404 };
    const [jobDetails] = workspaceEnabled() ? await tx.select().from(requirements).where(eq(requirements.jobId,job.id)).limit(1) : [];
    const jobSnapshot = { ...snapshot(job, company.name),location:jobDetails?.location??'',skillRequirements:jobDetails?.skillRequirements??[],salaryCurrency:'RUB' };
    const [application] = await tx
      .insert(applications)
      .values({
        jobId: job.id,
        companyId: job.companyId,
        candidateUserId: actor.userId,
        message: input.data.message,
        snapshot: jobSnapshot,
        resumeId: resume.resumeId,
        resumeSnapshot: resumeSnapshot(resume),
      })
      .returning();
    await createContactPermission(tx, actor.userId, job.companyId, {
      applicationId: application.id,
    });
    return { application, created: true };
  });
  if (!result.application) {
    res.status(result.error!).json({
      code: result.code ?? null,
      retryAt: result.retryAt ?? null,
      error:
        result.publicReason ??
        (result.error === 409
          ? "Условия изменились. Откройте вакансию заново и подтвердите актуальные условия."
          : "Вакансия не принимает отклики."),
    });
    return;
  }
  res.status(result.created ? 201 : 200).json(result.application);
});

router.get('/me/applications/search', async (req, res) => {
  const actor = await opportunityActor(req, res, 'candidate'); if (!actor) return;
  const parsed = z.object({ q: z.string().trim().max(160).optional().default(''),
    status: z.enum(['', 'sent', 'viewed', 'shortlisted', 'declined', 'withdrawn']).optional().default(''),
    resumeId: z.coerce.number().int().positive().max(2147483647).optional(),
    sort: z.enum(['newest', 'oldest']).optional().default('newest'),
    page: z.coerce.number().int().min(1).max(1000000).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  }).passthrough().safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Проверьте фильтры откликов.' }); return; }
  const filters = parsed.data, conditions: SQL[] = [eq(applications.candidateUserId, actor.userId)];
  if (filters.q) conditions.push(sql`(${applications.snapshot}->>'companyName' ilike ${`%${escapeLike(filters.q)}%`} or ${applications.snapshot}->>'title' ilike ${`%${escapeLike(filters.q)}%`})`);
  if (filters.status) conditions.push(eq(applications.status, filters.status));
  if (filters.resumeId) conditions.push(eq(applications.resumeId, filters.resumeId));
  const condition = and(...conditions), [totals] = await db.select({ total: count() }).from(applications).where(condition);
  const page = Math.min(filters.page,Math.max(1,Math.ceil(totals.total/filters.pageSize)));
  const order = filters.sort === 'oldest' ? [asc(applications.createdAt), asc(applications.id)] : [desc(applications.createdAt), desc(applications.id)];
  const rows = await db.select({ application: applications, contactShared: grants.id }).from(applications)
    .leftJoin(grants, and(eq(grants.applicationId, applications.id), isNull(grants.revokedAt)))
    .where(condition).orderBy(...order).limit(filters.pageSize).offset((page-1)*filters.pageSize);
  res.setHeader('Cache-Control','no-store');
  res.json({ items: rows.map(row=>({ ...row.application, contactShared: !!row.contactShared })), total: totals.total,
    page, pageSize: filters.pageSize, pageCount: Math.ceil(totals.total/filters.pageSize) });
});

router.delete('/employer/jobs/:id', async(req,res)=>{
  const actor=await opportunityActor(req,res,'employer');if(!actor?.company)return;
  const input=JobDeleteBody.safeParse(req.body);if(!input.success){res.status(400).json({error:'Укажите текущую редакцию вакансии.'});return;}
  const result=await db.transaction(async tx=>{
    const [job]=await tx.select().from(jobs).where(and(eq(jobs.id,positiveId(req.params.id)),eq(jobs.companyId,actor.company!.id))).for('update');
    if(!job)return 404;
    if(job.deletedAt)return 200;
    if(job.version!==input.data.version)return 409;
    const now=new Date();
    await tx.update(jobs).set({deletedAt:now,status:'archived',version:job.version+1,updatedAt:now}).where(eq(jobs.id,job.id));
    await tx.delete(shortlist).where(and(eq(shortlist.companyId,actor.company!.id),eq(shortlist.contextType,'job'),eq(shortlist.contextId,job.id)));
    return 200;
  });
  res.status(result).json(result===200?{deleted:true}:{error:result===409?'Вакансия изменилась. Обновите данные.':'Вакансия не найдена.',code:result===409?'VERSION_CONFLICT':undefined});
});
router.get("/me/applications", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const rows = await db
    .select({ application: applications, contactShared: grants.id })
    .from(applications)
    .leftJoin(
      grants,
      and(eq(grants.applicationId, applications.id), isNull(grants.revokedAt)),
    )
    .where(eq(applications.candidateUserId, actor.userId))
    .orderBy(desc(applications.createdAt), desc(applications.id));
  res.json(
    rows.map((r) => ({ ...r.application, contactShared: !!r.contactShared })),
  );
});
router.get("/employer/applications", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const rows = await db
    .select({
      application: applications,
      alias: profiles.professionalAlias,
      specialization: profiles.specialization,
      verifiedGrade: profiles.verifiedGrade,
      contactShared: grants.id,
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.candidateUserId))
    .innerJoin(profiles, eq(profiles.userId, applications.candidateUserId))
    .leftJoin(
      grants,
      and(eq(grants.applicationId, applications.id), isNull(grants.revokedAt)),
    )
    .where(
      and(
        eq(applications.companyId, actor.company.id),
        signalPoolPredicate(users, actor),
      ),
    )
    .orderBy(desc(applications.createdAt));
  // A revoked application still has its non-identifying lifecycle and original job
  // conditions; professional profile details and the cover message are withheld.
  res.setHeader("Cache-Control", "no-store");
  res.json(
    await Promise.all(
      rows.map(async (r) => {
        const permission = await assertCompanyActionAllowed(
          actor.company!.id,
          r.application.candidateUserId,
          db,
          "contacts",
        );
        const visible =
          r.contactShared &&
          permission.allowed &&
          (await historicalResumeVisible(
            r.application.candidateUserId,
            r.application.resumeId,
            actor,
          ));
        const professional = visible
          ? publicHistoricalSnapshot(r.application.resumeSnapshot)
          : null;
        return {
          ...r.application,
          candidateUserId: undefined,
          resumeSnapshot: professional,
          message: visible ? r.application.message : "",
          candidate: professional
            ? {
                alias: r.alias,
                specialization: professional.specialization,
                verifiedGrade: professional.verifiedGrade,
                resumeId: professional.resumeId,
                resumeRevision: professional.revision,
              }
            : null,
          contactShared: !!r.contactShared && permission.allowed,
        };
      }),
    ),
  );
});
router.post("/employer/applications/:id/status", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = z
    .object({ status: z.enum(["viewed", "shortlisted", "declined"]) })
    .strict()
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Некорректный статус." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.id, positiveId(req.params.id)),
          eq(applications.companyId, actor.company!.id),
        ),
      )
      .for("update");
    if (!row) return null;
    if (row.status === input.data.status) return row;
    if (
      ["withdrawn", "declined"].includes(row.status) ||
      (input.data.status === "viewed" && row.status !== "sent")
    )
      return null;
    const [updated] = await tx
      .update(applications)
      .set({ status: input.data.status, updatedAt: new Date() })
      .where(eq(applications.id, row.id))
      .returning();
    return updated;
  });
  if (!result) {
    res.status(409).json({ error: "Отклик недоступен для этого действия." });
    return;
  }
  res.json({ id: result.id, status: result.status, resumeId: result.resumeId });
});
router.get("/employer/applications/:id/contacts", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const [application] = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.id, positiveId(req.params.id)),
        eq(applications.companyId, actor.company.id),
      ),
    )
    .limit(1);
  const contact = application
    ? await db.transaction(async (tx) => {
        const permission = await assertCompanyActionAllowed(
          actor.company!.id,
          application.candidateUserId,
          tx,
          "contacts",
        );
        if (
          !permission.allowed ||
          !(await historicalResumeVisible(
            application.candidateUserId,
            application.resumeId,
            actor,
            tx,
          ))
        )
          return null;
        return readPermittedContacts(
          tx,
          application.candidateUserId,
          actor.company!.id,
          actor,
          { applicationId: application.id },
        );
      })
    : null;
  if (!contact) {
    res
      .status(403)
      .json({ error: "Доступ к контактам отсутствует или отозван." });
    return;
  }
  res.json(contact);
});
router.post("/me/applications/:id/withdraw", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const row = await db.transaction(async (tx) => {
    await lockContactOwner(tx, actor.userId);
    const [application] = await tx
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.id, positiveId(req.params.id)),
          eq(applications.candidateUserId, actor.userId),
        ),
      )
      .for("update");
    if (!application) return null;
    await revokeCompanyPermissions(tx, actor.userId, application.companyId);
    const [updated] = await tx
      .update(applications)
      .set({
        status: "withdrawn",
        updatedAt:
          application.status === "withdrawn"
            ? application.updatedAt
            : new Date(),
      })
      .where(eq(applications.id, application.id))
      .returning();
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Отклик не найден." });
    return;
  }
  res.json(row);
});
router.get("/me/contact-permissions", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  res.json(
    await db
      .select({
        id: grants.id,
        companyId: grants.companyId,
        companyName: companies.name,
        invitationId: grants.invitationId,
        applicationId: grants.applicationId,
        consentedAt: grants.consentedAt,
        revokedAt: grants.revokedAt,
      })
      .from(grants)
      .innerJoin(companies, eq(companies.id, grants.companyId))
      .where(eq(grants.candidateUserId, actor.userId)),
  );
});
router.post("/me/contact-permissions/:id/revoke", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  await db.transaction((tx) =>
    revokeCompanyPermissions(tx, actor.userId, positiveId(req.params.id)),
  );
  res.json({
    message:
      "Все основания доступа этой компании отозваны. Новая передача возможна только по новому явному действию.",
  });
});
export default router;
