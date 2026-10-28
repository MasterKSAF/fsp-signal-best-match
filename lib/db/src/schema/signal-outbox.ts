import {pgTable,uuid,text,integer,jsonb,timestamp,bigserial,uniqueIndex,numeric} from 'drizzle-orm/pg-core';
import {signalCompaniesTable as companies,signalUsersTable as users} from './fsp-signal';
export const signalAtsEndpointsTable=pgTable('signal_ats_endpoints',{
 id:uuid('id').primaryKey(),companyId:integer('company_id').notNull().references(()=>companies.id),actorId:integer('actor_id').notNull().references(()=>users.id),url:text('url').notNull(),secretCipher:text('secret_cipher').notNull(),active:integer('active').notNull().default(1),revision:integer('revision').notNull().default(1),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('signal_ats_company_unique').on(t.companyId)]);
export const signalOutboxTable=pgTable('signal_outbox',{
 id:uuid('id').primaryKey(),sequence:bigserial('sequence',{mode:'bigint'}).notNull(),companyId:integer('company_id').notNull().references(()=>companies.id),entityType:text('entity_type').notNull(),entityId:integer('entity_id').notNull(),eventType:text('event_type').notNull(),payload:jsonb('payload').$type<Record<string,unknown>>().notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const signalOutboxDeliveriesTable=pgTable('signal_outbox_deliveries',{
 id:uuid('id').primaryKey(),eventId:uuid('event_id').notNull().references(()=>signalOutboxTable.id),endpointId:uuid('endpoint_id').notNull().references(()=>signalAtsEndpointsTable.id),endpointRevision:integer('endpoint_revision').notNull(),state:text('state').notNull().default('queued'),fence:integer('fence').notNull().default(0),attempts:integer('attempts').notNull().default(0),leaseUntil:timestamp('lease_until',{withTimezone:true}),nextAt:timestamp('next_at',{withTimezone:true}).notNull().defaultNow(),lastCode:text('last_code'),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('signal_outbox_endpoint_event_unique').on(t.endpointId,t.eventId)]);
export const signalWebhookInboxTable=pgTable('signal_webhook_inbox',{
 eventId:uuid('event_id').primaryKey(),bodyHash:text('body_hash').notNull(),receivedAt:timestamp('received_at',{withTimezone:true}).notNull().defaultNow(),
});
export const signalWebhookProjectionTable=pgTable('signal_webhook_projection',{
 key:text('key').primaryKey(),version:numeric('version',{precision:30,scale:0}).notNull(),body:jsonb('body').$type<Record<string,unknown>>().notNull(),effects:integer('effects').notNull().default(1),
});
