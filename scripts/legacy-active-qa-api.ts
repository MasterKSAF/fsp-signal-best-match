/** QA-only thin entry: production app and routes, deliberately no background schedulers. */
import assert from 'node:assert/strict';
import app from '../artifacts/api-server/src/app';
import { pool } from '../lib/db/src/index';

const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55435');
assert.equal(database.pathname, '/signal_independent_fixes_20261007');
assert.equal(process.env.PORT, '4389'); assert.equal(process.env.HOST, '127.0.0.1');
assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED, 'true');
assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED, 'false');
const server = app.listen(4389, '127.0.0.1', () => console.log('Owned legacy QA API ready on 4389; no schedulers.'));
const stop = () => server.close(() => { void pool.end().then(() => process.exit(0)); });
process.once('SIGTERM', stop); process.once('SIGINT', stop);
