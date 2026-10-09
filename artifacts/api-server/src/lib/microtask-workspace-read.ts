import {and,desc,eq,inArray,isNull} from 'drizzle-orm';
import {db,signalMicroOffersTable as offers,signalMicroSubscriptionsTable as subscriptions,signalMicroTemplatesTable as templates,signalUsersTable as users} from '@workspace/db';
import {loadCompanyOfferAccess} from './microtask-company-read';
import {microAnswerSubmitted} from './microtask-workspace-policy';
import {signalPoolPredicate,type SignalPoolScope} from './signal-pool-scope';
import {MICRO_LEGACY_LIMITATION} from './microtask-resume-policy';

/** Cards and filtered pages consume this same freshly-authorized answer set. */
export async function readCompanyMicroAnswers(companyId:number,scope:SignalPoolScope,templateId?:number) {
  const rows=await db.select({offer:offers,templateId:subscriptions.templateId}).from(offers)
    .innerJoin(subscriptions,eq(subscriptions.id,offers.subscriptionId)).innerJoin(templates,eq(templates.id,subscriptions.templateId)).innerJoin(users,eq(users.id,offers.candidateUserId))
    .where(and(eq(offers.companyId,companyId),eq(templates.companyId,companyId),signalPoolPredicate(users,scope),inArray(offers.status,['submitted','evaluated']),isNull(offers.consentRevokedAt),templateId?eq(templates.id,templateId):undefined))
    .orderBy(desc(offers.submittedAt),desc(offers.id));
  const access=await loadCompanyOfferAccess(companyId,rows.map(row=>row.offer));
  return rows.flatMap(({offer,templateId})=>{
    const permission=access.get(offer.id);if(!permission?.readable||!microAnswerSubmitted(offer))return [];
    return [{...offer,templateId,candidateUserId:undefined,candidateIdentity:permission.candidateIdentity,alias:permission.candidateIdentity?.alias??'Кандидат',resumeAvailable:true,resumeLimitation:offer.resumeProvenance==='legacy_unbound'?MICRO_LEGACY_LIMITATION:null}];
  });
}
/** A recipient is a readable exact subscription, not every row ever assigned. */
export async function readCompanyMicroRecipients(companyId:number,scope:SignalPoolScope,templateId?:number) {
  const rows=await db.select({subscription:subscriptions}).from(subscriptions).innerJoin(templates,eq(templates.id,subscriptions.templateId)).innerJoin(users,eq(users.id,subscriptions.candidateUserId))
    .where(and(eq(templates.companyId,companyId),signalPoolPredicate(users,scope),templateId?eq(templates.id,templateId):undefined)).orderBy(desc(subscriptions.createdAt),desc(subscriptions.id));
  const access=await loadCompanyOfferAccess(companyId,rows.map(({subscription})=>({...subscription,companyId,consentRevokedAt:null,acceptedAt:null,result:null})));
  return rows.flatMap(({subscription})=>{
    const permission=access.get(subscription.id);if(!permission?.readable)return [];
    return [{id:subscription.id,templateId:subscription.templateId,resumeId:subscription.resumeId,resumeTitle:subscription.resumeContext?.title??'Резюме',candidateIdentity:permission.candidateIdentity,active:subscription.active,nextDueAt:subscription.nextDueAt}];
  });
}
