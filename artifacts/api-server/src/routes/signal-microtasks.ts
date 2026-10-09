import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, lte, ne, notExists, or } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import {
  db,
  signalMicroTemplatesTable as templates,
  signalMicroPreferencesTable as preferences,
  signalMicroSubscriptionsTable as subscriptions,
  signalMicroOffersTable as offers,
  signalCompaniesTable as companies,
  signalUsersTable as users,
  signalCandidateProfilesTable as profiles,
  signalCandidateResumesTable as resumes,
  signalCompanyBlocksTable as blocks,
  signalEmployerRestrictionsTable as restrictions,
  signalJobsTable as jobs,
} from "@workspace/db";
import { MICRO_LIMITS } from "../lib/opportunity-rules";
import { opportunityActor, positiveId } from "../lib/opportunity-auth";
import { poolScopeForAccount, signalPoolPredicate } from "../lib/signal-pool-scope";
import { decodeRecipientCursor, encodeRecipientCursor, microRecipientQuery, recipientCursorContext, recipientSearch } from "../lib/microtask-recipient-query";
import { postgresIntIdParam, postgresIntIdSchema } from "../lib/postgres-id";
import { type ContactTransaction } from "../lib/signal-contact-permissions";
import { assertCompanyActionAllowed, type TrustAction } from "../lib/signal-trust";
import { runMicrotaskScheduler } from "../lib/microtask-scheduler";
import { captureMicroResume, microTemplateInput, MICRO_LEGACY_LIMITATION, MICRO_RESUME_UNAVAILABLE } from "../lib/microtask-resume-policy";
import { microBindingAvailable, revokeMicrotasksForResume, lockMicrotaskOwner, type MicrotaskResumeWriter } from "../lib/microtask-resume";
import { companyOfferReadable, loadCompanyOfferAccess, loadCompanyOfferReadability } from "../lib/microtask-company-read";
import { microAnswerSubmitted, microOfferQuery, microTemplateUpdateInput, microWorkspacePageQuery, microAnswerMatches, microAnswerCounters, microWorkspacePage } from "../lib/microtask-workspace-policy";
import {readCompanyMicroAnswers,readCompanyMicroRecipients} from '../lib/microtask-workspace-read';
import {loadMicroJob,offerMicroJob} from '../lib/microtask-job-context';
import {microJobAvailable,microJobProjection,MICRO_JOB_UNAVAILABLE,MICRO_JOB_LEGACY} from '../lib/microtask-job-policy';
export { companyOfferReadable } from "../lib/microtask-company-read";
const router: IRouter = Router();
router.param("id", postgresIntIdParam);
async function guardCompany(tx: ContactTransaction, companyId: number, res: Response, action: TrustAction, candidateId?: number) {
  await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
  const decision = await assertCompanyActionAllowed(companyId, candidateId, tx, action);
  if (decision.allowed) return true;
  res.status(403).json({ error: decision.publicReason, code: decision.code, ...(decision.retryAt ? { retryAt: decision.retryAt } : {}) });
  return false;
}
type MicroOffer = typeof offers.$inferSelect;
async function guardOfferResume(tx: ContactTransaction, offer: MicroOffer, res: Response) {
  if (offer.resumeProvenance === "captured" && await microBindingAvailable(tx, offer, offer.candidateUserId, offer.companyId)) return true;
  if (offer.resumeId) await revokeMicrotasksForResume(tx, offer.candidateUserId, offer.resumeId);
  res.status(409).json({ error: offer.resumeProvenance === "legacy_unbound" ? MICRO_LEGACY_LIMITATION : MICRO_RESUME_UNAVAILABLE, code: "practice_resume_unavailable" });
  return false;
}
async function guardOfferAssignment(tx:ContactTransaction,offer:MicroOffer,res:Response) {
  const job=await offerMicroJob(offer,tx,true);
  if(!job?.available){res.status(409).json({error:job?MICRO_JOB_UNAVAILABLE:MICRO_JOB_LEGACY,code:'practice_job_unavailable'});return false;}
  return guardOfferResume(tx,offer,res);
}
async function templateResponse(template:typeof templates.$inferSelect) {
  const job=await loadMicroJob(template);
  return {...template,job:microJobProjection(job,template),assignmentAvailable:template.active&&microJobAvailable(job,template)};
}
router.get("/employer/microtasks", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const companyId = actor.company.id;
  const [list, answers, recipients] = await Promise.all([
    db.select().from(templates).where(eq(templates.companyId, companyId)).orderBy(desc(templates.createdAt), desc(templates.id)),
    readCompanyMicroAnswers(companyId,actor),
    readCompanyMicroRecipients(companyId,actor),
  ]);
  res.setHeader('Cache-Control','no-store, private');
  res.json(await Promise.all(list.map(async template => ({...await templateResponse(template),...microAnswerCounters(answers.filter(row=>row.templateId===template.id)),recipientCount:recipients.filter(row=>row.templateId===template.id).length}))));
});
for(const kind of ['answers','recipients'] as const)router.get(`/employer/microtasks/:id/${kind}`,async(req,res)=>{
  const actor=await opportunityActor(req,res,'employer');if(!actor?.company)return;
  const input=microWorkspacePageQuery.safeParse(req.query);if(!input.success){res.status(400).json({error:'Проверьте фильтр и страницу.'});return;}
  const id=positiveId(req.params.id),[template]=await db.select({id:templates.id}).from(templates).where(and(eq(templates.id,id),eq(templates.companyId,actor.company.id))).limit(1);
  if(!template){res.status(404).json({error:'Задание не найдено.'});return;}
  res.setHeader('Cache-Control','no-store, private');
  if(kind==='recipients'){res.json(microWorkspacePage(await readCompanyMicroRecipients(actor.company.id,actor,id),input.data));return;}
  const answers=await readCompanyMicroAnswers(actor.company.id,actor,id);
  res.json({...microWorkspacePage(answers.filter(row=>microAnswerMatches(row,input.data.filter)),input.data),filter:input.data.filter,counters:microAnswerCounters(answers)});
});
router.post("/employer/microtasks", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = microTemplateInput.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
      error:
        "Выберите вакансию, укажите учебную ситуацию, компетенцию, критерии, 5–45 минут и период не менее 7 дней.",fieldErrors:input.error.flatten().fieldErrors,
    });
    return;
  }
  const row = await db.transaction(async tx => {
    if (!await guardCompany(tx, actor.company!.id, res, "publishing")) return null;
    const target={...input.data,companyId:actor.company!.id};
    if(!microJobAvailable(await loadMicroJob(target,tx,true),target,'prepare')){res.status(400).json({error:MICRO_JOB_UNAVAILABLE,fieldErrors:{jobId:['Выберите свою действующую вакансию того же направления.']}});return null;}
    const [created] = await tx.insert(templates).values({ ...input.data, companyId: actor.company!.id }).returning();
    return created;
  });
  if (!row) return;
  res.status(201).json(await templateResponse(row));
});
router.put("/employer/microtasks/:id", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = microTemplateUpdateInput.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Проверьте условия, рубрику и редакцию задания." });
    return;
  }
  const row = await db.transaction(async (tx) => {
    if (!await guardCompany(tx, actor.company!.id, res, "publishing")) return null;
    const [old] = await tx
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, positiveId(req.params.id)),
          eq(templates.companyId, actor.company!.id),
        ),
      )
      .for("update");
    if (!old) return null;
    if (old.version !== input.data.version) { res.status(409).json({code:"VERSION_CONFLICT",error:"Задание уже изменено. Загрузите актуальную редакцию перед сохранением."}); return null; }
    if(!old.jobId||old.jobId!==input.data.jobId){res.status(409).json({error:old.jobId?'Вакансия задания неизменяема. Создайте новое задание для другой вакансии.':MICRO_JOB_LEGACY,code:'practice_context_immutable'});return null;}
    const target={...input.data,companyId:actor.company!.id};
    if(!microJobAvailable(await loadMicroJob(target,tx,true),target,'prepare')){res.status(409).json({error:MICRO_JOB_UNAVAILABLE});return null;}
    const {version:expectedVersion,...changes} = input.data;
    const [updated] = await tx
      .update(templates)
      .set({ ...changes, version: old.version + 1 })
      .where(and(eq(templates.id, old.id),eq(templates.version,expectedVersion)))
      .returning();
    return updated;
  });
  if (res.headersSent) return;
  if (!row) {
    res.status(404).json({ error: "Задание не найдено." });
    return;
  }
  res.json(await templateResponse(row));
});
router.post("/employer/microtasks/:id/availability", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = z.object({ active: z.boolean() }).strict().safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Некорректное состояние." });
    return;
  }
  const row = await db.transaction(async tx => {
    if (input.data.active && !await guardCompany(tx, actor.company!.id, res, "publishing")) return null;
    const [old]=await tx.select().from(templates).where(and(eq(templates.id,positiveId(req.params.id)),eq(templates.companyId,actor.company!.id))).for('update');
    if(!old)return null;
    if(input.data.active&&!microJobAvailable(await loadMicroJob(old,tx,true),old,'prepare')){res.status(409).json({error:old.jobId?MICRO_JOB_UNAVAILABLE:MICRO_JOB_LEGACY});return null;}
    const [updated] = await tx.update(templates).set(input.data).where(and(eq(templates.id, positiveId(req.params.id)), eq(templates.companyId, actor.company!.id))).returning();
    return updated;
  });
  if (res.headersSent) return;
  if (!row) {
    res.status(404).json({ error: "Задание не найдено." });
    return;
  }
  res.json(await templateResponse(row));
});
router.get("/employer/microtasks/eligible/candidates", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const query = microRecipientQuery.safeParse(req.query);
  res.set("Cache-Control", "no-store, private");
  if (!query.success) { res.status(400).json({ error: "Проверьте параметры поиска резюме." }); return; }
  const input = query.data;
  const companyPermission = await assertCompanyActionAllowed(actor.company.id, undefined, db, "invitations");
  if (!companyPermission.allowed) { res.status(403).json({ error: companyPermission.publicReason, code: companyPermission.code }); return; }
  let specialization: string | null = null;
  if (input.templateId !== undefined) {
    const [template] = await db.select().from(templates).where(and(eq(templates.id, input.templateId), eq(templates.companyId, actor.company.id), eq(templates.active, true)));
    if (!template) { res.status(404).json({ error: "Задание недоступно." }); return; }
    if(!microJobAvailable(await loadMicroJob(template),template)){res.status(409).json({error:template.jobId?MICRO_JOB_UNAVAILABLE:MICRO_JOB_LEGACY});return;}
    if (!template.specialization) { res.json({ items: [], nextCursor: null }); return; }
    specialization = template.specialization;
  }
  const search = recipientSearch(input.search);
  const context = recipientCursorContext({ companyId: actor.company.id, scope: poolScopeForAccount(actor),
    templateId: input.templateId, specialization, search, grade: input.grade });
  let after: number | null;
  try { after = decodeRecipientCursor(input.cursor, context); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  // Both individual blocks and company restrictions are filtered by the same
  // bounded SQL query BEFORE its page limit; blocked prefixes cannot starve it.
  const now = new Date();
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db.select({ id: resumes.userId, resumeId: resumes.id, resumeRevision: resumes.revision,
    resumeTitle: resumes.title, alias: profiles.professionalAlias, specialization: resumes.specialization,
    verifiedGrade: resumes.verifiedGrade })
    .from(resumes).innerJoin(users, eq(users.id, resumes.userId))
    .innerJoin(profiles, eq(profiles.userId, resumes.userId))
    .innerJoin(preferences, eq(preferences.candidateUserId, resumes.userId))
    .where(and(signalPoolPredicate(users, actor), eq(users.role, "candidate"), eq(preferences.enabled, true),
      isNull(resumes.deletedAt), isNotNull(resumes.verifiedGrade), eq(resumes.consentMatching, true), ne(resumes.visibility, "private"),
      specialization ? eq(resumes.specialization, specialization) : inArray(resumes.specialization, ["Backend / Python", "Frontend / TypeScript"]),
      input.grade ? eq(resumes.verifiedGrade, input.grade) : undefined,
      search ? or(ilike(profiles.professionalAlias, pattern), ilike(resumes.title, pattern)) : undefined,
      after ? gt(resumes.id, after) : undefined,
      notExists(db.select({ id: blocks.id }).from(blocks).where(and(eq(blocks.companyId, actor.company.id), eq(blocks.candidateUserId, resumes.userId), eq(blocks.active, true)))),
      notExists(db.select({ id: restrictions.id }).from(restrictions).where(and(eq(restrictions.companyId, actor.company.id), isNull(restrictions.liftedAt),
        lte(restrictions.startsAt, now), gt(restrictions.expiresAt, now), inArray(restrictions.scope, ["invitations", "all"]))))))
    .orderBy(asc(resumes.id)).limit(input.limit + 1);
  const items = rows.slice(0, input.limit);
  res.json({ items, nextCursor: rows.length > input.limit ? encodeRecipientCursor(items.at(-1)!.resumeId, context) : null });
});
router.post("/employer/microtasks/:id/subscriptions", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = z.object({ candidateId: postgresIntIdSchema, resumeId: postgresIntIdSchema }).strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Выберите конкретное резюме кандидата." }); return; }
  const row = await db.transaction(async (tx) => {
    if (!await guardCompany(tx, actor.company!.id, res, "invitations", input.data.candidateId)) return null;
    await lockMicrotaskOwner(tx, input.data.candidateId);
    const [template] = await tx.select().from(templates).where(and(eq(templates.id, positiveId(req.params.id)), eq(templates.companyId, actor.company!.id), eq(templates.active, true))).for("share");
    if (!template?.specialization) return null;
    if(!microJobAvailable(await loadMicroJob(template,tx,true),template)){res.status(409).json({error:template.jobId?MICRO_JOB_UNAVAILABLE:MICRO_JOB_LEGACY});return null;}
    const [candidate] = await tx.select({ resume: resumes, alias: profiles.professionalAlias }).from(resumes)
      .innerJoin(users, eq(users.id, resumes.userId)).innerJoin(profiles, eq(profiles.userId, resumes.userId))
      .innerJoin(preferences, eq(preferences.candidateUserId, resumes.userId))
      .where(and(eq(resumes.id, input.data.resumeId), eq(resumes.userId, input.data.candidateId), eq(users.role, "candidate"),
        signalPoolPredicate(users, actor), eq(preferences.enabled, true), isNull(resumes.deletedAt), isNotNull(resumes.verifiedGrade),
        eq(resumes.consentMatching, true), ne(resumes.visibility, "private"), eq(resumes.specialization, template.specialization)));
    if (!candidate) return null;
    const binding = captureMicroResume(candidate.resume, candidate.alias);
    const [existing] = await tx.select().from(subscriptions).where(and(eq(subscriptions.templateId, template.id), eq(subscriptions.candidateUserId, input.data.candidateId))).for("update");
    if (existing) {
      if (existing.active) {
        if (existing.resumeProvenance !== "captured" || existing.resumeId !== input.data.resumeId) {
          res.status(409).json({ error: "Для этого человека уже включена подписка. Сначала отключите её; лимит частоты сохранится." }); return null;
        }
        return existing;
      }
      // Selecting another resume cannot override the person's program opt-out.
      // The owner explicitly resumes it; weekly dates are never reset.
      const [updated] = await tx.update(subscriptions).set(binding).where(eq(subscriptions.id, existing.id)).returning();
      return updated;
    }
    const [created] = await tx.insert(subscriptions).values({ ...binding, templateId: template.id, candidateUserId: input.data.candidateId, nextDueAt: new Date() }).returning();
    return created;
  });
  if (res.headersSent) return;
  if (!row) { res.status(404).json({ error: "Резюме недоступно, не подтверждено, не соответствует направлению задания или не разрешает предложения." }); return; }
  await runMicrotaskScheduler(new Date(), [input.data.candidateId]);
  res.json(row);
});
router.get("/me/microtasks", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const filter=z.object({jobId:z.coerce.number().int().positive().max(2147483647).optional()}).strict().safeParse(req.query);
  if(!filter.success){res.status(400).json({error:'Некорректная вакансия.'});return;}
  const [pref] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.candidateUserId, actor.userId));
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.candidateUserId, actor.userId))
    .orderBy(desc(offers.createdAt));
  const subs = await db
    .select({
      id: subscriptions.id,
      active: subscriptions.active,
      nextDueAt: subscriptions.nextDueAt,
      resumeId: subscriptions.resumeId,
      resumeRevision: subscriptions.resumeRevision,
      resumeContext: subscriptions.resumeContext,
      resumeProvenance: subscriptions.resumeProvenance,
      specialization: templates.specialization,
      jobId:templates.jobId,
      title: templates.title,
      companyName: companies.name,
      companyId: companies.id,
    })
    .from(subscriptions)
    .innerJoin(templates, eq(templates.id, subscriptions.templateId))
    .innerJoin(companies, eq(companies.id, templates.companyId))
    .where(eq(subscriptions.candidateUserId, actor.userId));
  res.json({
    enabled: pref?.enabled ?? false,
    offers: await Promise.all(rows.filter(row=>!filter.data.jobId||row.snapshot.job?.id===filter.data.jobId).map(async row => {
      const resumeAvailable = !row.consentRevokedAt && row.resumeProvenance === "captured" && await microBindingAvailable(db, row, row.candidateUserId, row.companyId);
      const job=await offerMicroJob(row);
      return { ...row, resumeAvailable,job,assignmentAvailable:resumeAvailable&&!!job?.available,
        assignmentLimitation:job?.available?null:job?MICRO_JOB_UNAVAILABLE:MICRO_JOB_LEGACY,
        resumeLimitation: resumeAvailable ? null : row.resumeProvenance === "legacy_unbound" ? MICRO_LEGACY_LIMITATION : MICRO_RESUME_UNAVAILABLE,
        status: ["offered", "accepted"].includes(row.status) && row.dueAt <= new Date() ? "expired" : row.status };
    })),
    subscriptions: await Promise.all(subs.filter(sub=>!filter.data.jobId||sub.jobId===filter.data.jobId).map(async sub => {
      const resumeAvailable = sub.specialization !== null && sub.resumeContext?.specialization === sub.specialization &&
        await microBindingAvailable(db, sub, actor.userId, sub.companyId);
      const current=await loadMicroJob(sub),available=microJobAvailable(current,sub);
      const job=current?{id:current.id,title:available?current.title:'Вакансия недоступна',available}:null;
      return { ...sub, resumeAvailable,job,assignmentAvailable:resumeAvailable&&available,
        resumeLimitation: resumeAvailable ? null : sub.resumeProvenance === "legacy_unbound" ? MICRO_LEGACY_LIMITATION : MICRO_RESUME_UNAVAILABLE };
    })),
    limits: MICRO_LIMITS,
  });
});
router.put("/me/microtasks/preferences", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const input = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Укажите согласие на предложения." });
    return;
  }
  await db.transaction(async (tx) => {
    await lockMicrotaskOwner(tx, actor.userId);
    await tx
      .insert(preferences)
      .values({ candidateUserId: actor.userId, enabled: input.data.enabled })
      .onConflictDoUpdate({
        target: preferences.candidateUserId,
        set: { enabled: input.data.enabled, updatedAt: new Date() },
      });
    if (!input.data.enabled) {
      await tx
        .update(subscriptions)
        .set({ active: false })
        .where(eq(subscriptions.candidateUserId, actor.userId));
      await tx
        .update(offers)
        .set({ status: "withdrawn", consentRevokedAt: new Date() })
        .where(
          and(
            eq(offers.candidateUserId, actor.userId),
            inArray(offers.status, ["offered", "accepted"]),
          ),
        );
    }
  });
  res.json(input.data);
});
router.post("/me/microtasks/subscriptions/:id", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const input = z.object({ active: z.boolean() }).strict().safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Некорректное действие." });
    return;
  }
  const row = await db.transaction(async (tx) => {
    await lockMicrotaskOwner(tx, actor.userId);
    const [pref] = await tx
      .select()
      .from(preferences)
      .where(eq(preferences.candidateUserId, actor.userId));
    if (input.data.active && !pref?.enabled) return null;
    const [bound] = await tx.select({ subscription: subscriptions, template: templates }).from(subscriptions)
      .innerJoin(templates, eq(templates.id, subscriptions.templateId))
      .where(and(eq(subscriptions.id, positiveId(req.params.id)), eq(subscriptions.candidateUserId, actor.userId)));
    if (!bound) return null;
    if(input.data.active&&!microJobAvailable(await loadMicroJob(bound.template,tx,true),bound.template)){res.status(409).json({error:bound.template.jobId?MICRO_JOB_UNAVAILABLE:MICRO_JOB_LEGACY});return null;}
    if (input.data.active && (!bound.template.active || !bound.template.specialization ||
      bound.subscription.resumeContext?.specialization !== bound.template.specialization ||
      !await microBindingAvailable(tx, bound.subscription, actor.userId, bound.template.companyId))) {
      res.status(409).json({ error: bound.subscription.resumeProvenance === "legacy_unbound" ? MICRO_LEGACY_LIMITATION : MICRO_RESUME_UNAVAILABLE }); return null;
    }
    const [updated] = await tx
      .update(subscriptions)
      .set({ active: input.data.active })
      .where(
        and(
          eq(subscriptions.id, positiveId(req.params.id)),
          eq(subscriptions.candidateUserId, actor.userId),
        ),
      )
      .returning();
    if (updated && !input.data.active)
      await tx
        .update(offers)
        .set({ status: "withdrawn", consentRevokedAt: new Date() })
        .where(
          and(
            eq(offers.subscriptionId, updated.id),
            inArray(offers.status, ["offered", "accepted"]),
          ),
        );
    return updated;
  });
  if (res.headersSent) return;
  if (!row) {
    res.status(409).json({
      error: "Подписка недоступна. Для возобновления включите предложения.",
    });
    return;
  }
  res.json(row);
});
router.post("/me/microtasks/:id/decision", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const input = z
    .object({
      decision: z.enum(["accept", "decline"]),
      consentCompanyReview: z.boolean().optional(),
    })
    .strict()
    .safeParse(req.body);
  if (
    !input.success ||
    (input.data.decision === "accept" &&
      input.data.consentCompanyReview !== true)
  ) {
    res.status(400).json({
      error: "Для принятия подтвердите передачу ответа автору задания.",
    });
    return;
  }
  const target = input.data.decision === "accept" ? "accepted" : "declined";
  const row = await db.transaction(async (tx) => {
    const [preview] = await tx.select({companyId: offers.companyId}).from(offers).where(and(eq(offers.id, positiveId(req.params.id)), eq(offers.candidateUserId, actor.userId)));
    if (!preview) return null;
    if (target === "accepted" && !await guardCompany(tx, preview.companyId, res, "contacts", actor.userId)) return null;
    await lockMicrotaskOwner(tx, actor.userId);
    const [old] = await tx
      .select()
      .from(offers)
      .where(
        and(
          eq(offers.id, positiveId(req.params.id)),
          eq(offers.candidateUserId, actor.userId),
        ),
      )
      .for("update");
    if (!old || old.consentRevokedAt) return null;
    if (target === "accepted" && !await guardOfferAssignment(tx, old, res)) return null;
    if (old.status === target) return old;
    if (old.status !== "offered" || old.dueAt <= new Date()) return null;
    const [updated] = await tx
      .update(offers)
      .set({
        status: target,
        ...(target === "accepted" ? { acceptedAt: new Date() } : {}),
      })
      .where(eq(offers.id, old.id))
      .returning();
    return updated;
  });
  if (res.headersSent) return;
  if (!row) {
    res
      .status(409)
      .json({ error: "Предложение завершено, отозвано или срок истёк." });
    return;
  }
  res.json(row);
});
router.post("/me/microtasks/:id/submit", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const input = z
    .object({ answer: z.string().trim().min(10).max(10000) })
    .strict()
    .safeParse(req.body);
  if (!input.success) {
    res
      .status(400)
      .json({ error: "Ответ должен содержать от 10 до 10 000 символов." });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [preview] = await tx.select({companyId: offers.companyId}).from(offers).where(and(eq(offers.id, positiveId(req.params.id)), eq(offers.candidateUserId, actor.userId)));
    if (!preview || !await guardCompany(tx, preview.companyId, res, "contacts", actor.userId)) return null;
    await lockMicrotaskOwner(tx, actor.userId);
    const [old] = await tx
      .select()
      .from(offers)
      .where(
        and(
          eq(offers.id, positiveId(req.params.id)),
          eq(offers.candidateUserId, actor.userId),
        ),
      )
      .for("update");
    if (!old || old.consentRevokedAt) return null;
    if (["submitted", "evaluated"].includes(old.status))
      return old.answer === input.data.answer ? old : null;
    if (!await guardOfferAssignment(tx, old, res)) return null;
    if (old.status !== "accepted" || old.dueAt <= new Date()) return null;
    const [updated] = await tx
      .update(offers)
      .set({
        status: "submitted",
        answer: input.data.answer,
        submittedAt: new Date(),
      })
      .where(eq(offers.id, old.id))
      .returning();
    return updated;
  });
  if (res.headersSent) return;
  if (!row) {
    res.status(409).json({
      error: "Ответ уже отправлен, срок истёк или согласие отозвано.",
    });
    return;
  }
  res.json(row);
});
router.get("/employer/microtasks/offers", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = microOfferQuery.safeParse(req.query);
  if (!input.success) {res.status(400).json({error:"Проверьте параметры списка ответов."}); return;}
  const {templateId,submittedOnly} = input.data;
  if (templateId) {
    const [ownTemplate] = await db.select({id:templates.id}).from(templates).where(and(eq(templates.id,templateId),eq(templates.companyId,actor.company.id))).limit(1);
    if (!ownTemplate) {res.status(404).json({error:"Задание не найдено."}); return;}
  }
  const rows = await db.select({offer:offers,alias:profiles.professionalAlias,templateId:subscriptions.templateId}).from(offers)
    .innerJoin(subscriptions,eq(subscriptions.id,offers.subscriptionId)).innerJoin(templates,eq(templates.id,subscriptions.templateId))
    .innerJoin(users,eq(users.id,offers.candidateUserId)).innerJoin(profiles,eq(profiles.userId,offers.candidateUserId))
    .where(and(eq(offers.companyId,actor.company.id),eq(templates.companyId,actor.company.id),signalPoolPredicate(users,actor),
      templateId ? eq(subscriptions.templateId,templateId) : undefined,
      submittedOnly === '1' ? inArray(offers.status,['submitted','evaluated']) : undefined))
    .orderBy(desc(offers.submittedAt),desc(offers.createdAt),desc(offers.id));
  const access = await loadCompanyOfferAccess(actor.company.id,rows.map(row=>row.offer));
  const visible = rows.filter(({offer})=>submittedOnly !== '1' || (access.get(offer.id)?.readable && microAnswerSubmitted(offer)));
  res.setHeader('Cache-Control','no-store, private');
  res.json(visible.map(({offer,alias,templateId})=>{
    const allowed = access.get(offer.id);
    const denied = !allowed?.readable;
    return {...offer,templateId,candidateUserId:undefined,candidateIdentity:denied ? null : allowed?.candidateIdentity ?? null,alias:denied ? "Доступ отозван" : allowed?.candidateIdentity?.alias ?? alias,
      resumeId:denied ? null : offer.resumeId,resumeRevision:denied ? null : offer.resumeRevision,resumeContext:denied ? null : offer.resumeContext,
      resumeAvailable:!denied,resumeLimitation:denied ? MICRO_RESUME_UNAVAILABLE : offer.resumeProvenance === 'legacy_unbound' ? MICRO_LEGACY_LIMITATION : null,
      answer:denied ? null : offer.answer,result:denied ? null : offer.result,
      status:['offered','accepted'].includes(offer.status) && offer.dueAt <= new Date() ? 'expired' : offer.status};
  }));
});
router.post("/employer/microtasks/offers/:id/evaluate", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = z
    .object({
      scores: z
        .array(
          z
            .object({
              criterionId: z.string(),
              points: z.number().int().min(0),
              comment: z.string().trim().min(3).max(500),
            })
            .strict(),
        )
        .min(1)
        .max(6),
      feedback: z.string().trim().min(10).max(2000),
    })
    .strict()
    .safeParse(req.body);
  if (!input.success) {
    res
      .status(400)
      .json({ error: "Оцените каждый критерий и добавьте обратную связь." });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [preview] = await tx
      .select()
      .from(offers)
      .where(
        and(
          eq(offers.id, positiveId(req.params.id)),
          eq(offers.companyId, actor.company!.id),
        ),
      );
    if (!preview) return null;
    if (!await guardCompany(tx, actor.company!.id, res, "contacts", preview.candidateUserId)) return null;
    await lockMicrotaskOwner(tx, preview.candidateUserId);
    const [old] = await tx
      .select()
      .from(offers)
      .where(eq(offers.id, preview.id))
      .for("update");
    if (!old || old.consentRevokedAt) return null;
    if (!await companyOfferReadable(old, tx)) {
      if (old.resumeId) await revokeMicrotasksForResume(tx, old.candidateUserId, old.resumeId);
      res.status(409).json({ error: MICRO_RESUME_UNAVAILABLE }); return null;
    }
    if (old.status === "evaluated")
      return isDeepStrictEqual(old.result?.scores, input.data.scores) &&
        old.result?.feedback === input.data.feedback
        ? old
        : null;
    if (old.status !== "submitted") return null;
    const criteria = old.snapshot.rubric;
    const seen = new Set(input.data.scores.map((s) => s.criterionId));
    if (
      criteria.length !== input.data.scores.length ||
      seen.size !== criteria.length ||
      criteria.some(
        (c) =>
          !input.data.scores.some(
            (s) => s.criterionId === c.id && s.points <= c.maxPoints,
          ),
      )
    )
      return null;
    const result = {
      evaluatorUserId: actor.userId,
      evaluatedAt: new Date().toISOString(),
      scores: input.data.scores,
      total: input.data.scores.reduce((n, s) => n + s.points, 0),
      max: criteria.reduce((n, c) => n + c.maxPoints, 0),
      feedback: input.data.feedback,
      source: "company_task" as const,
      purpose: "company_task" as const,
      qualificationEffect: "none" as const,
      competency: old.snapshot.competency,
      templateVersion: old.snapshot.version,
    };
    const [updated] = await tx
      .update(offers)
      .set({ status: "evaluated", result })
      .where(eq(offers.id, old.id))
      .returning();
    return updated;
  });
  if (res.headersSent) return;
  if (!row) {
    res.status(409).json({
      error:
        "Проверьте рубрику: ответ недоступен, оценка уже сохранена или согласие отозвано.",
    });
    return;
  }
  res.json(row);
});
router.post("/me/microtasks/:id/visibility", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const input = z
    .object({ shareResult: z.boolean() })
    .strict()
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Укажите разрешение на показ результата." });
    return;
  }
  const row = await db.transaction(async tx => {
    await lockMicrotaskOwner(tx, actor.userId);
    const [old] = await tx.select().from(offers).where(and(eq(offers.id, positiveId(req.params.id)),
      eq(offers.candidateUserId, actor.userId), eq(offers.status, "evaluated"), isNull(offers.consentRevokedAt))).for("update");
    if (!old) return null;
    if (input.data.shareResult && !await guardOfferResume(tx, old, res)) return null;
    const [updated] = await tx.update(offers).set(input.data).where(eq(offers.id, old.id)).returning();
    return updated;
  });
  if (res.headersSent) return;
  if (!row) {
    res
      .status(409)
      .json({ error: "Результат ещё не готов или согласие отозвано." });
    return;
  }
  res.json(row);
});
router.post("/me/microtasks/:id/revoke", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const row = await db.transaction(async (tx) => {
    await lockMicrotaskOwner(tx, actor.userId);
    const [old] = await tx
      .select()
      .from(offers)
      .where(
        and(
          eq(offers.id, positiveId(req.params.id)),
          eq(offers.candidateUserId, actor.userId),
        ),
      )
      .for("update");
    if (!old) return null;
    await tx
      .update(subscriptions)
      .set({ active: false })
      .where(eq(subscriptions.id, old.subscriptionId));
    const [updated] = await tx
      .update(offers)
      .set({
        shareResult: false,
        consentRevokedAt: old.consentRevokedAt ?? new Date(),
        status: ["offered", "accepted", "submitted"].includes(old.status)
          ? "withdrawn"
          : old.status,
      })
      .where(eq(offers.id, old.id))
      .returning();
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Задание не найдено." });
    return;
  }
  res.json(row);
});
router.get("/employer/micro-evidence/:id", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const resumeId = postgresIntIdSchema.safeParse(Number(req.query.resumeId));
  if (!resumeId.success || typeof req.query.resumeId !== "string") { res.status(400).json({ error: "Выберите конкретное резюме." }); return; }
  const candidateId = positiveId(req.params.id);
  if (!(await assertCompanyActionAllowed(actor.company.id, candidateId, db, "contacts")).allowed) { res.status(404).json({ error: "Резюме недоступно." }); return; }
  const [candidate] = await db.select({ id: resumes.userId }).from(resumes).innerJoin(users, eq(users.id, resumes.userId))
    .where(and(eq(resumes.id, resumeId.data), eq(resumes.userId, candidateId), isNull(resumes.deletedAt),
      signalPoolPredicate(users, actor), isNotNull(resumes.verifiedGrade), eq(resumes.consentMatching, true), ne(resumes.visibility, "private")));
  if (!candidate) { res.status(404).json({ error: "Резюме недоступно." }); return; }
  const rows = await db.select().from(offers).where(and(eq(offers.candidateUserId, candidateId), eq(offers.resumeId, resumeId.data),
    eq(offers.resumeProvenance, "captured"), eq(offers.status, "evaluated"), eq(offers.shareResult, true), isNull(offers.consentRevokedAt)));
  const permitted = await Promise.all(rows.map(async row => await companyOfferReadable(row) ? row : null));
  res.json(permitted.filter((row): row is MicroOffer => row !== null).map(row => ({
    id: row.id, purpose: "company_task", qualificationEffect: "none", resumeId: row.resumeId,
    resumeRevision: row.resumeRevision, resumeContext: row.resumeContext, resumeProvenance: row.resumeProvenance,
    companyName: row.snapshot.companyName, title: row.snapshot.title, competency: row.snapshot.competency,
    rubric: row.snapshot.rubric, limits: row.snapshot.limits,
    result: row.result ? { ...row.result, evaluatorUserId: undefined } : null,
  })));
});
export default router;
