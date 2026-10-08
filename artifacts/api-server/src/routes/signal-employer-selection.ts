import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, signalMicroOffersTable as offers } from '@workspace/db';
import { opportunityActor } from '../lib/opportunity-auth';
import { poolScopeForAccount } from '../lib/signal-pool-scope';
import { loadOwnedSelectionContext } from '../lib/signal-employer-context';
import { SelectionContextRefSchema } from '../lib/selection-context-contract';
import { loadOwnedShortlistLinks, loadAccessibleShortlistCandidates } from '../lib/shortlist-access';
import { SelectionQuery, SelectionScopeQuery, matchesSelectionFilters, sortSelection, selectionCandidate, selectionMatchSummary, type SelectionPerson } from '../lib/employer-selection-query';
import { loadSelectionResumes, selectionMetadata, freshSelectionIds, freshSelectionIdentity } from '../lib/employer-selection-service';
import { deduplicateResumes, orderCatalog, selectMatchingResumes } from '../lib/signal-resume-catalog';
import { evaluateResumeCandidates } from '../lib/signal-resume-evaluation';
import { evaluateMatch, rankMatches } from '../lib/signal-matching';
import { withResumePhotos } from '../lib/signal-resume-matching';
import { postgresIntIdInputSchema, postgresIntIdSchema } from '../lib/postgres-id';
import { assertCompanyActionAllowed } from '../lib/signal-trust';
import { loadCompanyOfferReadability } from '../lib/microtask-company-read';
import { selectionReadPolicy, withinSavedSelection } from '../lib/selection-read-policy';

const router:IRouter=Router();
async function requestScope(req:Request,res:Response,input:z.infer<typeof SelectionScopeQuery>) {
  const actor=await opportunityActor(req,res,'employer');if(!actor?.company)return null;
  const permission=await assertCompanyActionAllowed(actor.company.id,undefined,db,'invitations');
  if(!permission.allowed){res.status(403).json({error:permission.publicReason,code:permission.code});return null;}
  if(!!input.contextType!==!!input.contextId){res.status(400).json({error:'Выберите вакансию или запрос.'});return null;}
  const context=input.contextType&&input.contextId?await loadOwnedSelectionContext(actor.company.id,{type:input.contextType,id:input.contextId}):null;
  const policy=context?selectionReadPolicy(context.context,input.view):{allowed:true,readOnly:false};
  if(input.contextId&&(!context||!policy.allowed)){res.status(404).json({error:'Вакансия или запрос недоступны.'});return null;}
  const savedIds=policy.readOnly&&context?new Set((await loadOwnedShortlistLinks(actor.company.id,context.context)).map(link=>link.resumeId)):null;
  res.setHeader('Cache-Control','no-store, private');
  return {actor,companyId:actor.company.id,scope:poolScopeForAccount(actor),loaded:context,readOnly:policy.readOnly,savedIds,purpose:context&&(policy.readOnly||input.view==='shortlisted'||input.mode!=='catalog')?'matching' as const:'catalog' as const};
}
router.get('/employer/selection',async(req,res)=>{
  const parsed=SelectionQuery.safeParse(req.query);if(!parsed.success){res.status(400).json({error:parsed.error.issues[0]?.message??'Проверьте фильтры.'});return;}
  const input=parsed.data,request=await requestScope(req,res,input);if(!request)return;
  const {companyId,scope,loaded,purpose}=request;
  const links=loaded?await loadOwnedShortlistLinks(companyId,loaded.context):[];
  // Saved candidates always require matching consent, even from a legacy catalog URL.
  const effectivePurpose=input.view==='shortlisted'?'matching':purpose;
  const visible=input.view==='shortlisted'
    ?await selectionMetadata([...await loadAccessibleShortlistCandidates(companyId,scope,links)].map(([,candidate])=>candidate))
    :await loadSelectionResumes(companyId,scope,purpose);
  const filtered=visible.filter(row=>matchesSelectionFilters(row,input));
  let people:SelectionPerson[];
  if(loaded) {
    const evaluated=evaluateResumeCandidates(loaded.matchNeed,filtered,scope.demoMode,new Date());
    const entries=input.view==='shortlisted'?evaluated:evaluated.filter(row=>row.evaluation.eligible);
    people=rankMatches(selectMatchingResumes(entries)).map(row=>({selected:row.candidate,alternatives:row.alternatives,evaluation:row.evaluation}));
  }else people=orderCatalog(deduplicateResumes(filtered)).people;
  people=sortSelection(people,input);
  const total=people.length,page=Math.max(1,Math.min(input.page,Math.ceil(total/input.pageSize)||1));
  const pageRows=people.slice((page-1)*input.pageSize,page*input.pageSize);
  const photos=await withResumePhotos(pageRows.map(row=>row.selected));
  const fresh=await freshSelectionIds(companyId,scope,effectivePurpose,pageRows.flatMap(row=>row.alternatives.map(item=>item.resumeId)));
  const saved=new Map(links.map(link=>[link.resumeId,link]));
  res.json({context:loaded?{...loaded.context,readOnly:request.readOnly,shortlistCount:links.length}:null,total,page,pageSize:input.pageSize,appliedFilters:input,sort:input.sort,
    unavailableShortlistCount:input.view==='shortlisted'?links.length-visible.length:0,
    specializations:[...new Set(visible.map(row=>row.specialization))].sort(),
    items:pageRows.flatMap((person,index)=>{const current=freshSelectionIdentity(photos[index]!,fresh);return current?[{...selectionCandidate(current,person.alternatives.filter(row=>!!freshSelectionIdentity(row,fresh)),person.evaluation,saved.has(person.selected.resumeId),!!loaded&&saved.has(person.selected.resumeId)&&(saved.get(person.selected.resumeId)!.contextVersion!==loaded.context.version||person.evaluation?.eligible===false)),savedResumeId:links.find(link=>link.candidateUserId===person.selected.userId)?.resumeId??null}]:[];})});
});
router.get('/employer/selection/resumes/:resumeId',async(req,res)=>{
  const id=postgresIntIdInputSchema.safeParse(req.params.resumeId),parsed=SelectionScopeQuery.safeParse(req.query);
  if(!id.success||!parsed.success){res.status(400).json({error:'Проверьте выбранное резюме.'});return;}
  const request=await requestScope(req,res,parsed.data);if(!request)return;
  const {companyId,scope,loaded,purpose}=request;
  if(!withinSavedSelection([id.data],request.savedIds).length){res.status(404).json({error:'Резюме не входит в сохранённый список.'});return;}
  const [candidate]=await loadSelectionResumes(companyId,scope,purpose,{resumeIds:[id.data]});
  if(!candidate){res.status(404).json({error:'Доступ к резюме закрыт или резюме удалено.'});return;}
  // Changing CV is an explicit new choice: list filters do not silently block it.
  const alternatives=await loadSelectionResumes(companyId,scope,purpose,{userId:candidate.userId,...(request.savedIds?{resumeIds:[...request.savedIds]}:{})});
  const links=loaded?await loadOwnedShortlistLinks(companyId,loaded.context):[];
  const saved=links.find(link=>link.resumeId===candidate.resumeId);
  const evaluation=loaded?evaluateMatch(loaded.matchNeed,candidate,scope.demoMode,new Date()):undefined;
  const [photo]=await withResumePhotos([candidate]);
  const fresh=await freshSelectionIds(companyId,scope,purpose,alternatives.map(row=>row.resumeId));
  const current=freshSelectionIdentity(photo!,fresh);
  if(!current){res.status(404).json({error:'Доступ к резюме изменился. Обновите подбор.'});return;}
  const practiceSummary:{title:string;status:string;result?:string}[]=[];
  if((await assertCompanyActionAllowed(companyId,candidate.userId,db,'contacts')).allowed){
    const practice=await db.select().from(offers).where(and(eq(offers.companyId,companyId),eq(offers.candidateUserId,candidate.userId),eq(offers.resumeId,candidate.resumeId),isNull(offers.consentRevokedAt),inArray(offers.status,['submitted','evaluated']))).limit(20);
    const readable=await loadCompanyOfferReadability(companyId,practice);
    for(const item of practice)if(readable.get(item.id))practiceSummary.push({title:item.snapshot.title,status:item.status==='evaluated'?'Оценено':'Ответ получен',...(item.result?{result:`${item.result.total} / ${item.result.max}`}:{})});
  }
  const view={...selectionCandidate(current,alternatives.filter(row=>!!freshSelectionIdentity(row,fresh)),evaluation,!!saved,!!saved&&(saved.contextVersion!==loaded?.context.version||evaluation?.eligible===false)),savedResumeId:links.find(link=>link.candidateUserId===candidate.userId)?.resumeId??null};
  res.json({candidate:view,availableResumes:view.availableResumes,context:loaded?{...loaded.context,readOnly:request.readOnly,shortlistCount:links.length}:null,match:evaluation?selectionMatchSummary(evaluation):null,practiceSummary});
});
// A small visible-page check avoids re-ranking the entire pool on every timer.
// It authorizes nothing from browser state: the same current scope, consent,
// deletion, blocks and restrictions are evaluated on every request.
router.post('/employer/selection/access',async(req,res)=>{
  const parsed=z.object({context:SelectionContextRefSchema.nullable(),mode:z.literal('catalog').optional(),view:z.enum(['all','shortlisted']).optional(),resumeIds:z.array(postgresIntIdSchema).max(50)}).strict().safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:'Проверьте список резюме.'});return;}
  const input=parsed.data,request=await requestScope(req,res,{...(input.context?{contextType:input.context.type,contextId:input.context.id}:{}),mode:input.mode,view:input.view});if(!request)return;
  const current=await freshSelectionIds(request.companyId,request.scope,request.purpose,withinSavedSelection([...new Set(input.resumeIds)],request.savedIds));
  res.json({items:[...current].map(([resumeId,identity])=>({resumeId,...identity}))});
});
router.post('/employer/selection/compare',async(req,res)=>{
  const parsed=z.object({context:SelectionContextRefSchema.nullable(),mode:z.literal('catalog').optional(),view:z.enum(['all','shortlisted']).optional(),resumeIds:z.array(postgresIntIdSchema).min(2).max(4)}).strict().safeParse(req.body);
  if(!parsed.success||new Set(parsed.data.resumeIds).size!==parsed.data.resumeIds.length){res.status(400).json({error:'Выберите от 2 до 4 разных специалистов.'});return;}
  const input=parsed.data,request=await requestScope(req,res,{...(input.context?{contextType:input.context.type,contextId:input.context.id}:{}),mode:input.mode,view:input.view});if(!request)return;
  const {companyId,scope,loaded,purpose}=request;
  if(withinSavedSelection(input.resumeIds,request.savedIds).length!==input.resumeIds.length){res.status(404).json({error:'Резюме не входит в сохранённый список.'});return;}
  const rows=await loadSelectionResumes(companyId,scope,purpose,{resumeIds:input.resumeIds});
  if(rows.length!==input.resumeIds.length){res.status(404).json({error:'Одно из выбранных резюме больше недоступно. Обновите подбор.'});return;}
  if(new Set(rows.map(row=>row.userId)).size!==rows.length){res.status(400).json({error:'Для сравнения выберите разных специалистов, по одному резюме каждого.'});return;}
  const photos=await withResumePhotos(rows),fresh=await freshSelectionIds(companyId,scope,purpose,input.resumeIds);
  const current=photos.map(row=>freshSelectionIdentity(row,fresh));
  if(current.some(row=>!row)){res.status(404).json({error:'Доступ к одному из резюме изменился.'});return;}
  res.json({context:loaded?{...loaded.context,readOnly:request.readOnly}:null,items:input.resumeIds.map(id=>{const row=current.find(row=>row?.resumeId===id)!;return selectionCandidate(row,[row],loaded?evaluateMatch(loaded.matchNeed,row,scope.demoMode,new Date()):undefined);})});
});
export default router;
