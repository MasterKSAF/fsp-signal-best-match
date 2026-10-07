import { and, eq, isNull } from './node_modules/drizzle-orm/index.js';
import { spawnSync } from 'node:child_process';
import { db, pool, signalUsersTable, signalDemoSeedTable } from '../lib/db/src/index.ts';

if (process.env.DEMO_MODE !== 'true') throw new Error('Demo reset requires DEMO_MODE=true.');
const host = new URL(process.env.DATABASE_URL || '').hostname;
if (!['127.0.0.1', 'localhost', '[::1]', 'db'].includes(host)) throw new Error('Demo reset is restricted to a local development database.');
try {
  const removed = await db.transaction(async tx => {
    const users = await tx.delete(signalUsersTable).where(and(eq(signalUsersTable.demoMode, true), isNull(signalUsersTable.reviewScopeId))).returning({id:signalUsersTable.id});
    await tx.delete(signalDemoSeedTable).where(eq(signalDemoSeedTable.key, 'default'));
    return users.length;
  });
  console.log(`Reset ${removed} synthetic identities. Ordinary accounts were preserved.`);
} finally { await pool.end(); }
const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/src/seed-fsp-signal.ts'], {stdio:'inherit'});
if (result.status !== 0) process.exit(result.status || 1);
