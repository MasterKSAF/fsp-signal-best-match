const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { Client } = createRequire(resolve('lib/db/package.json'))('pg');
const container = 'signal-qa-cycle-01-db-1', database = 'signal_resume_integration_check';
const out = 'outputs/verification/assessment-purpose';
const privateDir = 'outputs/verification/multi-resume-2026-10-06/private/fresh-full';
const manifestPath = privateDir + '/owner.json';
function connection(db) {
  const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
  if (info.Name !== '/' + container || !(info.NetworkSettings.Ports['5432/tcp'] ?? []).some(p => p.HostIp === '127.0.0.1' && p.HostPort === '55435')) throw new Error('Unexpected QA container');
  const env = new Map(info.Config.Env.map(x => { const i = x.indexOf('='); return [x.slice(0,i),x.slice(i+1)]; }));
  return {host:'127.0.0.1',port:55435,database:db,user:env.get('POSTGRES_USER'),password:env.get('POSTGRES_PASSWORD')};
}
function childEnv() {
  const c = connection(database);
  return {...process.env,DATABASE_URL:`postgresql://${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@127.0.0.1:55435/${database}`,NODE_ENV:'test',DEMO_MODE:'true',INTEGRATION_API_ORIGIN:'http://127.0.0.1:4353',INTEGRATION_APP_ORIGIN:'http://127.0.0.1:4354',INTEGRATION_MAILPIT_ORIGIN:'http://127.0.0.1:8030',SIGNAL_ISOLATED_FRESH_ACCEPTANCE:'1',SIGNAL_ISOLATED_STAGE_ACCEPTANCE:'0'};
}
function run(script,label,extra={}) {
  const result = spawnSync(process.execPath,['--import','tsx',script],{encoding:'utf8',stdio:'pipe',env:{...childEnv(),...extra}});
  writeFileSync(`${privateDir}/${label}.log`,`${result.stdout??''}\n${result.stderr??''}`);
  const checks=(result.stdout??'').split(/\r?\n/).filter(x=>x.startsWith('PASS ')||x.startsWith('Cleaned '));
  checks.forEach(x=>console.log(x));
  return {exitCode:result.status,checks};
}
(async()=>{
  mkdirSync(out,{recursive:true});mkdirSync(privateDir,{recursive:true});
  const mode=process.argv[2]; if(!['setup','migrate','full','seed-rerun'].includes(mode))throw new Error('Explicit fresh acceptance mode required');
  const admin=new Client(connection('postgres'));await admin.connect();
  let manifest;
  try {
    const found=(await admin.query('select oid from pg_database where datname=$1',[database])).rows;
    if(mode==='setup') {
      if(found.length)throw new Error('Fresh DB already exists; refusing reset/reuse');
      await admin.query('CREATE DATABASE signal_resume_integration_check');
      const [{oid}]=(await admin.query('select oid from pg_database where datname=$1',[database])).rows;
      manifest={owner:'resume_core/fresh-full-acceptance',runId:randomUUID(),database,container,databaseOid:oid,createdAt:new Date().toISOString()};
      writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    } else {
      manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
      if(manifest.owner!=='resume_core/fresh-full-acceptance'||manifest.database!==database||manifest.container!==container||found.length!==1||found[0].oid!==manifest.databaseOid)throw new Error('Owned fresh DB identity differs');
    }
  } finally {await admin.end();}
  const client=new Client(connection(database));await client.connect();
  try {
    if((await client.query('select current_database() as name')).rows[0].name!==database)throw new Error('Wrong DB');
    if(mode==='setup') {
      const tables=(await client.query("select count(*)::int as count from pg_tables where schemaname in ('public','drizzle')")).rows[0].count;
      if(tables!==0)throw new Error('New DB is not empty');
      const migrations=run('scripts/migrate.ts','migrate');if(migrations.exitCode!==0)throw new Error('Migration failed; private diagnostic retained');
      const seed=run('scripts/src/seed-fsp-signal.ts','initial-seed');if(seed.exitCode!==0)throw new Error('Initial seed failed; private diagnostic retained');
      const stats=(await client.query("select count(*)::int as owners,count(*) filter(where u.demo_mode and u.review_scope_id is null)::int as overview_owners,count(*) filter(where not u.demo_mode or u.review_scope_id is not null)::int as non_overview_owners,count(*) filter(where r.consent_catalog)::int as catalog,count(*) filter(where r.ready_for_offers)::int as offers,count(*) filter(where r.visibility='private' and (r.consent_catalog or r.ready_for_offers))::int as private_optin from signal_candidate_resumes r join signal_users u on u.id=r.user_id")).rows[0];
      if(stats.owners!==220||stats.overview_owners!==220||stats.non_overview_owners!==0||stats.catalog<=24||stats.private_optin!==0)throw new Error('Fresh synthetic publication counts differ');
      const markers=(await client.query('select key,version from signal_demo_seed order by key')).rows;
      writeFileSync(`${out}/fresh-full-setup.json`,JSON.stringify({passed:true,database,emptyBeforeMigrations:true,migrations,seed,stats,markers,measuredAt:new Date().toISOString()},null,2));
      console.log(JSON.stringify({mode,passed:true,database,stats}));
    } else if(mode==='migrate') {
      const before=(await client.query("select count(*)::int as rows,md5(coalesce(string_agg((to_jsonb(r)-'pool_content_digest')::text,'|' order by id),'')) as hash from signal_candidate_resumes r")).rows[0];
      const result=run('scripts/migrate.ts','upgrade-'+randomUUID().slice(0,8));if(result.exitCode!==0)throw new Error('Owned fresh upgrade failed; private diagnostics retained');
      const after=(await client.query("select count(*)::int as rows,md5(coalesce(string_agg((to_jsonb(r)-'pool_content_digest')::text,'|' order by id),'')) as hash from signal_candidate_resumes r")).rows[0];
      if(before.rows!==after.rows||before.hash!==after.hash)throw new Error('Owned fresh upgrade changed résumé business data');
      const signed=(await client.query('select count(*)::int as rows,count(*) filter(where octet_length(pool_content_digest)=32 and pool_content_digest=signal_resume_pool_content_digest(r))::int as signed from signal_candidate_resumes r')).rows[0];
      if(signed.rows!==signed.signed)throw new Error('Owned fresh backfill signature incomplete');
      const report=`${out}/fresh-full-upgrade-${randomUUID().slice(0,8)}.json`;
      writeFileSync(report,JSON.stringify({passed:true,database,before,after,signed,withoutSeedOrReset:true,migrationSourceSha256:createHash('sha256').update(readFileSync('lib/db/migrations/0008_resume_pool_digest.sql')).digest('hex'),measuredAt:new Date().toISOString()},null,2));
      console.log(JSON.stringify({mode,passed:true,database,rows:signed.rows,report}));
    } else if(mode==='full') {
      const health=await fetch('http://127.0.0.1:4353/api/healthz',{signal:AbortSignal.timeout(3000)});if(!health.ok)throw new Error('Owned fresh API health failed');
      const id=randomUUID().slice(0,8),report=`${out}/full-fresh-${id}.json`;
      const result=run('scripts/integration-test.ts',`full-${id}`,{INTEGRATION_REPORT_PATH:report});
      writeFileSync(report+'.runner.json',JSON.stringify({suite:'full-fresh',passed:result.exitCode===0,...result,database,apiOrigin:'http://127.0.0.1:4353',appOrigin:'http://127.0.0.1:4354',mailOrigin:'http://127.0.0.1:8030',measuredAt:new Date().toISOString(),sourceHashes:Object.fromEntries(['scripts/integration-test.ts','scripts/src/seed-fsp-signal.ts','artifacts/api-server/src/lib/assessment-ranking-evidence.ts'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))},null,2));
      console.log(JSON.stringify({mode,...result,report}));process.exitCode=result.exitCode??1;
    } else {
      // A seed retry must preserve deliberate experiments, not republish them.
      const newOwners=[];
      for(const [role,demoMode,reviewScopeId] of [['ordinary',false,null],['reviewer',true,randomUUID()]]) {
        const user=(await client.query("insert into signal_users(email,password_hash,role,display_name,email_verified,demo_mode,review_scope_id) values($1,'unusable-local-fixture','candidate','Owned seed retry fixture',true,$2,$3) returning id",[`fresh-retry-${manifest.runId}-${role}@example.test`,demoMode,reviewScopeId])).rows[0];
        await client.query("insert into signal_candidate_profiles(user_id,professional_alias,visibility,consent_matching) values($1,'Owned seed retry fixture','private',false)",[user.id]);
        const resume=(await client.query("insert into signal_candidate_resumes(user_id,is_primary,title,visibility,consent_matching,consent_catalog,ready_for_offers) values($1,true,'Owned private seed retry fixture','private',false,false,false) returning id",[user.id])).rows[0];
        newOwners.push({userId:user.id,resumeId:resume.id,fixtureType:role});
      }
      const target=(await client.query('select id from signal_candidate_resumes order by id limit 1')).rows[0].id;
      await client.query("update signal_candidate_resumes set consent_catalog=false,ready_for_offers=false,visibility='private',title='Owned seed retry opt-out',revision=revision+1 where id=$1",[target]);
      const before=(await client.query("select md5(coalesce(string_agg(row_to_json(r)::text,'|' order by r.id),'')) as hash,count(*)::int as rows from signal_candidate_resumes r")).rows[0];
      const seed=run('scripts/src/seed-fsp-signal.ts','retry-seed');if(seed.exitCode!==0)throw new Error('Seed retry failed');
      const after=(await client.query("select md5(coalesce(string_agg(row_to_json(r)::text,'|' order by r.id),'')) as hash,count(*)::int as rows from signal_candidate_resumes r")).rows[0];
      if(before.hash!==after.hash||before.rows!==after.rows)throw new Error('Seed retry changed existing CV state');
      const privateOthers=(await client.query('select count(*)::int as count from signal_candidate_resumes r join signal_users u on u.id=r.user_id where (not u.demo_mode or u.review_scope_id is not null) and (r.consent_catalog or r.ready_for_offers or r.consent_matching or r.visibility<>\'private\')')).rows[0].count;
      if(privateOthers!==0)throw new Error('Seed retry published a non-overview fixture');
      writeFileSync(`${out}/fresh-seed-rerun.json`,JSON.stringify({passed:true,database,markerProtected:true,ownedOptOutResumeId:target,newOwners,before,after,seed,nonOverviewOptIn:privateOthers,seedSourceSha256:createHash('sha256').update(readFileSync('scripts/src/seed-fsp-signal.ts')).digest('hex'),measuredAt:new Date().toISOString(),scope:'Exact entire CV row digests including deliberate overview opt-out, ordinary private CV and reviewer private CV; no contact data exported; only this new owned database was changed.'},null,2));
      console.log(JSON.stringify({mode,passed:true,rows:after.rows,unchanged:true}));
    }
  } finally {await client.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
