/** Projections are built from an allowlist, never by deleting known private keys.
 * Historical snapshots remain unchanged in storage and visible to their owner. */
export const PRIVATE_REQUEST_INVITATION_LABEL = 'Приглашение по запросу компании';
export type InvitationAudience = 'candidate' | 'employer';
type InvitationProjectionInput = {
  needId:number|null; jobId:number|null; contextVersion:number|null;
  contextSnapshot:Record<string,unknown>|null;
  title:string; salaryMin:number; salaryMax:number; salaryPeriod:string; salaryType:string; workFormat:string;
};

export function invitationContextProjection(invitation:InvitationProjectionInput, audience:InvitationAudience,
  availability:{owner:boolean;candidate:boolean} = {owner:false,candidate:false}) {
  const type = invitation.jobId !== null ? 'job' as const : 'need' as const;
  const id = invitation.jobId ?? invitation.needId;
  const saved = invitation.contextSnapshot;
  const savedTitle = typeof saved?.title === 'string' && saved.title.trim() ? saved.title : null;
  // A draft job is not public. Only a snapshot captured while published may
  // supply its public title; explicitly sent text is independently preserved.
  const title = audience === 'employer' ? savedTitle ?? invitation.title
    : type === 'need' ? PRIVATE_REQUEST_INVITATION_LABEL
    : saved?.status === 'published' ? savedTitle ?? invitation.title : invitation.title;
  const context = {type,id,version:invitation.contextVersion,title,
    available:audience === 'employer' ? availability.owner : type === 'job' && availability.candidate};
  const contextSnapshot = audience === 'employer' ? saved : {
    type,id,version:invitation.contextVersion,title,
    invitationConditions:{title:invitation.title,salaryMin:invitation.salaryMin,salaryMax:invitation.salaryMax,
      salaryPeriod:invitation.salaryPeriod,salaryType:invitation.salaryType,workFormat:invitation.workFormat},
  };
  return {context,contextSnapshot};
}

type PublicCompanyInput = {id:number;name:string;description:string;industry:string;
  contactEmail:string;contactPhone:string|null;contactMethod:string};
/** These are the company's intended public profile/contact fields. Owner IDs,
 * tax IDs, moderation state and future internal fields cannot pass through. */
export function invitationPublicCompany(company:PublicCompanyInput|null|undefined) {
  return company ? {id:company.id,name:company.name,description:company.description,industry:company.industry,
    contactEmail:company.contactEmail,contactPhone:company.contactPhone,contactMethod:company.contactMethod} : null;
}
