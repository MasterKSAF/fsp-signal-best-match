import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { registrationProofFields, type PendingRegistrationProof } from '../artifacts/api-server/src/lib/registration-proof';

const now=new Date('2026-10-08T12:00:00Z');
const ownerPassword='Mailbox-owner-password-strong!';
const salt=randomBytes(16).toString('hex');
const ownerHash=`scrypt:${salt}:${scryptSync(ownerPassword,salt,64).toString('hex')}`;
const account={id:17,emailVerified:false,demoMode:false};
const proof:PendingRegistrationProof={userId:17,registrationId:randomUUID(),tokenHash:'server-hmac',expiresAt:new Date(+now+1800000),consumedAt:null,pendingPasswordHash:ownerHash,pendingRole:'employer',pendingDisplayName:'Владелец почты',pendingConsentVersion:'2026-10-05'};

test('successful proof projects its exact password, role and identity independent of provisional credentials',()=>{
  const projected=registrationProofFields({...account,passwordHash:'attacker-hash',role:'candidate',displayName:'Attacker'} as typeof account,proof,now,proof.registrationId!);
  assert.deepEqual(projected,{passwordHash:ownerHash,role:'employer',displayName:'Владелец почты',consentVersion:'2026-10-05'});
  assert.equal(scryptSync(ownerPassword,salt,64).toString('hex'),projected!.passwordHash.split(':')[2]);
  assert.notEqual(scryptSync('Attacker-password',salt,64).toString('hex'),projected!.passwordHash.split(':')[2]);
  assert.equal(proof.consumedAt,null); // A projection itself cannot mutate/consume the challenge.
});

test('verified/demo accounts, stale/consumed/unbound and foreign-account challenges cannot project credentials',()=>{
  assert.equal(registrationProofFields({...account,emailVerified:true},proof,now,proof.registrationId!),null);
  assert.equal(registrationProofFields({...account,demoMode:true},proof,now,proof.registrationId!),null);
  assert.equal(registrationProofFields(account,undefined,now,proof.registrationId!),null);
  assert.equal(registrationProofFields(account,proof,now,randomUUID()),null);
  for(const change of [{userId:18},{registrationId:null},{expiresAt:now},{expiresAt:new Date(+now-1)},{consumedAt:new Date(+now-1)}]) assert.equal(registrationProofFields(account,{...proof,...change},now,proof.registrationId!),null);
});

test('incomplete or corrupt immutable snapshot is rejected rather than falling back to the account',()=>{
  for(const change of [{pendingPasswordHash:null},{pendingPasswordHash:'plaintext'},{pendingRole:null},{pendingRole:'moderator' as 'candidate'},{pendingDisplayName:null},{pendingDisplayName:'A'},{pendingConsentVersion:null},{registrationId:'not-a-registration-version'}]) assert.equal(registrationProofFields(account,{...proof,...change},now,proof.registrationId!),null);
  assert.deepEqual(registrationProofFields(account,proof,now,proof.registrationId!)?.role,'employer');
});
