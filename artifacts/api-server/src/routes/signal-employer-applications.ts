import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db,signalApplicationsTable as applications,signalUsersTable as users,signalCandidateProfilesTable as profiles,
  signalCandidateResumesTable as resumes,signalJobsTable as jobs,signalContactGrantsTable as grants,signalCompanyBlocksTable as blocks } from '@workspace/db';
import { opportunityActor } from '../lib/opportunity-auth';
import { signalPoolPredicate } from '../lib/signal-pool-scope';
import { assertCompanyActionAllowed } from '../lib/signal-trust';
import { publicHistoricalSnapshot } from '../lib/signal-resume-matching';
import { postgresIntIdInputSchema } from '../lib/postgres-id';
import { applicationNameMatches, applicationSkillChips } from '../lib/employer-application-display';
import { loadSkillQualificationInputs } from '../lib/skill-module-service';
const router:IRouter=Router();
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
const query=z.object({jobId:postgresIntIdInputSchema.optional(),status:z.enum(['sent','viewed','shortlisted','declined','withdrawn']).optional(),q:z.string().trim().max(160).optional(),
  dateFrom:day.optional(),dateTo:day.optional(),sort:z.enum(['created_desc','created_asc','name_asc','status_asc']).default('created_desc'),
  page:z.coerce.number().int().min(1).max(1_000_000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20)}).strict().refine(input=>!input.dateFrom||!input.dateTo||input.dateFrom<=input.dateTo);
type EmployerActor = NonNullable<Awaited<ReturnType<typeof opportunityActor>>>;
async function loadApplicationReadRows(actor: EmployerActor, applicationId?: number) {
  const companyId=actor.company!.id;
  const [rows,denied,contactPermission,invitationPermission]=await Promise.all([
    db.select({application:applications,alias:profiles.professionalAlias,name:users.displayName,grantId:grants.id,
      resumeId:resumes.id,resumeOwner:resumes.userId,resumeVisibility:resumes.visibility,resumeDeletedAt:resumes.deletedAt,matching:resumes.consentMatching,
      jobStatus:jobs.status,jobDeletedAt:jobs.deletedAt,
      currentResume:{id:resumes.id,userId:resumes.userId,revision:resumes.revision,specialization:resumes.specialization,assumedGrade:resumes.assumedGrade,stack:resumes.stack,skills:resumes.skills}})
      .from(applications).innerJoin(users,eq(users.id,applications.candidateUserId)).innerJoin(profiles,eq(profiles.userId,users.id))
      .innerJoin(jobs,and(eq(jobs.id,applications.jobId),eq(jobs.companyId,companyId)))
      .leftJoin(resumes,and(eq(resumes.id,applications.resumeId),eq(resumes.userId,applications.candidateUserId)))
      .leftJoin(grants,and(eq(grants.applicationId,applications.id),eq(grants.companyId,companyId),eq(grants.candidateUserId,applications.candidateUserId),isNull(grants.revokedAt)))
      .where(and(eq(applications.companyId,companyId),applicationId ? eq(applications.id,applicationId) : undefined,signalPoolPredicate(users,actor))),
    db.select({id:blocks.candidateUserId}).from(blocks).where(and(eq(blocks.companyId,companyId),eq(blocks.active,true))),
    assertCompanyActionAllowed(companyId,undefined,db,'contacts'),assertCompanyActionAllowed(companyId,undefined,db,'invitations'),
  ]);
  const blocked=new Set(denied.map(row=>row.id));
  // ACL precedes name filtering/sorting: neither total nor ordering can reveal
  // a hidden identity. Multiple historical grants cannot duplicate an application.
  return [...new Map(rows.map(row=>[row.application.id,row])).values()].map(row=>{
    const contactShared=!!row.grantId&&contactPermission.allowed&&!blocked.has(row.application.candidateUserId);
    const visible=contactShared&&!!row.resumeId&&!row.resumeDeletedAt&&row.resumeVisibility!=='private';
    const professional=visible?publicHistoricalSnapshot(row.application.resumeSnapshot):null;
    const name=visible&&row.resumeVisibility==='public'?row.name:null;
    const {candidateUserId:_candidateId,...application}=row.application;
    return {currentResume:professional ? row.currentResume : null, application:{...application,message:visible?application.message:'',resumeSnapshot:professional,contactShared,
      candidate:professional?{id:row.application.candidateUserId,alias:row.alias,publicName:name,specialization:professional.specialization,
        verifiedGrade:professional.verifiedGrade,resumeId:professional.resumeId,resumeRevision:professional.revision}:null,
      invitationAllowed:!!professional&&row.matching&&invitationPermission.allowed&&!row.jobDeletedAt&&['published','draft'].includes(row.jobStatus),
    }};
  });
}
router.get('/employer/applications/:id',async(req,res)=>{
  res.setHeader('Cache-Control','no-store, private');
  const actor=await opportunityActor(req,res,'employer');if(!actor?.company)return;
  const parsed=postgresIntIdInputSchema.safeParse(req.params.id);if(!parsed.success){res.status(400).json({error:'Некорректный отклик.'});return;}
  const [row]=await loadApplicationReadRows(actor,parsed.data);
  if(!row){res.status(404).json({error:'Отклик не найден.'});return;}
  const skills=row.currentResume ? {resumeId:row.currentResume.id,resumeRevision:row.currentResume.revision,
    items:applicationSkillChips(row.currentResume,await loadSkillQualificationInputs([row.currentResume.userId]))} : null;
  res.json({...row.application,professionalSkills:skills});
});
router.get('/employer/applications',async(req,res)=>{
  res.setHeader('Cache-Control','no-store, private');
  const actor=await opportunityActor(req,res,'employer');if(!actor?.company)return;
  const parsed=query.safeParse(req.query);if(!parsed.success){res.status(400).json({error:'Проверьте фильтры откликов.'});return;}
  const input=parsed.data,projected=(await loadApplicationReadRows(actor)).map(row=>row.application);
  const jobRows=projected.filter(row=>!input.jobId||row.jobId===input.jobId);
  const counts={all:jobRows.length,new:jobRows.filter(row=>row.status==='sent').length,shortlisted:jobRows.filter(row=>row.status==='shortlisted').length};
  const selected=jobRows.filter(row=>(!input.status||row.status===input.status)&&applicationNameMatches(row.candidate,input.q ?? '')
    &&(!input.dateFrom||row.createdAt>=new Date(input.dateFrom+'T00:00:00+03:00'))&&(!input.dateTo||row.createdAt<new Date(new Date(input.dateTo+'T00:00:00+03:00').getTime()+86400000)));
  selected.sort((a,b)=>{
    if(input.sort==='name_asc'){if(!a.candidate&&b.candidate)return 1;if(a.candidate&&!b.candidate)return -1;return (a.candidate?.publicName??a.candidate?.alias??'').localeCompare(b.candidate?.publicName??b.candidate?.alias??'','ru')||a.id-b.id;}
    if(input.sort==='status_asc')return a.status.localeCompare(b.status)||b.createdAt.getTime()-a.createdAt.getTime()||b.id-a.id;
    return (input.sort==='created_asc'?1:-1)*(a.createdAt.getTime()-b.createdAt.getTime()||a.id-b.id);
  });
  const total=selected.length,page=Math.max(1,Math.min(input.page,Math.ceil(total/input.pageSize)||1));
  res.setHeader('Cache-Control','no-store, private');res.json({items:selected.slice((page-1)*input.pageSize,page*input.pageSize),total,page,pageSize:input.pageSize,counts});
});
export default router;
