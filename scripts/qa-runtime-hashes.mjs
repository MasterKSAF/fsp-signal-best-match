/** Read-only attestation: explicit source whitelist, built bytes and container identity. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const sources = [
  'artifacts/api-server/src/lib/signal-matching.ts',
  'artifacts/api-server/src/lib/assessment-ranking-evidence.ts',
  'artifacts/api-server/src/lib/matching-pool-admission.ts',
  'artifacts/api-server/src/lib/postgres-id.ts',
  'artifacts/api-server/src/lib/opportunity-auth.ts',
  'artifacts/api-server/src/lib/skill-catalog.ts',
  'artifacts/api-server/src/lib/skill-catalog-sql.ts',
  'artifacts/api-server/src/lib/public-quality.ts',
  'artifacts/api-server/src/lib/quality-public-report.json',
  'artifacts/api-server/src/routes/signal-employer-matching.ts',
  'artifacts/api-server/src/routes/signal-candidate-bank.ts',
  'artifacts/api-server/src/routes/signal-quality.ts',
  'artifacts/api-server/src/routes/signal-jobs.ts',
  'artifacts/api-server/src/routes/signal-microtasks.ts',
  'artifacts/api-server/src/routes/signal-invitations.ts',
  'artifacts/api-server/src/routes/signal-profile-assessments.ts',
  'artifacts/api-server/src/routes/signal-assessment-context.ts',
  'artifacts/api-server/src/routes/signal-research.ts',
  'artifacts/fsp-signal/src/components/public-quality-page.tsx',
  'artifacts/fsp-signal/src/components/product-enhancements.tsx',
  'lib/api-spec/openapi.yaml',
  'scripts/lib/grade-transfer-model.ts',
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = () => Object.fromEntries(sources.map(path => [path,sha(readFileSync(path))]));
if (process.argv.includes('--inside')) {
  const walk = folder => readdirSync(folder,{withFileTypes:true}).flatMap(item => item.isDirectory() ? walk(join(folder,item.name)) : [join(folder,item.name)]);
  const frontendFiles = walk('artifacts/fsp-signal/dist').map(path => ({path:path.replaceAll('\\','/'),sha256:sha(readFileSync(path))})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
  console.log(JSON.stringify({sourceHashes:sourceHashes(),bundleSHA:sha(readFileSync('artifacts/api-server/dist/index.mjs')),
    deployedAggregateSHA:sha(readFileSync('artifacts/api-server/dist/quality-public-report.json')),
    frontendManifestSHA:sha(JSON.stringify(frontendFiles)),frontendFiles}));
} else {
  const argument = name => process.argv[process.argv.indexOf(name)+1];
  const container = argument('--container'), path = argument('--report');
  assert.ok(['signal-qa-cycle-01-app-1','fsp-signal-app-1'].includes(container),'Explicit local Signal container required');
  assert.ok(path?.startsWith('outputs/verification/'));
  const info = JSON.parse(execFileSync('docker',['inspect','--format','{{json .}}',container],{encoding:'utf8'}));
  const actual = JSON.parse(execFileSync('docker',['exec',container,'node','scripts/qa-runtime-hashes.mjs','--inside'],{encoding:'utf8'}));
  assert.deepEqual(actual.sourceHashes,sourceHashes(),'Runtime sources must match final working sources');
  assert.equal(actual.deployedAggregateSHA,actual.sourceHashes['artifacts/api-server/src/lib/quality-public-report.json']);
  const report = {checkedAt:new Date().toISOString(),container,containerId:info.Id,imageId:info.Image,startedAt:info.State.StartedAt,
    running:info.State.Running,command:info.Config.Cmd,...actual,sourceMatches:true};
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({container,imageId:report.imageId,bundleSHA:report.bundleSHA,sourceMatches:true}));
}
