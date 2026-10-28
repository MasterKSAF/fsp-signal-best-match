import { integer,jsonb,pgTable,text,timestamp,uuid } from 'drizzle-orm/pg-core';
import type { SkillModuleCase,SkillModuleOracle,SkillLevel } from './signal-skill-modules';
export type AdaptiveSavedItem={id:string;familyId:string;competencyId:string;available:boolean;exposure:number;question:SkillModuleCase;oracle:SkillModuleOracle[string];policy:{threshold:number;rubricVersion:string}};
export type AdaptiveSavedAnswer={commandKey:string;itemId:string;familyId:string;competencyId:string;answer:string;receivedAt:string;passed:boolean|null;skipped:boolean;errorCode:string|null};
export const signalAdaptiveSessionsTable=pgTable('signal_adaptive_sessions',{
 id:uuid('id').primaryKey(),userId:integer('user_id').notNull(),parentId:uuid('parent_id').unique(),procedure:text('procedure').notNull(),skillId:text('skill_id').notNull(),level:text('level').$type<SkillLevel>().notNull(),
 bankReleaseHash:text('bank_release_hash').notNull(),seed:text('seed').notNull(),topics:text('topics').array().notNull(),pool:jsonb('pool').$type<AdaptiveSavedItem[]>().notNull(),
 answers:jsonb('answers').$type<AdaptiveSavedAnswer[]>().notNull().default([]),revision:integer('revision').notNull().default(1),currentItemId:text('current_item_id'),
 state:text('state',{enum:['active','finished','refined']}).notNull().default('active'),outcome:text('outcome'),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),deadline:timestamp('deadline',{withTimezone:true}).notNull(),
});
export const signalAdaptiveExposuresTable=pgTable('signal_adaptive_exposures',{
 id:uuid('id').primaryKey(),sessionId:uuid('session_id').notNull(),userId:integer('user_id').notNull(),familyId:text('family_id').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
