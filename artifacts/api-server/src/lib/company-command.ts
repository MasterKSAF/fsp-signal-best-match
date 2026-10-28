import { createHash,randomUUID } from 'node:crypto';
import { and,eq,sql } from 'drizzle-orm';
import { db,signalCompanyCommandsTable as commands } from '@workspace/db';
import { canonicalJson } from './canonical-json';
import { RefinementError,type PreviewActor } from './requirement-preview';
export type CompanyTransaction=Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function findCompanyCommand(actor:PreviewActor,key:string,payload:unknown,authorize:(tx:CompanyTransaction)=>Promise<unknown>) {
 return db.transaction(async tx=>{
  await authorize(tx);
  const [prior]=await tx.select().from(commands).where(and(eq(commands.companyId,actor.companyId),eq(commands.actorId,actor.actorId),eq(commands.commandKey,key)));
  if(!prior)return null;
  const payloadHash=createHash('sha256').update(canonicalJson(payload)).digest('hex');
  if(prior.payloadHash!==payloadHash)throw new RefinementError(409,'command_conflict','Ключ уже использован для другой команды.');return prior.result;
 });
}
/** Authorization runs before replay. Mutation and receipt commit together. */
export async function runCompanyCommand(actor:PreviewActor,key:string,payload:unknown,authorize:(tx:CompanyTransaction)=>Promise<unknown>,mutate:(tx:CompanyTransaction)=>Promise<Record<string,unknown>>) {
 if(!key.trim()||key.length>180)throw new RefinementError(400,'invalid_command','Укажите ключ команды.');
 const payloadHash=createHash('sha256').update(canonicalJson(payload)).digest('hex');
 return db.transaction(async tx=>{
  await authorize(tx);
  const lockKey=`signal-command:${actor.companyId}:${actor.actorId}:${key}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))`);
  const [prior]=await tx.select().from(commands).where(and(eq(commands.companyId,actor.companyId),eq(commands.actorId,actor.actorId),eq(commands.commandKey,key)));
  if(prior){if(prior.payloadHash!==payloadHash)throw new RefinementError(409,'command_conflict','Ключ уже использован для другой команды.');return prior.result;}
  const result=await mutate(tx);
  await tx.insert(commands).values({id:randomUUID(),...actor,commandKey:key,payloadHash,result});return result;
 });
}
