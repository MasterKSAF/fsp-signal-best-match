import { z } from 'zod';
import { CreateInvitationBody } from '@workspace/api-zod';
import { postgresIntIdSchema } from './postgres-id';
import type { SelectionContextDto } from './selection-context-contract';
export const InvitationIdempotencyKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const ContextCreateInvitationBody = CreateInvitationBody.extend({
  needId:postgresIntIdSchema.optional(), jobId:postgresIntIdSchema.optional(),
  candidateId:postgresIntIdSchema, resumeId:postgresIntIdSchema,
  contextVersion:postgresIntIdSchema.optional(), resumeRevision:postgresIntIdSchema.optional(),
  idempotencyKey:InvitationIdempotencyKey.optional(),
}).strict().refine(value=>(value.needId!==undefined)!==(value.jobId!==undefined),{message:'Выберите ровно одну вакансию или запрос.'})
  .refine(value=>value.jobId===undefined||value.contextVersion!==undefined,{message:'Укажите редакцию вакансии.'});
export function invitationContextSnapshot(context:SelectionContextDto,conditions:{title:string;salaryMin:number;salaryMax:number;salaryPeriod:string;salaryType:string;workFormat:string}) {
  return JSON.parse(JSON.stringify({...context,invitationConditions:conditions})) as Record<string,unknown>;
}

type InvitationConditions = {resumeId:number|null;title:string;message:string;reason:string;salaryMin:number;salaryMax:number;salaryPeriod:string;salaryType:string;workFormat:string};
/** A new action may reuse a pending invitation only when it promises exactly
 * the same CV and sent conditions. The same-key receipt is handled earlier. */
export function pendingInvitationCompatible(existing:InvitationConditions & {contextVersion:number|null;resumeSnapshot:Record<string,unknown>|null},
  input:InvitationConditions,prepared:{contextVersion:number;resumeRevision:number}) {
  const fields = ['resumeId','title','message','reason','salaryMin','salaryMax','salaryPeriod','salaryType','workFormat'] as const;
  return fields.every(field=>existing[field]===input[field])
    && (existing.contextVersion===null || existing.contextVersion===prepared.contextVersion)
    && (typeof existing.resumeSnapshot?.revision!=='number' || existing.resumeSnapshot.revision===prepared.resumeRevision);
}
