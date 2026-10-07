import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export type AtsConsent = { id:string; companyRef:string; candidateRef:string; active:boolean; scopes:Array<'profile'|'contacts'> };
export type AtsRecord = { alias:string; specialization:string; grade:string|null; skills:string[]; contactEmail?:string; [key:string]:unknown };
/** Synthetic contract harness, deliberately without a network client. */
export class LocalAtsContract {
  private deliveries=new Map<string,unknown>();
  deliver(eventId:string,grant:AtsConsent,record:AtsRecord) {
    if(!grant.active)throw new Error('consent_revoked');
    if(!grant.scopes.includes('profile'))throw new Error('missing_profile_scope');
    if(this.deliveries.has(eventId))return this.deliveries.get(eventId);
    const value={schemaVersion:'signal-ats-v1',eventId,eventType:'candidate.consented',companyRef:grant.companyRef,candidateRef:grant.candidateRef,consent:{ref:grant.id,version:'ats-export-v1',scopes:grant.scopes},payload:{alias:record.alias,specialization:record.specialization,grade:record.grade,skills:record.skills,...(grant.scopes.includes('contacts')&&record.contactEmail?{contactEmail:record.contactEmail}:{})}};
    this.deliveries.set(eventId,value);return value;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const local=new LocalAtsContract(),eventId=randomUUID();
 const consent:AtsConsent={id:'synthetic-grant',companyRef:'synthetic-company',candidateRef:'synthetic-person-per-company',active:true,scopes:['profile']};
 const candidate={alias:'Учебный кандидат',specialization:'Backend / Python',grade:'Middle',skills:['Python','SQL'],contactEmail:'synthetic@example.test',secretAnswer:'must-not-export'};
 console.log(JSON.stringify({mode:'local contract example; no external integration',event:local.deliver(eventId,consent,candidate),repeatIsSame:local.deliver(eventId,consent,candidate)===local.deliver(eventId,consent,candidate)},null,2));
 consent.active=false;try{local.deliver(eventId,consent,candidate);}catch{console.log('Revoked consent blocks even an old retry');}
}
