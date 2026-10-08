import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const phase=process.argv[2];assert.ok(['before','after'].includes(phase));
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55435');assert.equal(url.pathname,'/signal_ui_refinement_20261008');
assert.equal(process.env.PORT,'4371');
const pool=new pg.Pool({connectionString:url.href});const client=await pool.connect();
try {
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const names=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'signal_%' ORDER BY tablename")).rows.map(r=>r.tablename);
 const tables=[];
 for(const table of names){assert.match(table,/^signal_[a-z0-9_]+$/);const result=await client.query(`SELECT count(*)::integer AS n, COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS data FROM public."${table}" t`);tables.push({table,count:result.rows[0].n,sha256:createHash('sha256').update(JSON.stringify(result.rows[0].data)).digest('hex')});}
 const migrations=(await client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
 const columns=(await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='signal_verification_tokens' ORDER BY ordinal_position")).rows;
 await client.query('COMMIT');
 const report={phase,at:new Date().toISOString(),database:url.pathname.slice(1),tables,migrations,columns,noRawRecords:true};
 const dir='outputs/verification/full-audit-a01-a11-20261008';
 if(phase==='after'){const before=JSON.parse(await readFile(`${dir}/ui-migration-before.json`,'utf8'));report.changedTables=tables.filter(t=>before.tables.find(b=>b.table===t.table)?.sha256!==t.sha256).map(t=>t.table);assert.ok(report.changedTables.every(t=>t==='signal_verification_tokens'),'Migration changed a protected business table');}
 await writeFile(`${dir}/ui-migration-${phase}.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({phase,tableCount:tables.length,migrations:migrations.length,changedTables:report.changedTables}));
}finally{client.release();await pool.end();}
