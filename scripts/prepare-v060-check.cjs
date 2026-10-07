// Exact owned database only; no seed/reset/drop of an existing stand.
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { homedir } = require('node:os');
const { createHash } = require('node:crypto');
const database = 'signal_resume_v060_check', container = 'signal-qa-cycle-01-db-1';
const privateDir = join(homedir(), '.codex', 'private');
const privateManifest = join(privateDir, 'signal-v060-check-database.json');
const envPath = join(privateDir, 'signal-v060-check.env');
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
const bindings = info?.NetworkSettings?.Ports?.['5432/tcp'] ?? [];
if (info?.Name !== '/' + container || !info.State?.Running || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || bindings[0].HostPort !== '55435') throw new Error('Exact isolated QA PostgreSQL binding required');
const vars = new Map(info.Config.Env.map(v => { const i = v.indexOf('='); return [v.slice(0, i), v.slice(i + 1)]; }));
const user = vars.get('POSTGRES_USER'), password = vars.get('POSTGRES_PASSWORD');
if (!user || !password) throw new Error('Private PostgreSQL credentials unavailable');
function sql(statement, target = 'postgres') { return execFileSync('docker', ['exec', container, 'psql', '-U', user, '-d', target, '-v', 'ON_ERROR_STOP=1', '-tAc', statement], { encoding: 'utf8' }).trim(); }
mkdirSync(privateDir, { recursive: true });
let oid = sql(`SELECT oid FROM pg_database WHERE datname='${database}'`);
let created = false;
if (oid) {
  if (!existsSync(privateManifest)) throw new Error('Existing database is not owned by this helper');
  const old = JSON.parse(readFileSync(privateManifest, 'utf8'));
  if (old.database !== database || old.databaseOid !== Number(oid) || old.containerId !== info.Id) throw new Error('Existing database ownership differs');
} else {
  sql(`CREATE DATABASE ${database}`); created = true;
  oid = sql(`SELECT oid FROM pg_database WHERE datname='${database}'`);
}
const databaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:55435/${database}`;
writeFileSync(privateManifest, JSON.stringify({ schemaVersion: 1, database, databaseOid: Number(oid), containerId: info.Id,
  containerStartedAt: info.State.StartedAt, apiOrigin: 'http://127.0.0.1:4363', createdByHelper: true }, null, 2));
const environment = { DATABASE_URL: databaseUrl, PORT: '4363', HOST: '127.0.0.1', PUBLIC_URL: 'http://127.0.0.1:4363',
  API_ORIGIN: 'http://127.0.0.1:4363', INTEGRATION_API_ORIGIN: 'http://127.0.0.1:4363', INTEGRATION_APP_ORIGIN: 'http://127.0.0.1:4363',
  NODE_ENV: 'test', DEMO_MODE: 'true', MAILPIT_URL: 'http://127.0.0.1:8030', INTEGRATION_MAILPIT_ORIGIN: 'http://127.0.0.1:8030',
  REVIEWER_DATABASE_NAME: database, SIGNAL_REVIEWER_PROFILE: 'isolated-local-review', SIGNAL_ISOLATED_STAGE_ACCEPTANCE: '1', SIGNAL_MICROTASK_RESUME_HTTP_PROBE: 'true' };
// JSON strings are valid dotenv quoted values; URL secrets never enter public files/logs.
writeFileSync(envPath, Object.entries(environment).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n');
const migration = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { cwd: resolve('.'), env: { ...process.env, ...environment }, encoding: 'utf8' });
writeFileSync(join(privateDir, 'signal-v060-check-migration.log'), `${migration.stdout ?? ''}\n${migration.stderr ?? ''}`);
if (migration.status !== 0) throw new Error('Owned migration failed; private diagnostic retained, no reset performed');
const tableCount = Number(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'", database));
const path = 'outputs/verification/release-0.6.0/stand-preparation.json';
mkdirSync('outputs/verification/release-0.6.0', { recursive: true });
writeFileSync(path, JSON.stringify({ schemaVersion: 1, passed: true, preparedAt: new Date().toISOString(), database, databaseOid: Number(oid),
  containerId: info.Id, containerStartedAt: info.State.StartedAt, postgresPort: 55435, apiOrigin: environment.API_ORIGIN,
  created, migrated: true, tableCount, seeded: false, existingStageTouched: false, credentialsExported: false,
  migrationSha256: createHash('sha256').update(readFileSync('lib/db/migrations/0009_microtask_resume.sql')).digest('hex') }, null, 2));
console.log(JSON.stringify({ passed: true, report: path, privateEnvironmentFile: envPath, database, migrated: true, seeded: false }));
