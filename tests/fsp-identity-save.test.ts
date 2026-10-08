import assert from 'node:assert/strict';
import test from 'node:test';
import { validFspSaveInput, savedFspIdentityValues, fspDemoFixtureId, fspSignalFromConnection } from '../artifacts/api-server/src/lib/fsp-provider';

test('identity Save accepts an opaque ID without consent and refuses provider claims/import coercion',()=>{
  assert.deepEqual(validFspSaveInput({fspId:' ID-22:K '}),{fspId:'ID-22:K'});
  for (const body of [{fspId:'ID',consentImport:true},{fspId:'ID',verified:true},{fspId:'ID',achievements:[]},{fspId:'https://registry/id'},{fspId:''},[],null]) assert.equal(validFspSaveInput(body),null);
});
test('normal and fixture-looking IDs are stored unverified without consent, import, achievements or bonus',()=>{
  for (const fspId of ['MY-ID',fspDemoFixtureId]) {
    const now=new Date('2026-10-08T11:11:00Z'); const saved=savedFspIdentityValues(fspId,now);
    assert.equal(saved.fspId,fspId); assert.equal(saved.status,'pending'); assert.equal(saved.provenance,'user_supplied'); assert.equal(saved.requestedAt,now);
    for (const key of ['consentVersion','consentedAt','verifiedAt','importedAt','providerVersion']) assert.equal(saved[key as keyof typeof saved],null);
    assert.deepEqual(saved.achievements,[]);
    const signal=fspSignalFromConnection(saved,{accountIsDemo:true,demoEnabled:true});
    assert.equal(signal.historyStatus,'unverified'); assert.equal(signal.bonus,0); assert.equal(signal.bestResult,null);
  }
});
test('replacement clears earlier verified/imported synthetic claims instead of carrying them to a new ID',()=>{
  const original={fspId:fspDemoFixtureId,status:'connected_demo',verifiedAt:new Date(),consentedAt:new Date(),consentVersion:'previous',providerVersion:'previous',achievements:[{id:'fixture'}],provenance:'synthetic_fixture'};
  const replacement={...original,...savedFspIdentityValues('NEW-ID',new Date('2026-10-08T12:00:00Z'))};
  assert.equal(replacement.verifiedAt,null); assert.equal(replacement.consentedAt,null); assert.equal(replacement.provenance,'user_supplied'); assert.deepEqual(replacement.achievements,[]);
});

