import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Router,type Request,type Response,type NextFunction,type IRouter } from 'express';
import { z } from 'zod';
import { db,signalAssessmentAppealsTable as appeals,signalAppealMessagesTable as messages } from '@workspace/db';
import { getSessionUser } from '../lib/signal-auth';
import { appealDetail,expertAuthority,openAssessmentAppeal,resolveAssessmentAppeal,ReviewError } from '../lib/assessment-review';
const router:IRouter=Router(),Id=z.string().uuid();
const text=z.string().trim().min(12).max(4000);
function handle(expert:boolean,fn:(req:Request,res:Response,userId:number)=>Promise<void>){return async(req:Request,res:Response,next:NextFunction)=>{try{
 const session=await getSessionUser(req);if(!session)throw new ReviewError(401,'AUTH_REQUIRED','Войдите в аккаунт.');
 if(expert){if(!await expertAuthority(session.user.id))throw new ReviewError(403,'EXPERT_AUTHORITY_REQUIRED','Нет полномочий для пересмотра.');}
 else if(session.user.role!=='candidate')throw new ReviewError(403,'CANDIDATE_REQUIRED','Обращения доступны кандидату.');
 res.setHeader('Cache-Control','no-store, private');await fn(req,res,session.user.id);
 }catch(e){if(e instanceof ReviewError)res.status(e.status).json({error:e.message,code:e.code});else if(e instanceof z.ZodError)res.status(400).json({error:'Проверьте обязательные поля и версию обращения.'});else next(e);}};}
router.get('/me/expert-authority',async(req,res,next)=>{try{const s=await getSessionUser(req);if(!s){res.status(401).json({error:'Войдите в аккаунт.'});return;}res.setHeader('Cache-Control','no-store, private');res.json({canReview:Boolean(await expertAuthority(s.user.id))});}catch(e){next(e);}});
router.get('/me/assessment-appeals',handle(false,async(_req,res,userId)=>{res.json({items:await db.select().from(appeals).where(eq(appeals.userId,userId)).orderBy(desc(appeals.updatedAt)).limit(100)});}));
router.post('/me/assessment-appeals',handle(false,async(req,res,userId)=>{
 const input=z.object({kind:z.enum(['skill','legacy']),attemptId:z.number().int().positive(),reason:text,revision:z.number().int().positive().optional()}).strict().parse(req.body);
 res.status(201).json(await openAssessmentAppeal(userId,input));
}));
router.get('/me/assessment-appeals/:id',handle(false,async(req,res,userId)=>{res.json(await appealDetail(Id.parse(req.params.id),userId));}));
router.get('/expert/assessment-appeals',handle(true,async(req,res)=>{const state=z.enum(['open','in_review','resolved']).default('open').parse(req.query.status);res.json({items:await db.select().from(appeals).where(eq(appeals.status,state)).orderBy(desc(appeals.updatedAt)).limit(100)});}));
router.get('/expert/assessment-appeals/:id',handle(true,async(req,res,userId)=>{res.json(await appealDetail(Id.parse(req.params.id),userId,true));}));
router.post('/expert/assessment-appeals/:id/start',handle(true,async(req,res,userId)=>{
 const id=Id.parse(req.params.id),input=z.object({revision:z.number().int().positive()}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  const a=(await tx.select().from(appeals).where(eq(appeals.id,id)).for('update'))[0];if(!a)throw new ReviewError(404,'APPEAL_NOT_FOUND','Обращение не найдено.');
  if(a.status==='in_review'&&a.revision===input.revision)return a;
  if(a.status!=='open'||a.revision!==input.revision)throw new ReviewError(409,'APPEAL_REVISION_CONFLICT','Обращение изменилось. Обновите экран.');
  return (await tx.update(appeals).set({status:'in_review',revision:sql`${appeals.revision}+1`,updatedAt:new Date()}).where(eq(appeals.id,id)).returning())[0];
 });res.json(result);
}));
const Command=z.object({commandKey:Id,appealRevision:z.number().int().positive(),decisionRevision:z.number().int().positive(),action:z.enum(['confirm','correct','invalidate','new_check']),explanation:text,internalNote:z.string().trim().max(4000).default(''),caseReviews:z.array(z.object({caseId:z.string().min(1).max(100),passed:z.boolean(),basis:text}).strict()).max(6).default([])}).strict();
router.post('/expert/assessment-appeals/:id/resolve',handle(true,async(req,res,userId)=>{res.json(await resolveAssessmentAppeal(userId,Id.parse(req.params.id),Command.parse(req.body)));}));
for(const expert of [false,true])router.post(`${expert?'/expert':'/me'}/assessment-appeals/:id/messages`,handle(expert,async(req,res,userId)=>{
 const id=Id.parse(req.params.id),input=z.object({revision:z.number().int().positive(),body:text,internal:z.boolean().default(false)}).strict().parse(req.body);
 await db.transaction(async tx=>{const detail=await appealDetail(id,userId,expert,tx);const a=(await tx.select().from(appeals).where(eq(appeals.id,id)).for('update'))[0]!;
  if(a.status==='resolved'||a.revision!==input.revision)throw new ReviewError(409,'APPEAL_REVISION_CONFLICT','Обращение изменилось или закрыто.');
  const grant=expert?await expertAuthority(userId,tx):null;
  if(input.internal&&!expert)throw new ReviewError(403,'EXPERT_AUTHORITY_REQUIRED','Служебные сообщения доступны эксперту.');
  await tx.insert(messages).values({id:randomUUID(),appealId:detail.appeal.id,authorId:userId,authorityId:grant?.id,visibility:input.internal?'internal':'candidate',body:input.body});
  await tx.update(appeals).set({revision:a.revision+1,updatedAt:new Date()}).where(eq(appeals.id,id));
 });res.json({saved:true});
}));
export default router;
