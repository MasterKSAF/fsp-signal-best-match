import assert from 'node:assert/strict';
import test from 'node:test';
import { SubmitComplaintSchema, ComplaintDecisionSchema, complaintTransitionAllowed } from '../artifacts/api-server/src/lib/signal-trust-contract.ts';
const input = {objectType:'service',objectId:123,category:'technical',explanation:'После сохранения не отображаются изменения.',idempotencyKey:'service-test-1'};
test('support uses a real bounded message and rejects forged ownership/decision fields',()=>{
  assert.ok(SubmitComplaintSchema.safeParse(input).success);
  for(const patch of [{explanation:'  коротко  '},{explanation:'a'.repeat(2001)},{companyId:5},{reporterUserId:77},{status:'resolved'},{objectId:0}]) assert.equal(SubmitComplaintSchema.safeParse({...input,...patch}).success,false);
});
test('old company complaints remain valid; new service decisions have a terminal state',()=>{
  assert.ok(SubmitComplaintSchema.safeParse({...input,objectType:'job',category:'spam',explanation:''}).success);
  assert.ok(ComplaintDecisionSchema.safeParse({action:'resolve',reason:'Изменения проверены.'}).success);
  assert.equal(complaintTransitionAllowed('in_review','resolve'),true);
  for(const action of ['review','dismiss','restrict','resolve'] as const) assert.equal(complaintTransitionAllowed('resolved',action),false);
});
