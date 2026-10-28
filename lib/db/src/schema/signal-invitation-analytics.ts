import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
export const signalInvitationBudgetConsumptionTable=pgTable('signal_invitation_budget_consumption',{
 invitationId:integer('invitation_id').primaryKey(),companyId:integer('company_id').notNull(),spentAt:timestamp('spent_at',{withTimezone:true}).notNull(),source:text('source').notNull(),
},t=>[index('signal_invitation_budget_window_idx').on(t.companyId,t.spentAt)]);
export const signalInvitationEventsTable=pgTable('signal_invitation_events',{
 id:uuid('id').primaryKey().defaultRandom(),invitationId:integer('invitation_id').notNull(),companyId:integer('company_id').notNull(),
 kind:text('kind',{enum:['sent','viewed','accepted','declined','withdrawn','expired']}).notNull(),occurredAt:timestamp('occurred_at',{withTimezone:true}).notNull(),source:text('source').notNull(),
},t=>[uniqueIndex('signal_invitation_event_once').on(t.invitationId,t.kind),index('signal_invitation_events_company_idx').on(t.companyId,t.occurredAt)]);
