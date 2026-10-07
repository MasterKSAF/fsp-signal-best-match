import { spawnSync } from 'node:child_process';
for (const file of ['scripts/migrate.ts', ...(process.env.DEMO_MODE === 'true' ? ['scripts/src/seed-fsp-signal.ts'] : [])]) {
  const result = spawnSync(process.execPath, ['--import','tsx',file], {stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
await import('../artifacts/api-server/dist/index.mjs');
