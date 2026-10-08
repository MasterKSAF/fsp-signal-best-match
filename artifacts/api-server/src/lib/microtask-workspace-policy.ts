import { z } from 'zod';
import { microBindingAccessible, microTemplateInput, type MicroLiveResume, type MicroResumeBinding } from './microtask-resume-policy';
import { sameSignalPool, type SignalScopedAccount } from './signal-pool-scope';

export const microTemplateUpdateInput = z.object({version:z.number().int().positive().max(2147483647)}).passthrough()
  .transform(({version,...rest},context)=>{
    const template = microTemplateInput.safeParse(rest);
    if (!template.success) {for (const issue of template.error.issues) context.addIssue(issue); return z.NEVER;}
    return {...template.data,version};
  });
export const microOfferQuery = z.object({
  templateId:z.coerce.number().int().positive().max(2147483647).optional(),
  submittedOnly:z.enum(['0','1']).optional().default('0'),
}).strict();
export function microAnswerSubmitted(offer:{status:string;answer:string|null}) {
  return ['submitted','evaluated'].includes(offer.status) && !!offer.answer?.trim();
}

type CompanyOffer = MicroResumeBinding & {companyId:number;candidateUserId:number;consentRevokedAt:Date|null;acceptedAt:Date|null;result:unknown};
type Company = SignalScopedAccount & {id:number;role:string};
type Candidate = SignalScopedAccount & {id:number;role:string;visibility:string|null;matching:boolean|null;enabled:boolean|null;alias?:string|null;displayName?:string|null};
export function microOfferReadableFromFacts(offer:CompanyOffer, facts:{company:Company|undefined;candidate:Candidate|undefined;resume:MicroLiveResume|undefined;blocked:boolean;companyAllowed:boolean}) {
  const {company,candidate,resume,blocked,companyAllowed} = facts;
  if (offer.consentRevokedAt || !companyAllowed || blocked || !company || company.role !== 'employer' || company.id !== offer.companyId || !candidate || candidate.role !== 'candidate' || candidate.id !== offer.candidateUserId) return false;
  return offer.resumeProvenance === 'captured'
    ? microBindingAccessible(offer,resume,offer.candidateUserId,candidate,company)
    : !!(offer.acceptedAt || offer.result) && candidate.enabled === true && candidate.matching === true && candidate.visibility !== null && candidate.visibility !== 'private' && sameSignalPool(candidate,company);
}

export function microOfferCandidateIdentity(offer:CompanyOffer, facts:Parameters<typeof microOfferReadableFromFacts>[1]) {
  if (!microOfferReadableFromFacts(offer,facts)) return null;
  const visibility = offer.resumeProvenance === 'captured' ? facts.resume?.visibility : facts.candidate?.visibility;
  return {
    alias: facts.candidate?.alias?.trim() || 'Кандидат',
    displayName: visibility === 'public' ? facts.candidate?.displayName?.trim() || null : null,
  };
}
