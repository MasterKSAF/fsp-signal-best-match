import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { jobSearchInput } from '../artifacts/api-server/src/lib/job-discovery';
import { personalJobFilterConditions } from '../artifacts/api-server/src/lib/job-personal-filters';

const requireApi = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { and } = requireApi('drizzle-orm');
const { PgDialect } = requireApi('drizzle-orm/pg-core');
const dialect = new PgDialect();

test('personal job query flags are explicit booleans and apply only to a candidate session', () => {
  const defaults = jobSearchInput.parse({});
  assert.equal(defaults.hideApplied, false);
  assert.equal(defaults.hideBlocked, false);
  const filters = jobSearchInput.parse({ hideApplied: 'true', hideBlocked: 'false' });
  assert.equal(filters.hideApplied, true);
  assert.equal(filters.hideBlocked, false);
  for (const value of ['1', 'yes', '', ['true', 'false']]) assert.equal(jobSearchInput.safeParse({ hideApplied: value }).success, false);
  const both = { hideApplied: true, hideBlocked: true };
  assert.deepEqual(personalJobFilterConditions(both), []);
  assert.deepEqual(personalJobFilterConditions(both, { id: 101, role: 'employer' }), []);
  assert.equal(personalJobFilterConditions(both, { id: 101, role: 'candidate' }).length, 2);
  assert.deepEqual(personalJobFilterConditions(defaults, { id: 101, role: 'candidate' }), []);
});

test('actual correlated SQL scopes application and active block filters by account before count, pagination and export', () => {
  // Execute the generated predicate in isolated SQLite. This does not connect to
  // application storage or claim PostgreSQL deployment validation.
  const storage = new DatabaseSync(':memory:');
  try {
    storage.exec(`
      create table signal_jobs (id integer primary key, company_id integer);
      create table signal_applications (job_id integer, candidate_user_id integer, resume_id integer, status text);
      create table signal_company_blocks (company_id integer, candidate_user_id integer, active integer);
      insert into signal_jobs values (1,11),(2,22),(3,33),(4,33);
      insert into signal_applications values (1,101,900,'withdrawn'),(2,101,901,'sent'),(3,202,902,'declined');
      insert into signal_company_blocks values (33,101,1),(22,101,0),(22,202,1);
    `);
    const where = (id: number, hideApplied: boolean, hideBlocked: boolean) => {
      const conditions = personalJobFilterConditions({ hideApplied, hideBlocked }, { id, role: 'candidate' });
      if (!conditions.length) return { sql: '1=1', params: [] };
      const compiled = dialect.sqlToQuery(and(...conditions));
      return { sql: compiled.sql.replace(/\$\d+/g, '?'), params: compiled.params as number[] };
    };
    const ids = (id: number, hideApplied: boolean, hideBlocked: boolean) => {
      const condition = where(id, hideApplied, hideBlocked);
      return storage.prepare(`select id from signal_jobs where ${condition.sql} order by id`).all(...condition.params).map(row => row.id);
    };
    assert.deepEqual(ids(101, true, false), [3,4]); // Both resumes and withdrawn applications count.
    assert.deepEqual(ids(101, false, true), [1,2]); // The inactive block does not hide company 22.
    assert.deepEqual(ids(101, true, true), []);
    assert.deepEqual(ids(202, true, true), [1,4]); // No cross-account application or block leakage.
    assert.deepEqual(ids(303, true, true), [1,2,3,4]);
    const condition = where(101, true, false);
    const total = storage.prepare(`select count(*) as total from signal_jobs where ${condition.sql}`).get(...condition.params)!.total;
    const pages = [0,1].flatMap(offset => storage.prepare(`select id from signal_jobs where ${condition.sql} order by id limit 1 offset ?`).all(...condition.params, offset).map(row => row.id));
    const exported = ids(101, true, false);
    assert.equal(total, 2);
    assert.deepEqual(pages, exported);
    assert.deepEqual(exported, [3,4]);
  } finally {
    storage.close();
  }
});
