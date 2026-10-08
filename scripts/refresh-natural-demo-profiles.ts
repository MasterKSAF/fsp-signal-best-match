import { pool } from '@workspace/db';
import { refreshNaturalDemoProfiles } from './src/demo-natural-profiles';
try {
  const target = new URL(process.env.DATABASE_URL || '').pathname.slice(1);
  if (target !== 'signal_independent_fixes_20261007') throw new Error('This fixture refresh script is restricted to the verified isolated workspace database.');
  console.info(JSON.stringify(await refreshNaturalDemoProfiles()));
} finally { await pool.end(); }
