import { randomInt, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, signalUsersTable as users, signalVerificationTokensTable as tokens, signalConsentsTable as consents,
  signalCandidateProfilesTable as profiles, signalCompaniesTable as companies } from '@workspace/db';
import { hashPassword, hashVerificationCode } from './signal-auth';
import { registrationProofFields } from './registration-proof';

type RegistrationInput = { email: string; password: string; role: 'candidate' | 'employer'; displayName: string };
type RegistrationWriter = Pick<typeof db,'execute'|'select'|'delete'>;

async function hasDependentRecords(writer: RegistrationWriter, parent: string, id: number, ignored: string[] = []) {
  // Legacy pending accounts may have provisional role rows. Check their actual
  // foreign-key dependents before removing a row; never cascade old evidence.
  const references=await writer.execute<{tableName:string;columnName:string;keyCount:number}>(sql`
    select c.relname as "tableName",a.attname as "columnName",array_length(fk.conkey,1) as "keyCount"
    from pg_constraint fk join pg_class c on c.oid=fk.conrelid
    join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=fk.conkey[1]
    where fk.contype='f' and fk.confrelid=${`public.${parent}`}::regclass and n.nspname='public'`);
  const relevant=references.rows.filter(row=>!ignored.includes(row.tableName));
  for (const row of relevant) if(row.keyCount!==1 || !/^signal_[a-z0-9_]+$/.test(row.tableName) || !/^[a-z0-9_]+$/.test(row.columnName)) throw new Error('Unsupported provisional account dependency');
  if (!relevant.length) return false;
  const parts=relevant.map(row=>sql`select 1 as present from ${sql.identifier(row.tableName)} where ${sql.identifier(row.columnName)}=${id}`);
  const result=await writer.execute(sql`${sql.join(parts,sql` union all `)} limit 1`);
  return result.rows.length>0;
}

async function clearProvisionalOppositeRole(writer: RegistrationWriter, user: typeof users.$inferSelect, role: 'candidate'|'employer') {
  if (user.role===role) return true;
  if (await hasDependentRecords(writer,'signal_users',user.id,['signal_verification_tokens','signal_consents','signal_candidate_profiles','signal_companies'])) return false;
  const [audit]=await writer.execute(sql`select id from signal_trust_audit where actor_user_id=${user.id} limit 1`).then(result=>result.rows);
  if(audit) return false;
  if (role==='employer') {
    const [profile]=await writer.select().from(profiles).where(eq(profiles.userId,user.id)).limit(1);
    if(profile && (profile.professionalAlias!==user.displayName || profile.contactEmail!==user.email ||
      profile.avatarDataUrl!==null || profile.avatarUpdatedAt!==null || profile.legacyQualification!==null ||
      profile.specialization!=='Backend / Python' || profile.assumedGrade!=='Junior' || profile.verifiedGrade!==null ||
      profile.verifiedGradeChangedAt!==null || profile.verifiedScore!==null || profile.verifiedSkills.length>0 ||
      profile.stack.length>0 || profile.skills.length>0 || profile.yearsExperience!==0 || profile.workFormat!=='Удалённо' ||
      profile.salaryMin!==null || profile.salaryMax!==null || profile.salaryPeriod!=='month' || profile.salaryType!=='gross' ||
      profile.visibility==='public' || profile.consentMatching || profile.phone!==null || profile.hasFspHistory ||
      profile.latestAssessmentAt!==null || await hasDependentRecords(writer,'signal_candidate_profiles',user.id))) return false;
    if(profile) await writer.delete(profiles).where(eq(profiles.userId,user.id));
  } else {
    const [company]=await writer.select().from(companies).where(eq(companies.ownerUserId,user.id)).limit(1);
    if(company) {
      if(company.name!==user.displayName || company.contactEmail!==user.email || company.description!=='' ||
        company.industry!=='Информационные технологии' || company.contactPhone!==null ||
        company.contactMethod!=='Электронная почта' || await hasDependentRecords(writer,'signal_companies',company.id)) return false;
      const result=await writer.execute(sql`select id from signal_trust_audit where company_id=${company.id} limit 1`);
      if(result.rows.length) return false;
      await writer.delete(companies).where(eq(companies.id,company.id));
    }
  }
  return true;
}

export async function preparePendingRegistration(input: RegistrationInput, consentVersion: string, lifetimeMs: number) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async tx => {
    // Also serializes the first registration before a user row exists.
    await tx.execute(sql`select pg_advisory_xact_lock(4101, hashtext(${input.email}))`);
    let [user] = await tx.select().from(users).where(eq(users.email,input.email)).limit(1).for('update');
    if (!user) [user] = await tx.insert(users).values({email:input.email,passwordHash,role:input.role,displayName:input.displayName,emailVerified:false,demoMode:false}).returning();
    if (!user) throw new Error('Registration did not create an account');
    const registrationId=randomUUID();
    if (user.emailVerified || user.demoMode) return { userId:user.id, code:null, registrationId };
    // Never reuse a historical code for a different credential snapshot,
    // including legacy consumed tokens. A stale known code cannot revive.
    let code: string | undefined;
    for (let draw=0;draw<32;draw++) {
      const candidate=String(randomInt(100000,1000000));
      const [collision]=await tx.select({id:tokens.id}).from(tokens).where(and(eq(tokens.userId,user.id),eq(tokens.tokenHash,hashVerificationCode(candidate)))).limit(1);
      if (!collision) { code=candidate;break; }
    }
    if (!code) throw new Error('Registration challenge could not be allocated');
    const now=new Date();
    await tx.update(tokens).set({consumedAt:now}).where(and(eq(tokens.userId,user.id),isNull(tokens.consumedAt)));
    await tx.insert(tokens).values({userId:user.id,registrationId,tokenHash:hashVerificationCode(code),expiresAt:new Date(+now+lifetimeMs),
      pendingPasswordHash:passwordHash,pendingRole:input.role,pendingDisplayName:input.displayName,pendingConsentVersion:consentVersion});
    return {userId:user.id,code,registrationId};
  });
}

export async function consumePendingRegistration(email: string, code: string, registrationId: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(4101, hashtext(${email}))`);
    const [user]=await tx.select().from(users).where(eq(users.email,email)).limit(1).for('update');
    if (!user || user.emailVerified || user.demoMode) return null;
    const now=new Date();
    const [proof]=await tx.select().from(tokens).where(and(eq(tokens.userId,user.id),eq(tokens.registrationId,registrationId),eq(tokens.tokenHash,hashVerificationCode(code)),isNull(tokens.consumedAt),gt(tokens.expiresAt,now))).orderBy(desc(tokens.createdAt)).limit(1).for('update');
    const fields=registrationProofFields(user,proof,now,registrationId);
    if (!fields || !proof) return null;
    if (!await clearProvisionalOppositeRole(tx,user,fields.role)) return null;
    const [consumed]=await tx.update(tokens).set({consumedAt:now}).where(and(eq(tokens.id,proof.id),isNull(tokens.consumedAt))).returning({id:tokens.id});
    if (!consumed) return null;
    await tx.update(tokens).set({consumedAt:now}).where(and(eq(tokens.userId,user.id),isNull(tokens.consumedAt)));
    const [verified]=await tx.update(users).set({passwordHash:fields.passwordHash,role:fields.role,displayName:fields.displayName,emailVerified:true}).where(eq(users.id,user.id)).returning();
    for (const consentType of ['terms','privacy'] as const) {
      const [existing]=await tx.select({id:consents.id}).from(consents).where(and(eq(consents.userId,user.id),eq(consents.consentType,consentType),eq(consents.version,fields.consentVersion))).limit(1);
      if (!existing) await tx.insert(consents).values({userId:user.id,consentType,version:fields.consentVersion});
    }
    if (fields.role === 'candidate') await tx.insert(profiles).values({userId:user.id,professionalAlias:fields.displayName,contactEmail:email,visibility:'private',consentMatching:false})
      .onConflictDoUpdate({target:profiles.userId,set:{professionalAlias:fields.displayName,contactEmail:email}});
    else await tx.insert(companies).values({ownerUserId:user.id,name:fields.displayName,contactEmail:email,contactMethod:'Электронная почта'})
      .onConflictDoUpdate({target:companies.ownerUserId,set:{name:fields.displayName,contactEmail:email}});
    return verified ?? null;
  });
}
