/** Read-only commitments for the four privately owned UI actors; no values exported. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
const database = new URL(process.env.DATABASE_URL ?? '');
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55435'); assert.equal(database.pathname, '/signal_resume_v060_check');
assert.equal(process.env.API_ORIGIN, 'http://127.0.0.1:4363');
const mode = process.argv[2]; assert.ok(mode === 'before' || mode === 'after');
const manifest = JSON.parse(await readFile(join(homedir(), '.codex/private/signal-v060-ui-reviewers.json'), 'utf8'));
const ids = manifest.accounts.map((a: any) => a.id); assert.equal(ids.length, 4); assert.equal(new Set(ids).size, 4);
const { db, pool } = await import('../lib/db/src/index.ts');
const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const report: any = { schemaVersion: 1, applicationVersion: '0.6.0', generatedAt: new Date().toISOString(),
  passed: true, actorCount: 4, credentialsExported: false, tables: {},
  scope: 'Read-only exact-row commitments for four privately manifested UI actors and their company-owned data; no stage access, no database mutation.' };
try {
  const companies = (await db.execute(sql`SELECT id FROM signal_companies WHERE owner_user_id = ANY(${`{${ids.join(',')}}`}::int[])`)).rows.map((r: any) => Number(r.id));
  const tables = (await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map((r: any) => String(r.tablename));
  for (const table of tables) {
    assert.match(table, /^[a-z_][a-z0-9_]*$/);
    const rows = (await db.execute(sql.raw(`SELECT to_jsonb(t)::text AS value FROM public."${table}" t`))).rows;
    const owned = rows.filter((r: any) => {
      const data = JSON.parse(r.value);
      return table === 'signal_users' && ids.includes(data.id) ||
        ['user_id', 'candidate_user_id', 'owner_user_id', 'reporter_user_id', 'recipient_user_id'].some(key => ids.includes(data[key])) ||
        companies.includes(data.company_id);
    }).map((r: any) => sha(r.value)).sort();
    if (owned.length) report.tables[table] = { rows: owned.length, commitment: sha(owned.join('\n')) };
  }
  assert.equal(report.tables.signal_users?.rows, 4);
  const path = `outputs/verification/release-0.6.0/ui-owned-state-${mode}.json`;
  if (mode === 'after') {
    const before = JSON.parse(await readFile('outputs/verification/release-0.6.0/ui-owned-state-before.json', 'utf8'));
    assert.deepEqual(report.tables, before.tables);
    report.protectedUiRowsPreserved = true;
  }
  await mkdir('outputs/verification/release-0.6.0', { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, actorCount: 4, tables: Object.keys(report.tables).length, mode, proof: path }));
} finally { await pool.end(); }
