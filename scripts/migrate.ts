import { db, pool } from '../lib/db/src/index.ts';
import { migrate } from '../lib/db/node_modules/drizzle-orm/node-postgres/migrator.js';
try {
  await migrate(db, { migrationsFolder: 'lib/db/migrations' });
  console.info('Database migrations applied.');
} finally { await pool.end(); }
