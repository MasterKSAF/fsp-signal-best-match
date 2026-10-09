import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, signalCandidateProfilesTable, signalCandidateResumesTable } from "@workspace/db";
import { ensureCandidateProfile, getSessionUser } from "../lib/signal-auth";
import { appendResumeQuestionnaireHistory, CopyResumeSchema, CreateResumeSchema, emptyResume, recommendResumeGrade, resumeAnswerScale, resumeQuestions, frontendResumeQuestions, questionsForResume, ResumeMetadataSchema, SaveResumeSchema, VersionedSaveResumeSchema } from "../lib/signal-resume-contract";
import { ensureCandidateResume, getResumeProfile, listCandidateResumes, loadCandidateQualificationInputs, professionalResumeFields, recomputeCandidateResumes, resolveCandidateResume, synchronizePrimaryResume, type CandidateResume } from "../lib/signal-resume";
import { getResumeQualification } from "../lib/signal-resume-qualification";
import { getSkillQualification } from '../lib/skill-module-qualification';
import { loadSkillQualificationInputs, skillModulesEnabled } from '../lib/skill-module-service';
import { resumeReadDerivedFields } from '../lib/resume-read-projection';
import { resumeAffiliatedSkillKeys, resumeAffiliationKey } from '../lib/resume-skill-affiliation';
import { validateAvatarDataUrl } from "../lib/signal-avatar";
import { renderCandidateResumePdf } from "../lib/signal-resume-pdf";
import { postgresIntIdParam, postgresIntIdTextSchema } from "../lib/postgres-id";
import { revokeMicrotasksForResume } from "../lib/microtask-resume";
import { z } from 'zod';
import { signalResumeWorkPreferencesTable as workPreferences } from '@workspace/db';
import { emptyWorkPreferences, readWorkPreferences, recordResumeEvent, resumeCompletion, selectedSkillProgress, workspaceAnalytics } from '../lib/resume-workspace';
import { guardResumeDocumentProjection, parseResumeDocumentFields, projectResumeDocument, renderResumeDocx, renderResumePdf, type ResumeDocument, type ResumeDocumentField } from '../lib/resume-document';
import { resolveDocumentAccess } from '../lib/resume-document-access';
import { resumeRoleRecommendations } from '../lib/resume-progress';
const workspaceEnabled=()=>process.env.SIGNAL_WORKSPACE_ENABLED==='true';
async function workspaceQualification(row:CandidateResume){const {getCurrentResumeWorkspaceQualification}=await import('../lib/skill-module-service');return getCurrentResumeWorkspaceQualification(row);}

const router: IRouter = Router();
router.param("id", postgresIntIdParam);
async function candidate(req: Request, res: Response) {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: "Войдите в аккаунт кандидата." }); return null; }
  if (session.user.role !== "candidate") { res.status(403).json({ error: "Резюме доступно только кандидату." }); return null; }
  await ensureCandidateProfile(session.user); await ensureCandidateResume(session.user.id);
  res.setHeader("Cache-Control", "no-store, private");
  return session.user;
}
function requestedId(req: Request): number | undefined | null {
  const raw = req.params.id ?? req.query.resumeId;
  if (raw === undefined) return undefined;
  const parsed = postgresIntIdTextSchema.safeParse(raw); return parsed.success ? parsed.data : null;
}
function resumeContent(row: CandidateResume) {
  return SaveResumeSchema.parse({ summary: row.summary, softSkills: row.softSkills, experience: row.experience, projects: row.projects, education: row.education, portfolio: row.portfolio, questionnaire: row.questionnaire });
}
function responsePayload(row: CandidateResume) {
  // Database-maintained content signatures never belong to a client DTO.
  const { poolContentDigest: _poolContentDigest, ...publicRow } = row;
  return { ...publicRow, resumeId: row.id, updatedAt: row.updatedAt.toISOString(),
    recommendation: recommendResumeGrade(resumeContent(row).questionnaire), questions: questionsForResume(row.specialization),
    questionSets: { "Backend / Python": resumeQuestions, "Frontend / TypeScript": frontendResumeQuestions }, answerScale: resumeAnswerScale };
}
async function resumeReadInputs(userId:number) {
  const [historical,modular]=await Promise.all([loadCandidateQualificationInputs([userId]),loadSkillQualificationInputs([userId])]);
  return {...historical,modular};
}
function projectReadResume(row:CandidateResume,inputs:Awaited<ReturnType<typeof resumeReadInputs>>):CandidateResume {
  return {...row,...resumeReadDerivedFields(getResumeQualification(row,inputs.attempts,inputs.correctedIds),getSkillQualification(row,inputs.modular),skillModulesEnabled())};
}
const notFound = (res: Response) => { res.status(404).json({ error: "Резюме не найдено или недоступно." }); };
const badInput = (res: Response, issues?: { path: PropertyKey[]; message: string }[]) => res.status(400).json({ error: "Проверьте поля резюме.", details: issues?.map(issue => ({ path: issue.path.join("."), message: issue.message })) });

router.get("/me/resumes", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const [savedResumes, inputs] = await Promise.all([listCandidateResumes(user.id), resumeReadInputs(user.id)]);
  const resumes = savedResumes.map(row=>projectReadResume(row,inputs));
  if(!workspaceEnabled()){res.json({resumes:resumes.map(row=>({...responsePayload(row),qualification:getResumeQualification(row,inputs.attempts,inputs.correctedIds)})),count:resumes.length,limit:5});return;}
  const analytics=await workspaceAnalytics(resumes.map(row=>row.id));
  const preferences=await readWorkPreferences(resumes.map(row=>row.id));
  const {skillModuleRegistry}=await import('../lib/skill-module-registry');
  const rows=await Promise.all(resumes.map(async row=>{
    const qualification=await workspaceQualification(row);
    const roleRecommendations=resumeRoleRecommendations(qualification.coverage,qualification.skills,skillModuleRegistry);
    return {...responsePayload(row),qualification,roleRecommendations,legacyQualificationInfo:getResumeQualification(row,inputs.attempts,inputs.correctedIds),completion:resumeCompletion(row),skillProgress:selectedSkillProgress(row,qualification.skills,skillModuleRegistry.map(skill=>skill.label)),analytics:analytics.get(row.id),workPreferences:preferences.get(row.id)??emptyWorkPreferences};
  }));
  res.json({ resumes: rows, count: resumes.length, limit: 5 });
});
async function createResume(req: Request, res: Response, copyDefaults?: { title?: string }): Promise<void> {
  const user = await candidate(req, res); if (!user) return;
  const parsed = CreateResumeSchema.safeParse(req.body); if (!parsed.success) { badInput(res, parsed.error.issues); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const resumes = await listCandidateResumes(user.id, tx);
    if (resumes.length >= 5) return { kind: "limit" as const };
    const source = parsed.data.copyFromId ? await resolveCandidateResume(user.id, parsed.data.copyFromId, tx) : null;
    if (parsed.data.copyFromId && !source) return { kind: "missing" as const };
    const [profile] = await tx.select().from(signalCandidateProfilesTable).where(eq(signalCandidateProfilesTable.userId, user.id)).limit(1);
    const specialization = copyDefaults && source ? source.specialization : parsed.data.specialization;
    const title = copyDefaults && source ? copyDefaults.title ?? `${source.title.slice(0, 112)} — копия` : parsed.data.title;
    const sameProgram = source?.specialization === specialization;
    const values = source ? { ...resumeContent(source), ...professionalResumeFields(source), questionnaireHistory: source.questionnaireHistory } : emptyResume(specialization);
    const [created] = await tx.insert(signalCandidateResumesTable).values({ ...values, userId: user.id,
      title, specialization, isPrimary: !resumes.length,
      questionnaire: sameProgram ? source!.questionnaire : emptyResume(specialization).questionnaire,
      visibility: "private", consentMatching: false, consentCatalog: false, readyForOffers: false,
      legacyQualification: profile?.legacyQualification ?? source?.legacyQualification ?? null,
      // These are computed below; a copy cannot paste the source's grade into another program.
      verifiedGrade: null, verifiedScore: null, verifiedSkills: [], latestAssessmentAt: null,
      verifiedGradeChangedAt: null, qualificationAttemptId: null,
    }).returning();
    if(workspaceEnabled() && source){const [preference]=await tx.select().from(workPreferences).where(eq(workPreferences.resumeId,source.id)).limit(1);if(preference){const {resumeId:_id,updatedAt:_at,...values}=preference;await tx.insert(workPreferences).values({resumeId:created!.id,...values});}}
    await recomputeCandidateResumes(user.id, tx);
    return { kind: "created" as const, row: await resolveCandidateResume(user.id, created!.id, tx) };
  });
  if (result.kind === "limit") { res.status(409).json({ error: "Можно хранить не более пяти резюме. Удалите одно, чтобы создать новое.", code: "RESUME_LIMIT", limit: 5 }); return; }
  if (result.kind === "missing" || !result.row) { notFound(res); return; }
  res.status(201).json(responsePayload(result.row));
}
router.post("/me/resumes", (req, res) => createResume(req, res));
router.post("/me/resumes/:id/copy", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); const parsed = CopyResumeSchema.safeParse(req.body ?? {});
  if (id === null || id === undefined || !parsed.success) { badInput(res, parsed.success ? undefined : parsed.error.issues); return; }
  const source = await resolveCandidateResume(user.id, id); if (!source) { notFound(res); return; }
  // The shared atomic creator reauthorizes the source under the limit lock,
  // including deletion races, and always applies closed-copy defaults.
  req.body = { title: parsed.data.title ?? `${source.title.slice(0, 112)} — копия`, specialization: source.specialization, copyFromId: source.id };
  await createResume(req, res, { title: parsed.data.title });
});

const WorkPreferencesSchema=z.object({revision:z.number().int().positive(),location:z.string().trim().max(160),schedule:z.string().trim().max(160),employment:z.string().trim().max(160),relocation:z.boolean(),startAvailability:z.string().trim().max(160)}).strict();
router.patch('/me/resumes/:id/work-preferences',async(req,res):Promise<void>=>{
  if(!workspaceEnabled()){res.status(503).json({error:'Новый кабинет недоступен на этом стенде.'});return;}
  const user=await candidate(req,res);if(!user)return;const id=requestedId(req),parsed=WorkPreferencesSchema.safeParse(req.body);
  if(!id||!parsed.success){badInput(res);return;}
  const result=await db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const previous=await resolveCandidateResume(user.id,id,tx);if(!previous)return {kind:'missing' as const};
    if(previous.revision!==parsed.data.revision)return {kind:'conflict' as const};
    const {revision,...values}=parsed.data;
    const [saved]=await tx.insert(workPreferences).values({resumeId:id,...values}).onConflictDoUpdate({target:workPreferences.resumeId,set:{...values,updatedAt:new Date()}}).returning();
    const [row]=await tx.update(signalCandidateResumesTable).set({revision:sql`${signalCandidateResumesTable.revision}+1`,updatedAt:new Date()}).where(eq(signalCandidateResumesTable.id,id)).returning();
    return {kind:'saved' as const,preferences:saved,revision:row!.revision};
  });
  if(result.kind==='missing'){notFound(res);return;}if(result.kind==='conflict'){res.status(409).json({error:'Резюме изменилось в другой вкладке. Обновите данные перед сохранением.',code:'RESUME_REVISION_CONFLICT'});return;}res.json(result);
});

async function documentModel(req:Request,res:Response){
  let fields;
  try { fields=parseResumeDocumentFields(req.query.fields); } catch { res.status(400).json({error:'Проверьте состав файла.'});return null; }
  if(!workspaceEnabled()){res.status(503).json({error:'Новый кабинет недоступен на этом стенде.'});return null;}
  const session=await getSessionUser(req);if(!session){res.status(401).json({error:'Войдите в аккаунт.'});return null;}
  const id=requestedId(req);if(!id){badInput(res);return null;}
  const access=await resolveDocumentAccess(session.user,id);if(!access){notFound(res);return null;}
  const model=await projectCurrentDocument(access,fields);
  return {actorId:session.user.id,actor:session.user,fields,snapshot:documentAccessSnapshot(access,model),model};
}
async function projectCurrentDocument(access:NonNullable<Awaited<ReturnType<typeof resolveDocumentAccess>>>,fields:readonly ResumeDocumentField[]) {
  const qualification=await workspaceQualification(access.row);
  const preferences=(await readWorkPreferences([access.row.id])).get(access.row.id)??emptyWorkPreferences;
  return projectResumeDocument({resumeId:access.row.id,revision:access.row.revision,profile:access.profile,content:resumeContent(access.row),audience:access.audience,contactsAllowed:access.contactsAllowed,publicIdentity:access.publicIdentity,qualification,preferences,fields});
}
function documentAccessSnapshot(access:NonNullable<Awaited<ReturnType<typeof resolveDocumentAccess>>>,model:ResumeDocument) {return {resumeId:access.row.id,revision:access.row.revision,contactsPermitted:access.contactsAllowed,publicIdentity:access.publicIdentity,identityRevision:access.profile.identityRevision,projectionVersion:model.projectionVersion};}
async function finalDocumentProjection<T>(res:Response,document:NonNullable<Awaited<ReturnType<typeof documentModel>>>,render:()=>Promise<T>) {
  const guarded=await guardResumeDocumentProjection(document.snapshot,render,async()=>{
    const access=await resolveDocumentAccess(document.actor,document.model.resumeId);if(!access)return null;
    // Re-read qualification and each individual proof as well as the CV/identity/ACL.
    // Aggregate CV revision alone does not version incomplete modular evidence.
    const currentModel=await projectCurrentDocument(access,document.fields);
    return documentAccessSnapshot(access,currentModel);
  });
  if(guarded.status==='unavailable'){notFound(res);return null;}
  if(guarded.status==='changed'){res.status(409).json({error:'Документ или разрешение изменилось. Откройте предпросмотр заново.',code:'RESUME_DOCUMENT_CHANGED'});return null;}
  return guarded.output;
}
router.get('/resumes/:id/document-preview',async(req,res):Promise<void>=>{res.setHeader('Cache-Control','no-store, private');const document=await documentModel(req,res);if(!document)return;const model=await finalDocumentProjection(res,document,async()=>document.model);if(model)res.json(model);});
router.post('/resumes/:id/view',async(req,res):Promise<void>=>{
  res.setHeader('Cache-Control','no-store, private');const document=await documentModel(req,res);if(!document)return;
  if(document.model.audience==='employer')await recordResumeEvent(document.model.resumeId,document.actorId,'view');res.status(204).end();
});
async function downloadDocument(req:Request,res:Response,format:'pdf'|'docx'){
  res.setHeader('Cache-Control','no-store, private');const document=await documentModel(req,res);if(!document)return;
  const bytes=await finalDocumentProjection(res,document,()=>format==='pdf'?renderResumePdf(document.model):renderResumeDocx(document.model));if(!bytes)return;
  res.set({'Content-Type':format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="Signal-Resume-${document.model.resumeId}.${format}"`,'X-Content-Type-Options':'nosniff','Content-Length':String(bytes.length),'X-Signal-Resume-Id':String(document.model.resumeId),'X-Signal-Resume-Revision':String(document.model.revision),'X-Signal-Document-Version':document.model.projectionVersion});
  // Express also invokes GET handlers for HEAD. Metadata checks have no file body.
  // Only a completed successful GET file response counts; preview/owner never count.
  if(req.method==='GET'&&document.model.audience==='employer')res.once('finish',()=>{if(res.statusCode===200)void recordResumeEvent(document.model.resumeId,document.actorId,'download',format).catch(()=>{/* The completed response remains valid; no fabricated event on storage failure. */});});
  res.status(200).send(bytes);
}
router.get('/resumes/:id/document.pdf',(req,res)=>downloadDocument(req,res,'pdf'));
router.get('/resumes/:id/document.docx',(req,res)=>downloadDocument(req,res,'docx'));
router.get('/resumes/:id/preview.pdf',async(req,res):Promise<void>=>{
  res.setHeader('Cache-Control','no-store, private');const document=await documentModel(req,res);if(!document)return;
  const bytes=await finalDocumentProjection(res,document,()=>renderResumePdf(document.model));if(!bytes)return;res.set({'Content-Type':'application/pdf','Content-Disposition':`inline; filename="Signal-Resume-${document.model.resumeId}.pdf"`,'X-Content-Type-Options':'nosniff','Content-Length':String(bytes.length),'X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'",'X-Signal-Document-Version':document.model.projectionVersion});res.send(bytes);
});

async function readResume(req: Request, res: Response): Promise<void> {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null) { badInput(res); return; }
  const saved = await resolveCandidateResume(user.id, id); if (!saved) { notFound(res); return; }
  const inputs = await resumeReadInputs(user.id);
  const row = projectReadResume(saved,inputs);
  const historical=getResumeQualification(row,inputs.attempts,inputs.correctedIds);
  res.json({ ...responsePayload(row), qualification:workspaceEnabled()?await workspaceQualification(row):historical,...(workspaceEnabled()?{legacyQualificationInfo:historical}:{}) });
}
async function saveResume(req: Request, res: Response): Promise<void> {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null) { badInput(res); return; }
  const parsed = VersionedSaveResumeSchema.safeParse(req.body); if (!parsed.success) { badInput(res, parsed.error.issues); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const previous = await resolveCandidateResume(user.id, id, tx); if (!previous) return { kind: "missing" as const };
    if (parsed.data.revision !== undefined && parsed.data.revision !== previous.revision) return { kind: "conflict" as const };
    if (parsed.data.questionnaire.specialization !== previous.specialization) return { kind: "program" as const };
    const { revision: _revision, ...input } = parsed.data;
    const [row] = await tx.update(signalCandidateResumesTable).set({ ...input,
      questionnaireHistory: appendResumeQuestionnaireHistory(previous.questionnaireHistory, input.questionnaire),
      revision: sql`${signalCandidateResumesTable.revision}+1`, updatedAt: new Date() }).where(and(eq(signalCandidateResumesTable.id, previous.id), isNull(signalCandidateResumesTable.deletedAt))).returning();
    return { kind: "saved" as const, row };
  });
  if (result.kind === "missing") { notFound(res); return; }
  if (result.kind === "conflict") { res.status(409).json({ error: "Резюме изменилось в другой вкладке. Обновите данные перед сохранением.", code: "RESUME_REVISION_CONFLICT" }); return; }
  if (result.kind === "program") { res.status(409).json({ error: "Специализация анкеты должна совпадать с выбранным резюме." }); return; }
  res.json(responsePayload(result.row!));
}
async function resumePdf(req: Request, res: Response): Promise<void> {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null) { badInput(res); return; }
  const saved = await resolveCandidateResume(user.id, id); const savedProfile = saved && await getResumeProfile(user.id, saved.id);
  if (!saved || !savedProfile) { notFound(res); return; }
  const inputs = await resumeReadInputs(user.id);
  const row = projectReadResume(saved,inputs);
  const profile = {...savedProfile,...professionalResumeFields(row),qualificationAttemptId:row.qualificationAttemptId};
  const qualification = getResumeQualification(row, inputs.attempts, inputs.correctedIds);
  let bytes:Buffer|null,projectionVersion:string|undefined;
  if(workspaceEnabled()){
    let fields;try{fields=parseResumeDocumentFields(req.query.fields);}catch{res.status(400).json({error:'Проверьте состав файла.'});return;}
    const access=await resolveDocumentAccess(user,row.id);if(!access){notFound(res);return;}
    const model=await projectCurrentDocument(access,fields);projectionVersion=model.projectionVersion;
    bytes=await finalDocumentProjection(res,{actorId:user.id,actor:user,fields,model,snapshot:documentAccessSnapshot(access,model)},()=>renderResumePdf(model));
    if(!bytes)return;
  }else {
    const related=new Set(resumeAffiliatedSkillKeys(row,getSkillQualification(row,inputs.modular).coverage));
    bytes=await renderCandidateResumePdf({ ...profile, verifiedSkills:profile.verifiedSkills.filter(label=>related.has(resumeAffiliationKey(label))), displayName: user.displayName,qualificationSource: qualification.source, qualificationLimitation: qualification.limitation }, resumeContent(row));
  }
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Signal-Resume-${row.id}.pdf"`, "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Content-Length": String(bytes.length), "X-Signal-Resume-Id": String(row.id), "X-Signal-Resume-Revision": String(row.revision),...(projectionVersion?{'X-Signal-Document-Version':projectionVersion}:{}) });
  res.status(200).send(bytes);
}
router.get("/me/resume", readResume);
router.put("/me/resume", saveResume);
router.get("/me/resume/pdf", resumePdf);
router.get("/me/resumes/:id/pdf", resumePdf);
router.get("/me/resumes/:id", readResume);
router.put("/me/resumes/:id", saveResume);
router.patch("/me/resumes/:id", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); const parsed = ResumeMetadataSchema.safeParse(req.body);
  if (id === null || !parsed.success) { badInput(res, parsed.success ? undefined : parsed.error.issues); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const previous = await resolveCandidateResume(user.id, id, tx); if (!previous) return { kind: "missing" as const };
    const { revision, ...values } = parsed.data;
    if (revision !== undefined && revision !== previous.revision) return { kind: "conflict" as const };
    const [row] = await tx.update(signalCandidateResumesTable).set({ ...values, revision: sql`${signalCandidateResumesTable.revision}+1`, updatedAt: new Date() }).where(eq(signalCandidateResumesTable.id, previous.id)).returning();
    if (row && (row.visibility === "private" || !row.consentMatching)) await revokeMicrotasksForResume(tx, user.id, row.id);
    await synchronizePrimaryResume(user.id, tx);
    return { kind: "saved" as const, row };
  });
  if (result.kind === "missing") { notFound(res); return; }
  if (result.kind === "conflict") { res.status(409).json({ error: "Резюме изменилось. Обновите страницу.", code: "RESUME_REVISION_CONFLICT" }); return; }
  res.json(responsePayload(result.row!));
});
router.post("/me/resumes/:id/primary", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null || id === undefined) { badInput(res); return; }
  const row = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const selected = await resolveCandidateResume(user.id, id, tx); if (!selected) return null;
    await tx.update(signalCandidateResumesTable).set({ isPrimary: false }).where(and(eq(signalCandidateResumesTable.userId, user.id), isNull(signalCandidateResumesTable.deletedAt)));
    const [primary] = await tx.update(signalCandidateResumesTable).set({ isPrimary: true }).where(eq(signalCandidateResumesTable.id, id)).returning();
    await synchronizePrimaryResume(user.id, tx); return primary ?? null;
  });
  if (!row) { notFound(res); return; } res.json(responsePayload(row));
});
router.delete("/me/resumes/:id", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null || id === undefined) { badInput(res); return; }
  const deleted = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const row = await resolveCandidateResume(user.id, id, tx); if (!row) return false;
    await tx.update(signalCandidateResumesTable).set({ deletedAt: new Date(), isPrimary: false, visibility: "private", consentMatching: false, consentCatalog: false, readyForOffers: false, revision: sql`${signalCandidateResumesTable.revision}+1`, updatedAt: new Date() }).where(eq(signalCandidateResumesTable.id, id));
    await revokeMicrotasksForResume(tx, user.id, id);
    if (row.isPrimary) {
      const remaining = await listCandidateResumes(user.id, tx);
      if (remaining[0]) await tx.update(signalCandidateResumesTable).set({ isPrimary: true }).where(eq(signalCandidateResumesTable.id, remaining[0].id));
    }
    await synchronizePrimaryResume(user.id, tx); return true;
  });
  if (!deleted) { notFound(res); return; } res.status(204).end();
});
router.post("/me/avatar", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const avatar = validateAvatarDataUrl(req.body?.dataUrl);
  if (!avatar || Object.keys(req.body ?? {}).some(key => key !== "dataUrl")) { res.status(400).json({ error: "Загрузите PNG, JPEG или WebP размером до 2 МБ." }); return; }
  await db.update(signalCandidateProfilesTable).set({ avatarDataUrl: avatar.dataUrl, avatarUpdatedAt: new Date() }).where(eq(signalCandidateProfilesTable.userId, user.id));
  res.json({ avatarDataUrl: avatar.dataUrl });
});
router.delete("/me/avatar", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  await db.update(signalCandidateProfilesTable).set({ avatarDataUrl: null, avatarUpdatedAt: new Date() }).where(eq(signalCandidateProfilesTable.userId, user.id));
  res.json({ avatarDataUrl: null });
});
export default router;
