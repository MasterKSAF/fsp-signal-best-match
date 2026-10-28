import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, signalInvitationsTable as invitations, signalInvitationEventsTable as events, signalInvitationBudgetConsumptionTable as consumption } from '@workspace/db';
import { invitationQuotaLimit, INVITATION_WINDOW_MS } from './signal-invitation-policy';
export const INVITATION_OBSERVATION_DAYS=7;
type Invitation=typeof invitations.$inferSelect;
type Event=typeof events.$inferSelect;
const median=(values:number[])=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};
export function summarizeInvitationCohort(rows:Invitation[],timeline:Event[],now:Date,privateAggregate:boolean){
 const first=new Map<number,Map<string,Date>>();
 for(const event of timeline){const map=first.get(event.invitationId)??new Map();if(!map.has(event.kind)||map.get(event.kind)!>event.occurredAt)map.set(event.kind,event.occurredAt);first.set(event.invitationId,map);}
 const kinds=['sent','viewed','accepted','declined','withdrawn','expired'];
 const counts=Object.fromEntries(kinds.map(kind=>[kind,kind==='sent'?rows.length:rows.filter(r=>first.get(r.id)?.has(kind)).length]));
 // Only a completed seven-day window enters this denominator. A response
 // after that window is retained in the timeline but not relabelled timely.
 const mature=rows.filter(r=>r.createdAt.getTime()+INVITATION_OBSERVATION_DAYS*86400000<=now.getTime());
 const responseTimes=mature.flatMap(row=>{const map=first.get(row.id),response=map?.get('accepted')??map?.get('declined');if(!response||response.getTime()>row.createdAt.getTime()+7*86400000)return [];return [(response.getTime()-row.createdAt.getTime())/3600000];});
 const reasons=['conditions','format','direction','timing','other'].map(reason=>({reason,count:rows.filter(r=>r.status==='declined'&&r.declineReason===reason).length}));
 const sensitive=privateAggregate&&rows.length<5;
 const matureSmall=privateAggregate&&mature.length<5;
 const reasonsSafe=!privateAggregate||reasons.every(r=>r.count===0||r.count>=5);
 const comparable=rows.filter(r=>r.salaryPeriod==='month'&&r.salaryType==='gross'&&r.salaryMin>0&&r.salaryMax>=r.salaryMin);
 return {observationDays:7,total:sensitive?null:rows.length,counts:sensitive?null:counts,
  statusCounts:sensitive?null:Object.fromEntries(kinds.map(kind=>[kind,rows.filter(r=>r.status===kind).length])),
  timelyResponse:matureSmall?null:{denominator:mature.length,responses:responseTimes.length,rate:mature.length?responseTimes.length/mature.length:null,medianHours:median(responseTimes)},
  declineReasons:sensitive||!reasonsSafe?null:reasons,
  salary:privateAggregate&&comparable.length<5?null:{n:comparable.length,medianMidpoint:median(comparable.map(r=>(r.salaryMin+r.salaryMax)/2)),currency:'RUB',period:'month',tax:'gross'},
  suppressed:sensitive,legacyTimelineIncomplete:rows.some(r=>['viewed','accepted','declined','withdrawn','expired'].includes(r.status)&&!first.get(r.id)?.has(r.status)),
 };
}
export function invitationPeriodStart(days:7|28|90,now=new Date()){const start=new Date(now);start.setUTCHours(0,0,0,0);start.setUTCDate(start.getUTCDate()-days);return start;}
export async function invitationAnalytics(input:{companyId?:number;candidateId?:number;context?:{type:'job'|'need';id:number};days:7|28|90}){
 if((input.companyId===undefined)===(input.candidateId===undefined))throw new Error('Exactly one analytics audience');
 const now=new Date(),from=invitationPeriodStart(input.days,now);
 const rows=await db.select().from(invitations).where(and(input.companyId!==undefined?eq(invitations.companyId,input.companyId):eq(invitations.candidateUserId,input.candidateId!),gte(invitations.createdAt,from),lte(invitations.createdAt,now),input.context?(input.context.type==='job'?eq(invitations.jobId,input.context.id):eq(invitations.needId,input.context.id)):undefined));
 const timeline=rows.length?await db.select().from(events).where(inArray(events.invitationId,rows.map(r=>r.id))):[];
 const summary=summarizeInvitationCohort(rows,timeline,now,input.companyId!==undefined);
 return {period:{days:input.days,from:from.toISOString(),to:now.toISOString()},...summary,
  ...(input.candidateId!==undefined?{uniqueCompanies:new Set(rows.map(r=>r.companyId)).size,market:{state:'unavailable',reason:'Нет разрешённой обезличенной выборки достаточного размера.'}}:{}),
  definitions:{counts:'Количество приглашений с первым достоверным событием. Просмотр учитывается только после открытия предложения.',statusCounts:'Текущие состояния; ожидающие ответа не являются отказами.',timelyResponse:'Ответ в течение семи дней. В знаменателе только приглашения с завершённым семидневным окном.',salary:'Медиана середины фактических месячных вилок до налогов; годовые и чистые суммы не смешиваются.',privacy:'В закрытых группах меньше пяти наблюдений показатели скрываются; редкие причины скрывают весь разрез причин.'}};
}
export async function invitationBudget(companyId:number){const now=new Date(),from=new Date(now.getTime()-INVITATION_WINDOW_MS);const [row]=await db.select({spent:sql<number>`count(*)::int`}).from(consumption).where(and(eq(consumption.companyId,companyId),gte(consumption.spentAt,from),lte(consumption.spentAt,now)));const limit=invitationQuotaLimit();return {limit,spent:row.spent,remaining:Math.max(0,limit-row.spent),windowHours:24,refundable:false,configured:process.env.SIGNAL_INVITATIONS_PER_24H!==undefined};}
export async function expireInvitations(){
 const now=new Date();
 const due=await db.select({id:invitations.id}).from(invitations).where(and(inArray(invitations.status,['sent','viewed']),lte(invitations.expiresAt,now))).limit(200);
 if(due.length)await db.update(invitations).set({status:'expired',updatedAt:now}).where(and(inArray(invitations.id,due.map(r=>r.id)),inArray(invitations.status,['sent','viewed']),lte(invitations.expiresAt,now)));
}
export function startInvitationExpiry(){const run=()=>expireInvitations().catch(()=>{});const timer=setInterval(()=>void run(),60_000);timer.unref();void run();return()=>clearInterval(timer);}
