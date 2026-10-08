import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const name='signal_full_audit_a10_20261008';
const source='C:/Users/Misha/.codex/private/signal-ui-refinement-20261008.env';
const target='C:/Users/Misha/.codex/private/signal-full-audit-a10-20261008.env';
process.loadEnvFile(source);const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55435');
assert.equal(url.pathname,'/signal_ui_refinement_20261008');
const pool=new pg.Pool({connectionString:url.href});
try{
  assert.equal((await pool.query('select 1 from pg_database where datname=$1',[name])).rowCount,0,'Owned new DB already exists');
  await pool.query(`CREATE DATABASE ${name}`);
}finally{await pool.end();}
url.pathname='/'+name;
let text=await readFile(source,'utf8');
text=text.replace(/^DATABASE_URL=.*$/m,`DATABASE_URL=${url.href}`).replace(/^PORT=.*$/m,'PORT=4383');
text=text.replace(/^CORS_ORIGIN=.*$/m,'CORS_ORIGIN=http://localhost:4384,http://127.0.0.1:4384,http://signal-full-audit.localhost:4384');
text=text.replace(/^PUBLIC_URL=.*$/m,'PUBLIC_URL=http://signal-full-audit.localhost:4384');
text+='\nAPI_PORT=4383\n';
await writeFile(target,text,{flag:'wx'});
const output='outputs/verification/full-audit-a01-a11-20261008/resources';await mkdir(output,{recursive:true});
const plan={preregisteredAt:new Date().toISOString(),newDatabase:name,privateEnvironmentFile:target,
  ports:{api:4383,ui:4384,postgres:55435},ownSlaNotOrganizerRequirement:true,
  workload:{syntheticCandidates:500,resumesPerPerson:3,totalSyntheticResumes:1500,legacyPeople:250,modularPeople:250,independentEmployerSessions:32,warmupSeconds:10,measurementSeconds:30,thinkTimeMs:250,
    mix:['matches','matches','explanation','catalog-search'],conditions:'Exact same immutable current API bundle built from a fresh dependency installation and fully migrated new DB; fixed read-only load, no protected-stand requests'},
  ownThresholds:{errorCount:0,listP95Ms:1500,explanationP95Ms:2000,apiPeakWorkingSetBytes:1610612736},
  limits:['Local host measurement, no cloud spend or production claim.','Native PostgreSQL shared owned QA cluster, separate new DB.','500 synthetic people; historical 5000-person measurements are preserved separately.','Modular volume fixtures are explicit SQL clones of three owned completed v6 HTTP proofs; not 250 human exam measurements.'],
  node:process.version};
await writeFile(`${output}/plan.json`,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({newDatabase:name,privateEnvironmentFile:target,plan:`${output}/plan.json`}));
