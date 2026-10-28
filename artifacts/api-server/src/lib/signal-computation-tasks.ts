import { randomUUID, createHash } from 'node:crypto';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { db, signalCompaniesTable as companies, signalUsersTable as users, signalDependencyEpochTable as epochs, signalComputationTasksTable as tasks, type ComputationVersions } from '@workspace/db';
import { loadOwnedSelectionContext } from './signal-employer-context';
import type { SelectionContextRef } from './selection-context-contract';
import { MATCH_ALGORITHM_VERSION } from './signal-matching';
import { REQUIREMENTS_VERSION } from './recruiting-requirements';
import { canonicalJson } from './canonical-json';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, 'select'>;
export class ComputationLimitError extends Error { readonly code='preview_limit'; }
export class StaleComputationError extends Error { readonly code = 'discarded_stale'; }
export class ComputationAccessError extends Error { readonly code = 'computation_access_denied'; }
const sameVersions = (a: ComputationVersions, b: ComputationVersions) => canonicalJson(a) === canonicalJson(b);
export async function currentComputationVersions(actorId: number, companyId: number, ref: SelectionContextRef, reader: Reader = db): Promise<ComputationVersions> {
  const [owner] = await reader.select({ id: companies.id }).from(companies).innerJoin(users, eq(users.id, companies.ownerUserId))
    .where(and(eq(companies.id, companyId), eq(companies.ownerUserId, actorId), eq(users.role, 'employer'))).limit(1);
  const context = owner ? await loadOwnedSelectionContext(companyId, ref, reader) : null;
  if (!owner || !context?.active) throw new ComputationAccessError('Контекст недоступен.');
  const [epoch] = await reader.select().from(epochs).where(eq(epochs.key, 'professional-pool'));
  if (!epoch) throw new Error('Dependency epoch is not initialized');
  return { poolEpoch: String(epoch.revision), algorithm: MATCH_ALGORITHM_VERSION, contextType: ref.type, contextId: ref.id, contextRevision: context.context.version, requirementsPolicy: REQUIREMENTS_VERSION, actorId, companyId };
}
export async function enqueueComputation(input: { actorId: number; companyId: number; context: SelectionContextRef; kind: string; commandKey: string; input: Record<string, unknown> }) {
  if (!input.commandKey.trim() || input.commandKey.length > 180) throw new Error('A bounded idempotency key is required');
  return db.transaction(async tx => {
    await tx.select().from(epochs).where(eq(epochs.key, 'professional-pool')).for('share');
    if(input.kind==='requirements-preview')await tx.execute(sql`select pg_advisory_xact_lock(7496,hashtext(${input.companyId+':'+input.context.type+':'+input.context.id}))`);
    const versions = await currentComputationVersions(input.actorId, input.companyId, input.context, tx);
    const [prior] = await tx.select().from(tasks).where(and(eq(tasks.actorId, input.actorId), eq(tasks.companyId, input.companyId), eq(tasks.commandKey, input.commandKey)));
    if (prior) {
      if (prior.kind !== input.kind || prior.contextType !== input.context.type || prior.contextId !== input.context.id || canonicalJson(prior.input) !== canonicalJson(input.input)) throw new Error('Idempotency key was used for another command');
      return prior;
    }
    if(input.kind==='requirements-preview'){const [daily]=await tx.select({n:count()}).from(tasks).where(and(eq(tasks.companyId,input.companyId),eq(tasks.contextType,input.context.type),eq(tasks.contextId,input.context.id),eq(tasks.kind,input.kind),gte(tasks.createdAt,new Date(Date.now()-86400000))));if(daily.n>=20)throw new ComputationLimitError('Лимит расчётов для этого подбора на сегодня исчерпан.');}
    const [row] = await tx.insert(tasks).values({ id: randomUUID(), actorId: input.actorId, companyId: input.companyId, contextType: input.context.type, contextId: input.context.id, kind: input.kind, commandKey: input.commandKey, input: input.input, versions }).onConflictDoNothing().returning();
    if (row) return row;
    const [concurrent] = await tx.select().from(tasks).where(and(eq(tasks.actorId, input.actorId), eq(tasks.companyId, input.companyId), eq(tasks.commandKey, input.commandKey)));
    if (!concurrent || concurrent.kind !== input.kind || concurrent.contextType !== input.context.type || concurrent.contextId !== input.context.id || canonicalJson(concurrent.input) !== canonicalJson(input.input)) throw new Error('Concurrent idempotency conflict');
    return concurrent;
  });
}
export async function claimComputation(id: string, leaseMs = 30_000) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update');
    if (!row || !(row.state === 'queued' || row.state === 'running' && row.leaseUntil && +row.leaseUntil <= Date.now())) return null;
    const [leased] = await tx.update(tasks).set({ state: 'running', leaseFence: row.leaseFence + 1, leaseUntil: new Date(Date.now() + leaseMs), updatedAt: new Date() }).where(eq(tasks.id, id)).returning();
    return leased;
  });
}
async function discardAndQueueLatest(tx: Transaction, row: typeof tasks.$inferSelect, current: ComputationVersions | null) {
  await tx.update(tasks).set({ state: 'discarded_stale', result: null, leaseUntil: null, errorCode: current ? 'dependencies_changed' : 'access_revoked', updatedAt: new Date() }).where(eq(tasks.id, row.id));
  if (!current) return;
  const versionHash = createHash('sha256').update(canonicalJson(current)).digest('hex');
  await tx.insert(tasks).values({ id: randomUUID(), actorId: row.actorId, companyId: row.companyId, contextType: row.contextType, contextId: row.contextId, kind: row.kind, commandKey: `latest:${row.kind}:${row.contextType}:${row.contextId}:${versionHash}`, input: row.input, versions: current }).onConflictDoNothing();
}
/** The result is computed outside this short transaction. Only its current lease may publish. */
export async function publishComputation(id: string, fence: number, result: Record<string, unknown>) {
  return db.transaction(async tx => {
    await tx.select().from(epochs).where(eq(epochs.key, 'professional-pool')).for('update');
    const [row] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update');
    if (!row || row.state !== 'running' || row.leaseFence !== fence || !row.leaseUntil || +row.leaseUntil <= Date.now()) return { published: false, reason: 'lease_lost' };
    let current: ComputationVersions | null = null;
    try { current = await currentComputationVersions(row.actorId, row.companyId, { type: row.contextType, id: row.contextId }, tx); }
    catch (error) { if (!(error instanceof ComputationAccessError)) throw error; }
    if (!current || !sameVersions(row.versions, current)) { await discardAndQueueLatest(tx, row, current); return { published: false, reason: 'discarded_stale' }; }
    await tx.update(tasks).set({ state: 'ready', result, leaseUntil: null, errorCode: null, updatedAt: new Date() }).where(eq(tasks.id, id));
    return { published: true, reason: null };
  });
}
export async function readCurrentComputation(id: string, actorId: number, companyId: number) {
  const outcome = await db.transaction(async tx => {
    await tx.select().from(epochs).where(eq(epochs.key, 'professional-pool')).for('share');
    const [row] = await tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.actorId, actorId), eq(tasks.companyId, companyId)));
    if (!row) throw new ComputationAccessError('Результат недоступен.');
    let current:ComputationVersions;try{current=await currentComputationVersions(actorId,companyId,{type:row.contextType,id:row.contextId},tx);}catch(e){if(!(e instanceof ComputationAccessError))throw e;await discardAndQueueLatest(tx,row,null);return {denied:true as const,stale:false as const};}
    if (!sameVersions(row.versions, current)) {
      await discardAndQueueLatest(tx, row, current);
      return { stale: true as const };
    }
    return { stale: false as const, value: { id: row.id, state: row.state, result: row.state === 'ready' ? row.result : null } };
  });
  if ('denied' in outcome) throw new ComputationAccessError('Результат недоступен.');
  if (outcome.stale) throw new StaleComputationError('Данные изменились. Расчёт обновляется.');
  return outcome.value;
}
