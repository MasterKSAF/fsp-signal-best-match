import { and, count, eq, isNull } from 'drizzle-orm';
import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { db, signalShortlistTable as shortlist, signalCandidateResumesTable as resumes } from '@workspace/db';
import { opportunityActor } from '../lib/opportunity-auth';
import { poolScopeForAccount } from '../lib/signal-pool-scope';
import { postgresIntIdInputSchema, postgresIntIdSchema } from '../lib/postgres-id';
import { SelectionContextRefSchema } from '../lib/selection-context-contract';
import { listOwnedSelectionContexts, loadOwnedSelectionContext } from '../lib/signal-employer-context';
import { loadAccessibleShortlistCandidates, loadOwnedShortlistLinks, safeShortlistCandidate } from '../lib/shortlist-access';
import { evaluateMatch } from '../lib/signal-matching';
import { freshSelectionIds, freshSelectionIdentity } from '../lib/employer-selection-service';
import { shortlistReview } from '../lib/shortlist-review';

const router:IRouter=Router();
const queryInput=z.object({contextType:z.enum(['need','job']),contextId:postgresIntIdInputSchema}).strict();
const saveInput=z.object({context:SelectionContextRefSchema,candidateId:postgresIntIdSchema,resumeId:postgresIntIdSchema,contextVersion:postgresIntIdSchema.optional()}).strict();
const removeInput=z.object({context:SelectionContextRefSchema,candidateId:postgresIntIdSchema}).strict();
async function shortlistCount(companyId:number,context:{type:'need'|'job';id:number},reader:Pick<typeof db,'select'>=db){
  const [row]=await reader.select({total:count()}).from(shortlist).where(and(eq(shortlist.companyId,companyId),eq(shortlist.contextType,context.type),eq(shortlist.contextId,context.id)));return row.total;
}
router.get('/employer/selection/contexts',async(req,res)=>{
  const actor=await opportunityActor(req,res,'employer');if(!actor?.company)return;
  res.setHeader('Cache-Control','no-store');res.json({contexts:await listOwnedSelectionContexts(actor.company.id)});
});
router.get('/employer/shortlist',async(req,res)=>{
  const actor=await opportunityActor(req,res,'employer');if(!actor?.company)return;
  const parsed=queryInput.safeParse(req.query);if(!parsed.success){res.status(400).json({error:'Выберите вакансию или запрос.'});return;}
  const ref={type:parsed.data.contextType,id:parsed.data.contextId};
  const selected=await loadOwnedSelectionContext(actor.company.id,ref);if(!selected){res.status(404).json({error:'Вакансия или запрос не найдены.'});return;}
  const links=(await loadOwnedShortlistLinks(actor.company.id,ref)).sort((a,b)=>b.updatedAt.getTime()-a.updatedAt.getTime()||b.id-a.id);
  const accessible=await loadAccessibleShortlistCandidates(actor.company.id,poolScopeForAccount(actor),links);
  const fresh=await freshSelectionIds(actor.company.id,poolScopeForAccount(actor),'matching',links.map(link=>link.resumeId));
  const items=links.map(link=>{
    const original=accessible.get(link.resumeId);
    const candidate=original?freshSelectionIdentity({...original,location:'',updatedAt:new Date()},fresh):null;
    const evaluation=candidate?evaluateMatch(selected.matchNeed,candidate,actor.demoMode):null;
    return {candidateId:link.candidateUserId,resumeId:link.resumeId,contextVersion:link.contextVersion,
      available:Boolean(candidate),...shortlistReview(link.contextVersion,selected.context.version,evaluation),
      candidate:candidate?safeShortlistCandidate(candidate):null};
  });
  res.setHeader('Cache-Control','no-store');res.json({context:selected.context,items,total:items.length});
});
router.put('/employer/shortlist',async(req,res)=>{
  const actor=await opportunityActor(req,res,'employer');if(!actor?.company)return;
  const parsed=saveInput.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Выберите контекст, кандидата и его резюме.'});return;}
  const input=parsed.data;
  const result=await db.transaction(async tx=>{
    const selected=await loadOwnedSelectionContext(actor.company!.id,input.context,tx,{lock:true});
    if(!selected||!selected.active)return {code:404 as const,error:'Вакансия или запрос недоступны для отбора.'};
    if(input.contextVersion!==undefined&&input.contextVersion!==selected.context.version)return {code:409 as const,error:'Требования изменились. Обновите подбор.'};
    // Serialize against a concurrent visibility/consent edit of the exact CV.
    const [resume]=await tx.select({id:resumes.id}).from(resumes).where(and(eq(resumes.id,input.resumeId),eq(resumes.userId,input.candidateId),isNull(resumes.deletedAt))).for('update');
    if(!resume)return {code:404 as const,error:'Резюме недоступно.'};
    const accessible=await loadAccessibleShortlistCandidates(actor.company!.id,poolScopeForAccount(actor),[{candidateUserId:input.candidateId,resumeId:input.resumeId}],tx);
    if(!accessible.has(input.resumeId))return {code:404 as const,error:'Резюме недоступно для подбора по этому контексту.'};
    const values={companyId:actor.company!.id,contextType:input.context.type,contextId:input.context.id,
      needId:input.context.type==='need'?input.context.id:null,jobId:input.context.type==='job'?input.context.id:null,
      candidateUserId:input.candidateId,resumeId:input.resumeId,contextVersion:selected.context.version};
    const [item]=await tx.insert(shortlist).values(values).onConflictDoUpdate({target:[shortlist.companyId,shortlist.contextType,shortlist.contextId,shortlist.candidateUserId],
      set:{resumeId:input.resumeId,contextVersion:selected.context.version,updatedAt:new Date()}}).returning();
    const candidate=accessible.get(input.resumeId)!;
    const evaluation=evaluateMatch(selected.matchNeed,candidate,actor.demoMode);
    return {item:{candidateId:item.candidateUserId,resumeId:item.resumeId,contextVersion:item.contextVersion,available:true,candidate:safeShortlistCandidate(candidate),...shortlistReview(item.contextVersion,selected.context.version,evaluation)},
      shortlistCount:await shortlistCount(actor.company!.id,input.context,tx)};
  });
  if(!result.item){res.status(result.code!).json({error:result.error,code:result.code===409?'VERSION_CONFLICT':'CANDIDATE_OR_CONTEXT_UNAVAILABLE'});return;}
  res.setHeader('Cache-Control','no-store');res.json(result);
});
router.delete('/employer/shortlist',async(req,res)=>{
  const actor=await opportunityActor(req,res,'employer');if(!actor?.company)return;
  const parsed=removeInput.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Выберите контекст и кандидата.'});return;}
  const input=parsed.data;
  const result=await db.transaction(async tx=>{
    const selected=await loadOwnedSelectionContext(actor.company!.id,input.context,tx,{lock:true});
    if(!selected||selected.context.type==='job'&&selected.context.status==='closed')return null;
    await tx.delete(shortlist).where(and(eq(shortlist.companyId,actor.company!.id),eq(shortlist.contextType,input.context.type),eq(shortlist.contextId,input.context.id),eq(shortlist.candidateUserId,input.candidateId)));
    return {shortlistCount:await shortlistCount(actor.company!.id,input.context,tx)};
  });
  if(!result){res.status(404).json({error:'Вакансия или запрос не найдены.'});return;}
  res.json(result);
});
export default router;
