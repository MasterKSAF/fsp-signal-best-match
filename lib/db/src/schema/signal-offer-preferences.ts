import {pgTable,integer,text,boolean,jsonb,primaryKey} from 'drizzle-orm/pg-core';
import {signalCandidateResumesTable as resumes} from './signal-resume';
import {signalCompaniesTable as companies} from './fsp-signal';
export type CandidateOfferPreferences={formats:string[];locations:string[];timeZones:string[];employment:string[]};
export type EmployerOfferConditions={location:string|null;timeZone:string|null;employment:string|null};
export const signalOfferPreferencesTable=pgTable('signal_offer_preferences',{
 resumeId:integer('resume_id').primaryKey().references(()=>resumes.id),shared:boolean('shared').notNull().default(false),revision:integer('revision').notNull().default(1),preferences:jsonb('preferences').$type<CandidateOfferPreferences>().notNull(),
});
export const signalOfferConditionsTable=pgTable('signal_offer_conditions',{
 companyId:integer('company_id').notNull().references(()=>companies.id),contextType:text('context_type',{enum:['job','need']}).notNull(),contextId:integer('context_id').notNull(),revision:integer('revision').notNull().default(1),conditions:jsonb('conditions').$type<EmployerOfferConditions>().notNull(),
},t=>[primaryKey({columns:[t.companyId,t.contextType,t.contextId]})]);
