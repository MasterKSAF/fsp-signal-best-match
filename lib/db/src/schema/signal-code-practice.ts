import {integer,jsonb,pgTable,text,timestamp,uuid} from 'drizzle-orm/pg-core';
export type CodePracticeReceipt={fence:number;status:string;reason:string|null;imageDigest:string|null;runtimeVersion:string;testVersion:string;passed:number;total:number;finishedAt:string};
export const signalCodePracticeTable=pgTable('signal_code_practice',{
 id:uuid('id').primaryKey(),userId:integer('user_id').notNull(),taskVersion:text('task_version').notNull(),tests:jsonb('tests').$type<{input:unknown;expected:unknown;public:boolean}[]>().notNull(),
 source:text('source'),sourceHash:text('source_hash'),submittedAt:timestamp('submitted_at',{withTimezone:true}),deadline:timestamp('deadline',{withTimezone:true}).notNull(),
 state:text('state',{enum:['draft','queued','running','finished','cancelled']}).notNull().default('draft'),revision:integer('revision').notNull().default(1),fence:integer('fence').notNull().default(0),
 leaseUntil:timestamp('lease_until',{withTimezone:true}),containerName:text('container_name'),imageDigest:text('image_digest'),status:text('status'),
 history:jsonb('history').$type<CodePracticeReceipt[]>().notNull().default([]),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
