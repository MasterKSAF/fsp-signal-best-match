import { pgTable, uuid, integer, text, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { signalCompaniesTable, signalUsersTable } from './fsp-signal';
export const signalCompanyCommandsTable=pgTable('signal_company_commands',{
 id:uuid('id').primaryKey(),companyId:integer('company_id').notNull().references(()=>signalCompaniesTable.id),actorId:integer('actor_id').notNull().references(()=>signalUsersTable.id),
 commandKey:text('command_key').notNull(),payloadHash:text('payload_hash').notNull(),result:jsonb('result').$type<Record<string,unknown>>().notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('signal_company_command_unique').on(t.companyId,t.actorId,t.commandKey)]);
