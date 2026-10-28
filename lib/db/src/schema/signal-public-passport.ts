import {pgTable,text,uuid,integer,jsonb,timestamp} from 'drizzle-orm/pg-core';
import {signalUsersTable as users} from './fsp-signal';
export type PublicSkillClaim={skillId:string;label:string;level:'Junior'|'Middle'|'Senior';programVersion:string;verifiedAt:string;source:{type:'signal_skill_assessment';attemptId:number;evidenceId:number;bankReleaseHash:string|null;reviewRevision:number}};
export type SignedPassportBody={schema:'signal-voluntary-passport-v1';algorithm:'Ed25519';issuer:string;kid:string;id:string;subject:string;issuedAt:string;expiresAt:string;claims:PublicSkillClaim[]};
export type SignedPassportDocument={body:SignedPassportBody;signature:string};
export const signalPassportKeysTable=pgTable('signal_passport_keys',{
 kid:text('kid').primaryKey(),issuer:text('issuer').notNull(),publicKeyPem:text('public_key_pem').notNull(),state:text('state',{enum:['active','retired','compromised']}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const signalPassportPreviewsTable=pgTable('signal_passport_previews',{
 id:uuid('id').primaryKey(),userId:integer('user_id').notNull().references(()=>users.id),claims:jsonb('claims').$type<PublicSkillClaim[]>().notNull(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),issuedId:uuid('issued_id'),
});
export const signalPublicPassportsTable=pgTable('signal_public_passports',{
 id:uuid('id').primaryKey(),userId:integer('user_id').notNull().references(()=>users.id),document:jsonb('document').$type<SignedPassportDocument>().notNull(),
 state:text('state',{enum:['active','revoked','replaced']}).notNull().default('active'),replacementId:uuid('replacement_id'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const signalPassportEventsTable=pgTable('signal_passport_events',{
 id:uuid('id').primaryKey(),passportId:uuid('passport_id').notNull().references(()=>signalPublicPassportsTable.id),actorId:integer('actor_id').notNull().references(()=>users.id),kind:text('kind').notNull(),replacementId:uuid('replacement_id'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
