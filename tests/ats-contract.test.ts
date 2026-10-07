import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAtsContract, type AtsConsent } from '../scripts/ats-contract-example.ts';
test('ATS local contract minimises fields, retries idempotently and honours revocation before retry',()=>{
 const local=new LocalAtsContract(),grant:AtsConsent={id:'grant',companyRef:'company-a',candidateRef:'person-a-only',active:true,scopes:['profile']};
 const candidate={alias:'Synthetic',specialization:'Backend / Python',grade:'Middle',skills:['Python'],contactEmail:'synthetic@example.test',oracle:'secret',userId:1};
 const first=local.deliver('event-1',grant,candidate) as any;
 assert.deepEqual(Object.keys(first.payload).sort(),['alias','grade','skills','specialization']);
 assert.equal(local.deliver('event-1',grant,{...candidate,alias:'changed'}),first);
 grant.active=false;assert.throws(()=>local.deliver('event-1',grant,candidate),/consent_revoked/);
 assert.throws(()=>local.deliver('event-2',grant,candidate),/consent_revoked/);
 const newGrant={...grant,id:'new-explicit-grant',active:true,scopes:['profile','contacts'] as AtsConsent['scopes']};
 assert.equal((local.deliver('event-2',newGrant,candidate) as any).payload.contactEmail,'synthetic@example.test');
});
