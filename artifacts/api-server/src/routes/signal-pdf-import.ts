import { Router, json, type Request, type Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, signalCandidateResumesTable as resumes, signalPdfImportDraftsTable as drafts,signalPdfImportReceiptsTable as receipts } from '@workspace/db';
import { z } from 'zod';
import { getSessionUser } from '../lib/signal-auth';
import { extractVisiblePdf, pdfImportFields, PdfImportError, PDF_IMPORT_LIMIT } from '../lib/pdf-import';
import { canonicalJson } from '../lib/canonical-json';
import { synchronizePrimaryResume } from '../lib/signal-resume';

const router=Router();
export const pdfImportUploadRouter=Router();
const hash=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
const idSchema=z.string().uuid();
async function candidate(req:Request){const s=await getSessionUser(req);if(!s)throw new PdfImportError(401,'LOGIN_REQUIRED','Войдите в аккаунт.');if(s.user.role!=='candidate')throw new PdfImportError(403,'CANDIDATE_ONLY','Импорт доступен владельцу резюме.');return s.user.id;}
async function ownedResume(userId:number,id:number,reader:any=db){const [r]=await reader.select().from(resumes).where(and(eq(resumes.id,id),eq(resumes.userId,userId),isNull(resumes.deletedAt)));if(!r)throw new PdfImportError(404,'RESUME_NOT_FOUND','Резюме не найдено.');return r as typeof resumes.$inferSelect;}
async function ownedDraft(userId:number,id:string,reader:any=db){if(!idSchema.safeParse(id).success)throw new PdfImportError(400,'DRAFT_ID','Неверный идентификатор черновика.');const [d]=await reader.select().from(drafts).where(and(eq(drafts.id,id),eq(drafts.userId,userId)));if(!d)throw new PdfImportError(404,'DRAFT_NOT_FOUND','Черновик не найден.');if(d.expiresAt.getTime()<=Date.now())throw new PdfImportError(410,'DRAFT_EXPIRED','Срок хранения черновика истёк. Загрузите документ заново.');return d as typeof drafts.$inferSelect;}
function handle(fn:(req:Request,res:Response,userId:number)=>Promise<void>){return async(req:Request,res:Response)=>{res.set('Cache-Control','no-store, private');try{await fn(req,res,await candidate(req));}catch(e){if(e instanceof PdfImportError)res.status(e.status).json({error:e.message,code:e.code});else if(e instanceof z.ZodError)res.status(400).json({error:'Проверьте данные импорта.',code:'PDF_INPUT_INVALID'});else throw e;}};}
const Upload=z.object({resumeId:z.number().int().positive(),revision:z.number().int().positive(),data:z.string().max(Math.ceil(PDF_IMPORT_LIMIT/3)*4)}).strict();

// This router is mounted BEFORE the global 100 KB JSON parser. Authentication
// runs before its bounded, endpoint-specific body parser.
pdfImportUploadRouter.post('/me/pdf-import',async(req,res,next)=>{try{await candidate(req);next();}catch(e){const error=e as PdfImportError;res.status(error.status).json({error:error.message,code:error.code});}},json({limit:'7mb'}),handle(async(req,res,userId)=>{
 const input=Upload.parse(req.body),resume=await ownedResume(userId,input.resumeId);
 if(resume.revision!==input.revision)throw new PdfImportError(409,'RESUME_REVISION_CONFLICT','Резюме изменилось. Обновите его перед импортом.');
 await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(3307,${userId})`);
  const [{count}]=await tx.select({count:sql<number>`count(*)::int`}).from(receipts).where(and(eq(receipts.userId,userId),gt(receipts.createdAt,new Date(Date.now()-3_600_000))));
  if(count>=10)throw new PdfImportError(429,'PDF_RATE_LIMIT','Можно импортировать до 10 документов в час.');
  await tx.insert(receipts).values({id:randomUUID(),userId});
 });
 if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))throw new PdfImportError(400,'PDF_ENCODING','Не удалось прочитать файл.');
 const bytes=Buffer.from(input.data,'base64'),result=await extractVisiblePdf(bytes),parsed=pdfImportFields(result.fragments),id=randomUUID();
 // The source is discarded, not retained or made downloadable. Only the
 // private, expiring extraction draft is persisted. No active CV writes here.
 await db.insert(drafts).values({id,userId,resumeId:resume.id,resumeRevision:resume.revision,documentHash:hash(bytes),engine:result.engine,...parsed,fragments:result.fragments,warnings:result.warnings,expiresAt:new Date(Date.now()+86_400_000)});
 res.status(201).json({id,state:'draft',requiresReview:true});
}));

router.get('/me/pdf-import/:draftId',handle(async(req,res,userId)=>{
 const result=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${userId})`);
  const draft=await ownedDraft(userId,String(req.params.draftId),tx),resume=await ownedResume(userId,draft.resumeId,tx);
  const token=randomBytes(32).toString('base64url');
  if(draft.state==='draft')await tx.update(drafts).set({reviewTokenHash:hash(token),reviewedAt:new Date()}).where(eq(drafts.id,draft.id));
  return {id:draft.id,state:draft.state,revision:draft.revision,resumeId:resume.id,resumeTitle:resume.title,resumeRevision:draft.resumeRevision,currentResumeRevision:resume.revision,conflict:resume.revision!==draft.resumeRevision,fields:draft.fields,provenance:draft.provenance,fragments:draft.fragments,warnings:draft.warnings,expiresAt:draft.expiresAt.toISOString(),reviewToken:draft.state==='draft'?token:null,
   diff:[{field:'summary',before:resume.summary,after:draft.fields.summary},{field:'skills',before:resume.skills,after:[...new Set([...resume.skills,...draft.fields.skills])]}]};
 });res.json(result);
}));
const Apply=z.object({revision:z.number().int().positive(),reviewToken:z.string().min(32).max(80),fields:z.array(z.enum(['summary','skills'])).min(1).max(2)}).strict();
router.post('/me/pdf-import/:draftId/apply',handle(async(req,res,userId)=>{
 const input=Apply.parse(req.body),applyHash=hash(canonicalJson(input));
 const result=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${userId})`);
  const draft=await ownedDraft(userId,String(req.params.draftId),tx),resume=await ownedResume(userId,draft.resumeId,tx);
  if(draft.state==='applied'){if(draft.applyHash!==applyHash)throw new PdfImportError(409,'DRAFT_ALREADY_APPLIED','Этот черновик уже применён.');return {resumeId:resume.id,revision:draft.appliedRevision,replayed:true};}
  if(draft.state!=='draft')throw new PdfImportError(409,'DRAFT_CLOSED','Черновик отменён.');
  if(input.revision!==draft.revision || !draft.reviewedAt || hash(input.reviewToken)!==draft.reviewTokenHash)throw new PdfImportError(409,'REVIEW_REQUIRED','Откройте сравнение и подтвердите выбранные изменения.');
  if(resume.revision!==draft.resumeRevision)throw new PdfImportError(409,'RESUME_REVISION_CONFLICT','Резюме изменилось в другой вкладке. Сверьте изменения повторно.');
  if(!draft.fragments.length)throw new PdfImportError(422,'NO_VISIBLE_TEXT','В документе нет видимого текста для переноса.');
  const fields=new Set(input.fields);
  if(fields.has('skills')&&!draft.fields.skills.length)throw new PdfImportError(422,'NO_DECLARED_SKILLS','В документе не распознаны навыки для переноса.');
  const [saved]=await tx.update(resumes).set({...(fields.has('summary')?{summary:draft.fields.summary}:{}),...(fields.has('skills')?{skills:[...new Set([...resume.skills,...draft.fields.skills])]}:{}),revision:sql`${resumes.revision}+1`,updatedAt:new Date()}).where(and(eq(resumes.id,resume.id),eq(resumes.revision,draft.resumeRevision))).returning({revision:resumes.revision});
  if(!saved)throw new PdfImportError(409,'RESUME_REVISION_CONFLICT','Резюме изменилось. Сверьте изменения повторно.');
  await tx.update(drafts).set({state:'applied',appliedRevision:saved.revision,applyHash}).where(eq(drafts.id,draft.id));
  await synchronizePrimaryResume(userId,tx);
  return {resumeId:resume.id,revision:saved.revision,replayed:false};
 });res.json(result);
}));

router.post('/me/pdf-import/:draftId/refresh',handle(async(req,res,userId)=>{
 const input=z.object({revision:z.number().int().positive()}).strict().parse(req.body);
 await db.transaction(async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${userId})`);const draft=await ownedDraft(userId,String(req.params.draftId),tx),resume=await ownedResume(userId,draft.resumeId,tx);
  if(draft.state!=='draft'||draft.revision!==input.revision)throw new PdfImportError(409,'DRAFT_REVISION_CONFLICT','Черновик изменился. Обновите сравнение.');
  await tx.update(drafts).set({resumeRevision:resume.revision,revision:sql`${drafts.revision}+1`,reviewTokenHash:null,reviewedAt:null}).where(eq(drafts.id,draft.id));
 });res.json({requiresReview:true});
}));
router.delete('/me/pdf-import/:draftId',handle(async(req,res,userId)=>{
 await db.transaction(async tx=>{await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${userId})`);const draft=await ownedDraft(userId,String(req.params.draftId),tx);if(draft.state==='applied')throw new PdfImportError(409,'DRAFT_ALREADY_APPLIED','Сохранённый импорт уже применён.');await tx.update(drafts).set({state:'cancelled',fields:{summary:'',skills:[]},fragments:[],provenance:{summary:[],skills:[]},reviewTokenHash:null}).where(eq(drafts.id,draft.id));});res.json({cancelled:true});
}));
export default router;
