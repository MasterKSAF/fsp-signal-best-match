import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const helper = createRequire(import.meta.url)('../scripts/upgrade-owned-stage-v050.cjs');
const info = () => ({ Name: '/signal-qa-cycle-01-db-1', Id: 'a'.repeat(64), Image: 'sha256:' + 'b'.repeat(64), State: { Running: true, StartedAt: '2026-10-06T12:00:00Z' }, Config: { Env: ['POSTGRES_USER=signal', 'POSTGRES_PASSWORD=synthetic-secret-never-exported'], Labels: { 'com.docker.compose.project': 'signal-qa-cycle-01', 'com.docker.compose.service': 'db' } }, NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55435' }] } } });
const manifest = () => ({ schemaVersion: 1, owner: 'root/owned-stage-v050-upgrade', host: '127.0.0.1', port: 55435, database: 'signal_resume_stage', databaseOid: 12345, containerName: 'signal-qa-cycle-01-db-1', containerId: 'a'.repeat(64), image: 'sha256:' + 'b'.repeat(64), containerStartedAt: '2026-10-06T12:00:00Z', capturedAt: '2026-10-07T00:00:00Z' });

test('owned-stage helper accepts only its exact live loopback container and role', () => {
  assert.equal(helper.assertContainer(info()).user, 'signal');
  for (const change of [(v:any)=>v.Name='/fsp-signal-db-1',(v:any)=>v.State.Running=false,(v:any)=>v.Config.Labels['com.docker.compose.project']='foreign',(v:any)=>v.Config.Labels['com.docker.compose.service']='app',(v:any)=>v.NetworkSettings.Ports['5432/tcp'][0].HostIp='0.0.0.0',(v:any)=>v.NetworkSettings.Ports['5432/tcp'][0].HostPort='55433',(v:any)=>v.NetworkSettings.Ports['5432/tcp'].push({HostIp:'::1',HostPort:'55435'}),(v:any)=>v.Config.Env=['POSTGRES_USER=foreign','POSTGRES_PASSWORD=x']]) { const v=info(); change(v); assert.throws(()=>helper.assertContainer(v)); }
});
test('stage manifest cannot identify the ordinary DB, another isolated DB or a missing OID', () => {
  helper.validateManifest(manifest());
  for (const change of [(v:any)=>v.database='signal',(v:any)=>v.database='signal_resume_load_check',(v:any)=>v.databaseOid=0,(v:any)=>delete v.databaseOid,(v:any)=>v.owner='foreign',(v:any)=>v.port=55433,(v:any)=>v.containerStartedAt='invalid']) { const v=manifest(); change(v); assert.throws(()=>helper.validateManifest(v)); }
});
test('registered stage rejects recreated DB OID, replacement container and restart', () => {
  helper.assertIdentity(manifest(),info(),{name:'signal_resume_stage',oid:'12345'});
  for (const change of [(v:any)=>v.Id='c'.repeat(64),(v:any)=>v.Image='sha256:'+'c'.repeat(64),(v:any)=>v.State.StartedAt='2026-10-07T00:00:00Z']) { const v=info(); change(v); assert.throws(()=>helper.assertIdentity(manifest(),v,{name:'signal_resume_stage',oid:'12345'})); }
  assert.throws(()=>helper.assertIdentity(manifest(),info(),{name:'signal_resume_stage',oid:'12346'}));
  assert.throws(()=>helper.assertIdentity(manifest(),info(),{name:'signal',oid:'12345'}));
});
test('business projection excludes only the resume digest and retains deleted rows and every other table', () => {
  assert.match(helper.publicTableHashSql('signal_candidate_resumes'),/to_jsonb\(t\) - 'pool_content_digest'/);
  assert.doesNotMatch(helper.publicTableHashSql('signal_candidate_resumes'),/WHERE|deleted_at|consent_/i);
  assert.doesNotMatch(helper.publicTableHashSql('signal_users'),/pool_content_digest/);
  assert.match(helper.publicTableHashSql('signal_users'),/to_jsonb\(t\)/);
  assert.equal(helper.quoteIdentifier('odd"table'),'"odd""table"');
  assert.throws(()=>helper.quoteIdentifier('bad\0table'));
});
test('public-table commitment includes duplicate multiplicity and handles empty tables without raw rows', () => {
  const single=helper.commitTable('table',[{row_digest:'a'.repeat(64),copies:'1'}]),double=helper.commitTable('table',[{row_digest:'a'.repeat(64),copies:'2'}]);
  assert.equal(single.rows,1);assert.equal(double.rows,2);assert.notEqual(single.sha256,double.sha256);
  assert.equal(helper.commitTable('empty',[]).rows,0);
  for(const row of [{row_digest:'bad',copies:'1'},{row_digest:'a'.repeat(64),copies:'0'},{row_digest:'a'.repeat(64),copies:'9007199254740992'}]) assert.throws(()=>helper.commitTable('table',[row]));
});
test('full business proof rejects changed row hashes, counts and added or missing public tables', () => {
  const tables=[{table:'b',rows:2,sha256:'b'.repeat(64)},{table:'a',rows:1,sha256:'a'.repeat(64)}],before=helper.businessState(tables);
  helper.assertBusinessUnchanged(before,helper.businessState([...tables].reverse()));
  for(const changed of [[{...tables[0],rows:3},tables[1]],[{...tables[0],sha256:'c'.repeat(64)},tables[1]],[tables[0]],[...tables,{table:'c',rows:0,sha256:'d'.repeat(64)}]])assert.throws(()=>helper.assertBusinessUnchanged(before,helper.businessState(changed)));
  assert.throws(()=>helper.businessState([tables[0],tables[0]]));
});
test('historical0008 stage helper fails closed against a newer migration set without external operations', async () => {
  const original=console.log,records:any[]=[];console.log=(value:any)=>records.push(JSON.parse(value));
  const journal=JSON.parse(readFileSync(new URL('../lib/db/migrations/meta/_journal.json',import.meta.url),'utf8'));
  assert.ok(journal.entries.at(-1).idx>8,'This regression targets a newer source migration set; historical0008 helper remains unchanged');
  try{await assert.rejects(helper.main([]));await assert.rejects(helper.main(['--reset']));await assert.rejects(helper.main(['--upgrade-owned-stage','extra']));}finally{console.log=original;}
  assert.equal(records.length,0,'Outdated preparation fails before external operations or a positive receipt');
});
