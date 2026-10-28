import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, signalCompaniesTable as companies, signalRequirementPreviewsTable as previews, signalContextRevisionsTable as history, signalContextExclusionsTable as exclusions } from '@workspace/db';
import { getSessionUser } from '../lib/signal-auth';
import { SelectionContextRefSchema } from '../lib/selection-context-contract';
import { ComputationAccessError, StaleComputationError, ComputationLimitError } from '../lib/signal-computation-tasks';
import { RequirementPatchSchema, RefinementError, applyRequirementPreview, createRequirementPreview, readOwnedPreview, publicRequirementPreview } from '../lib/requirement-preview';
import { createFeedbackProposal } from '../lib/selection-feedback';
import { currentComputationVersions } from '../lib/signal-computation-tasks';
import { configureSelectionWatch,readSelectionWatch } from '../lib/selection-watch';
import { runCompanyCommand } from '../lib/company-command';

const router: IRouter = Router();
const command = z.string().trim().min(8).max(120);
const previewInput = z.object({context:SelectionContextRefSchema,patch:RequirementPatchSchema,commandKey:command}).strict();
const applyInput = z.object({commandKey:command}).strict();
async function actor(req: Request) {
  const session = await getSessionUser(req);
  if (!session) throw new RefinementError(401,'authentication_required','Войдите в аккаунт.');
  if (session.user.role!=='employer') throw new ComputationAccessError('Раздел доступен работодателю.');
  const [company] = await db.select({id:companies.id}).from(companies).where(eq(companies.ownerUserId,session.user.id));
  if (!company) throw new ComputationAccessError('Компания недоступна.');
  return {actorId:session.user.id,companyId:company.id};
}
const handle = (handler: (req:Request,res:Response)=>Promise<void>) => async (req:Request,res:Response) => {
  try { res.setHeader('Cache-Control','no-store'); await handler(req,res); }
  catch(error) {
    if(error instanceof ComputationLimitError){res.status(429).json({code:error.code,error:error.message});return;}
    if(error instanceof RefinementError) {res.status(error.status).json({code:error.code,error:error.message});return;}
    if(error instanceof ComputationAccessError) {res.status(403).json({code:error.code,error:error.message});return;}
    if(error instanceof StaleComputationError) {res.status(409).json({code:error.code,error:error.message});return;}
    if(error instanceof z.ZodError) {res.status(400).json({code:'invalid_input',error:'Проверьте параметры расчёта.'});return;}
    throw error;
  }
};
router.post('/employer/requirements/preview',handle(async(req,res)=>{
  const who=await actor(req), input=previewInput.parse(req.body);
  res.json(await createRequirementPreview(who,input.context,input.patch,input.commandKey));
}));
router.get('/employer/requirements/preview/:previewId',handle(async(req,res)=>{
  const who=await actor(req), id=z.string().uuid().parse(req.params.previewId);
  res.json(publicRequirementPreview(await readOwnedPreview(who,id)));
}));
router.post('/employer/requirements/preview/:previewId/apply',handle(async(req,res)=>{
  const who=await actor(req), id=z.string().uuid().parse(req.params.previewId), input=applyInput.parse(req.body);
  try {res.json(await applyRequirementPreview(who,id,input.commandKey));}
  catch(error) {
    if(!(error instanceof StaleComputationError)) throw error;
    // Recalculate only; the stale command never mutates requirements.
    const [old] = await db.select().from(previews).where(and(eq(previews.id,id),eq(previews.actorId,who.actorId),eq(previews.companyId,who.companyId)));
    if(!old) throw new ComputationAccessError('Расчёт недоступен.');
    const preview=await createRequirementPreview(who,{type:old.contextType,id:old.contextId},old.patch,`refresh:${id}:${input.commandKey}`);
    res.status(409).json({code:'discarded_stale',error:'Данные изменились. Требования не применены; проверьте новый расчёт.',preview});
  }
}));
router.post('/employer/selection/feedback',handle(async(req,res)=>{
  res.json(await createFeedbackProposal(await actor(req),req.body));
}));
router.post('/employer/requirements/history',handle(async(req,res)=>{
  const who=await actor(req), ref=SelectionContextRefSchema.parse(req.body.context);
  await currentComputationVersions(who.actorId,who.companyId,ref);
  const rows=await db.select().from(history).where(and(eq(history.companyId,who.companyId),eq(history.contextType,ref.type),eq(history.contextId,ref.id)));
  res.json({revisions:rows.map(row=>({id:row.id,revision:row.revision,parentRevision:row.parentRevision,before:row.before,after:row.after,createdAt:row.createdAt.toISOString()}))});
}));
router.post('/employer/requirements/history/:revisionId/restore-preview',handle(async(req,res)=>{
  const who=await actor(req),id=z.string().uuid().parse(req.params.revisionId),input=applyInput.parse(req.body);
  const [row]=await db.select().from(history).where(and(eq(history.id,id),eq(history.companyId,who.companyId)));
  if(!row)throw new ComputationAccessError('Редакция недоступна.');
  res.json(await createRequirementPreview(who,{type:row.contextType,id:row.contextId},row.before,input.commandKey));
}));
router.post('/employer/selection/exclusions',handle(async(req,res)=>{
  const who=await actor(req),ref=SelectionContextRefSchema.parse(req.body.context),versions=await currentComputationVersions(who.actorId,who.companyId,ref);
  const rows=await db.select().from(exclusions).where(and(eq(exclusions.companyId,who.companyId),eq(exclusions.contextType,ref.type),eq(exclusions.contextId,ref.id),eq(exclusions.contextRevision,versions.contextRevision),eq(exclusions.active,true)));
  res.json({exclusions:rows.map(row=>({id:row.id,revision:row.revision,contextRevision:row.contextRevision,createdAt:row.createdAt.toISOString()}))});
}));
router.post('/employer/selection/exclusions/:exclusionId/undo',handle(async(req,res)=>{
  const who=await actor(req),id=z.string().uuid().parse(req.params.exclusionId),input=z.object({revision:z.number().int().positive(),commandKey:command}).strict().parse(req.body);
  const [owned]=await db.select().from(exclusions).where(and(eq(exclusions.id,id),eq(exclusions.companyId,who.companyId)));
  if(!owned)throw new ComputationAccessError('Исключение недоступно.');
  const result=await runCompanyCommand(who,input.commandKey,{kind:'undo-exclusion',id,revision:input.revision},tx=>currentComputationVersions(who.actorId,who.companyId,{type:owned.contextType,id:owned.contextId},tx),async tx=>{
    const [row]=await tx.select().from(exclusions).where(and(eq(exclusions.id,id),eq(exclusions.companyId,who.companyId))).for('update');
    if(!row)throw new ComputationAccessError('Исключение недоступно.');
    await currentComputationVersions(who.actorId,who.companyId,{type:row.contextType,id:row.contextId},tx);
    if(!row.active)return {revision:row.revision,active:false};
    if(row.revision!==input.revision)throw new StaleComputationError('Исключение изменилось.');
    await tx.update(exclusions).set({active:false,revision:row.revision+1}).where(eq(exclusions.id,id));
    return {revision:row.revision+1,active:false};
  });
  res.json(result);
}));
router.post('/employer/selection/watch/read',handle(async(req,res)=>{
  const who=await actor(req),ref=SelectionContextRefSchema.parse(req.body.context);
  res.json(await readSelectionWatch(who,ref));
}));
router.post('/employer/selection/watch/configure',handle(async(req,res)=>{
  const who=await actor(req),input=z.object({context:SelectionContextRefSchema,enabled:z.boolean(),revision:z.number().int().positive().optional(),frequencyMinutes:z.union([z.literal(15),z.literal(60),z.literal(1440)]),commandKey:command}).strict().parse(req.body);
  res.json(await configureSelectionWatch(who,input.context,input));
}));
export default router;
