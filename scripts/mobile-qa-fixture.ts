/** Minimal ordinary verified synthetic accounts for full UI routes.
 * No résumé/questionnaire, assessment, acceptance, application or task is filled.
 * Credentials and IDs are private; cleanup validates exact ID/email ownership.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { db, pool, signalUsersTable as users } from '../lib/db/src/index.ts';
import { hashPassword, ensureCandidateProfile, ensureEmployerCompany } from '../artifacts/api-server/src/lib/signal-auth.ts';
const filename='outputs/local-backup/mobile-qa.json', origin=process.env.BROWSER_QA_ORIGIN||'http://127.0.0.1:4310';
for(const value of [process.env.DATABASE_URL!,origin])assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname),'Local only');
await mkdir('outputs/local-backup',{recursive:true});
try {
 if(process.argv.includes('--cleanup')){
  const fixture=JSON.parse(await readFile(filename,'utf8'));assert.match(fixture.fixtureId,/^mobile-qa-[0-9a-f-]{36}$/);
  for(const [key,suffix,role] of [['candidate','candidate','candidate'],['employer','employer','employer'],['formCandidate','candidate-form','candidate']] as const){
   const record=fixture[key];if(!record)continue;assert.equal(record.email,`${fixture.fixtureId}-${suffix}@example.test`);assert.ok(Number.isSafeInteger(record.id)&&record.id>0);
   await db.delete(users).where(and(eq(users.id,record.id),eq(users.email,record.email),eq(users.demoMode,false),eq(users.role,role)));
   assert.equal((await db.select({id:users.id}).from(users).where(eq(users.id,record.id))).length,0);
  }
  await writeFile(filename,JSON.stringify({...fixture,cleanedAt:new Date().toISOString()},null,2));
  console.log('Exact captured mobile synthetic accounts and dependent records removed.');
 }else if(process.argv.includes('--form-account')){
  const fixture=JSON.parse(await readFile(filename,'utf8'));assert.match(fixture.fixtureId,/^mobile-qa-[0-9a-f-]{36}$/);assert.ok(fixture.setupCompletedAt&&!fixture.cleanedAt,'Original live fixture is required');
  assert.ok(!fixture.formCandidate,'An existing form account must not be replaced');
  const email=`${fixture.fixtureId}-candidate-form@example.test`,password=`Signal-${randomUUID()}`;
  const [user]=await db.insert(users).values({email,passwordHash:await hashPassword(password),role:'candidate',displayName:'Елена Миронова',emailVerified:true,demoMode:false}).returning();assert.ok(user);
  fixture.formCandidate={id:user.id,email,password,provenance:'Separate minimal ordinary synthetic account to inspect assessment-form UI without altering an existing category or cooldown.'};
  await writeFile(filename,JSON.stringify(fixture,null,2));await ensureCandidateProfile(user);
  console.log('Additional minimal synthetic form candidate ready; private credentials saved. Original two accounts retained.');
 }else{
  let prior:any;try{prior=JSON.parse(await readFile(filename,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  assert.ok(!prior||prior.cleanedAt,'Existing fixture must be completed/cleaned before replacement');
  const fixtureId=`mobile-qa-${randomUUID()}`, metadata:any={fixtureId,origin,createdAt:new Date().toISOString(),provenance:'Locally inserted ordinary verified synthetic accounts for browser technical QA, not real people or registration/confirmation observations.',cleanup:'node --env-file-if-exists=.env --import tsx scripts/mobile-qa-fixture.ts --cleanup'};
  for(const role of ['candidate','employer'] as const){
   const email=`${fixtureId}-${role}@example.test`,password=`Signal-${randomUUID()}`;
   const [user]=await db.insert(users).values({email,passwordHash:await hashPassword(password),role,displayName:role==='candidate'?'Мария Соколова':'Анна Волкова',emailVerified:true,demoMode:false}).returning();assert.ok(user);
   metadata[role]={id:user.id,email,password};await writeFile(filename,JSON.stringify(metadata,null,2));
   if(role==='candidate')await ensureCandidateProfile(user);else await ensureEmployerCompany(user);
  }
  metadata.setupCompletedAt=new Date().toISOString();await writeFile(filename,JSON.stringify(metadata,null,2));
  console.log('Two minimal ordinary synthetic accounts ready; private credentials only in outputs/local-backup/mobile-qa.json. No workflows pre-completed.');
 }
}finally{await pool.end();}
