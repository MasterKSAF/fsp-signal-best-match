/** Read-only, manifest-scoped presence audit. Never regrades or changes an issued form. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, signalSkillAttemptsTable as attempts } from '../lib/db/src/index';
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55435'); assert.equal(database.pathname, '/signal_independent_fixes_20261007');
const manifest = JSON.parse(await readFile('C:/Users/Misha/.codex/private/skill-http-5d827227-00d6-4e16-9e93-3ad02ce0b280.json', 'utf8'));
const ownIds = manifest.accounts.filter((a: any) => a.role === 'candidate').map((a: any) => a.id) as number[];
assert.deepEqual(ownIds, [997, 998, 999]);
const read = () => db.select().from(attempts).where(and(inArray(attempts.userId, ownIds), eq(attempts.skillId, 'sql')));
try {
 const before = await read();
 const affected = before.flatMap(row => row.cases.filter(c => c.prompt.includes('Система имеет одного tenant; event_id глобален.')).map(c => ({
  attemptId: row.id, ownerId: row.userId, programVersion: row.programVersion, status: row.status, startedAt: row.startedAt,
  passed: row.decision?.passed ?? null, criticalPassed: row.decision?.competencies.find(x => x.id === c.competencyId)?.passed ?? null,
  alternativeCompositeSelected: !!c.options?.some(o => o.text.startsWith('UNIQUE(tenant_id,event_id)') && row.answers[c.id] === o.id),
  basis: 'Single-tenant v1 wording permits both composite and global UNIQUE; original oracle/decision retained. No automatic regrade.',
 })));
 const after = await read();
 const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
 assert.equal(hash(after), hash(before));
 const receipt = { passed: true, scope: 'Only candidate IDs from the private owned QA manifest', ownIds, inspectedSqlAttempts: before.length,
  affected, failedAlternativeOnly: affected.filter(x => x.passed === false && x.alternativeCompositeSelected), unchangedSnapshotHash: hash(before),
  mutations: 0, policy: 'Preserve all historical dates, keys, decisions and versions; no mass or automatic regrade.', measuredAt: new Date().toISOString() };
 await writeFile('outputs/verification/candidate-workspace-skill-matrix-20261008/owned-sql-v1-presence.json', JSON.stringify(receipt, null, 2));
 console.log(JSON.stringify({ passed: true, inspected: before.length, affected: affected.length, failedAlternativeOnly: receipt.failedAlternativeOnly.length, mutations: 0 }));
} finally { await pool.end(); }
