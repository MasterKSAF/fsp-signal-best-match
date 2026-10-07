import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const helper = createRequire(import.meta.url)("../scripts/upgrade-owned-stage-v060.cjs");
const info = () => ({ Name: "/signal-qa-cycle-01-db-1", Id: "a".repeat(64), Image: "sha256:" + "b".repeat(64), State: { Running: true, StartedAt: "2026-10-06T12:00:00Z" }, Config: { Env: ["POSTGRES_USER=signal", "POSTGRES_PASSWORD=synthetic-test-value"], Labels: { "com.docker.compose.project": "signal-qa-cycle-01", "com.docker.compose.service": "db" } }, NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55435" }] } } });
const manifest = () => ({ schemaVersion: 1, owner: "root/owned-stage-v060-upgrade", host: "127.0.0.1", port: 55435, database: "signal_resume_stage", databaseOid: 12345, containerName: "signal-qa-cycle-01-db-1", containerId: "a".repeat(64), image: "sha256:" + "b".repeat(64), containerStartedAt: "2026-10-06T12:00:00Z", capturedAt: "2026-10-07T00:00:00Z" });

test("0009 stage guard rejects working/external bindings and replaced stage identity", () => {
  helper.assertIdentity(manifest(), info(), { name: "signal_resume_stage", oid: "12345" });
  for (const change of [(v:any) => v.NetworkSettings.Ports["5432/tcp"][0].HostPort = "55433", (v:any) => v.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0", (v:any) => v.State.StartedAt = "2026-10-07T01:00:00Z", (v:any) => v.Id = "c".repeat(64), (v:any) => v.Config.Labels["com.docker.compose.project"] = "foreign"]) { const v = info(); change(v); assert.throws(() => helper.assertIdentity(manifest(), v, { name: "signal_resume_stage", oid: "12345" })); }
  assert.throws(() => helper.assertIdentity(manifest(), info(), { name: "signal_resume_stage", oid: "12346" }));
  assert.throws(() => helper.assertIdentity(manifest(), info(), { name: "signal_resume_v060_check", oid: "12345" }));
  assert.throws(() => helper.validateManifest({ ...manifest(), owner: "root/owned-stage-v050-upgrade" }));
});

test("0009 commitments exclude exactly added columns and preserve all old digests, answers and deleted rows", () => {
  assert.equal(Object.values(helper.EXCLUDED_COLUMNS).flat().length, 9);
  for (const table of ["signal_users", "signal_candidate_resumes", "signal_assessment_attempts", "signal_micro_offers"]) {
    const sql = helper.publicTableHashSql(table);
    assert.doesNotMatch(sql, /WHERE| - 'pool_content_digest'| - 'answer'| - 'result'| - 'deleted_at'/i);
  }
  assert.match(helper.publicTableHashSql("signal_micro_offers"), / - 'resume_id' - 'resume_revision' - 'resume_context' - 'resume_provenance'/);
  assert.match(helper.publicTableHashSql("signal_micro_offers"), /convert_to\(\(to_jsonb\(t\).*\)::text, 'UTF8'\)/);
  assert.match(helper.publicTableHashSql("signal_micro_templates"), / - 'specialization'/);
  assert.equal(helper.quoteIdentifier('odd"table'), '"odd""table"');
  assert.throws(() => helper.quoteIdentifier("bad\0table"));
});

test("business proof fails on deleted history, answer changes or added table and counts duplicate rows", () => {
  const tables = [{ table: "signal_micro_offers", rows: 3, sha256: "a".repeat(64) }];
  const before = helper.businessState(tables);
  for (const altered of [[{ ...tables[0], rows: 2 }], [{ ...tables[0], sha256: "b".repeat(64) }], [...tables, { table: "unexpected", rows: 0, sha256: "c".repeat(64) }]]) assert.throws(() => helper.assertBusinessUnchanged(before, helper.businessState(altered)));
  assert.notEqual(helper.commitTable("offers", [{ row_digest: "a".repeat(64), copies: "1" }]).sha256, helper.commitTable("offers", [{ row_digest: "a".repeat(64), copies: "2" }]).sha256);
});

const oldColumns = ["signal_micro_templates", "signal_micro_subscriptions", "signal_micro_offers"].map(table_name => ({ table_name, column_name: "id" }));
const oldHash = createHash("sha256").update(readFileSync(new URL("../lib/db/migrations/0008_resume_pool_digest.sql", import.meta.url))).digest("hex");
test("pre-upgrade accepts only exact applied0008 and rejects partial/already-applied0009", async () => {
  const client = (columns:any[], hash = oldHash) => ({ query: async (sql:string) => ({ rows: sql.includes("information_schema.columns") ? columns : [{ hash }] }) });
  await helper.assertPre0009(client(oldColumns));
  await assert.rejects(helper.assertPre0009(client([...oldColumns, { table_name: "signal_micro_offers", column_name: "resume_context" }])));
  await assert.rejects(helper.assertPre0009(client(oldColumns, "f".repeat(64))));
  await assert.rejects(helper.assertPre0009(client(oldColumns.filter(row => row.table_name !== "signal_micro_templates"))));
});

test("post-upgrade requires all historical rows honestly unbound and immutable offer trigger", async () => {
  const client = (bad:string|null = null) => ({ query: async (sql:string) => ({ rows: [sql.includes("pg_trigger") ? { total: bad === "trigger" ? 0 : 1 } : sql.includes("signal_micro_templates") ? { total: 4, unclassified: bad === "template" ? 3 : 4 } : { total: 7, legacy: bad === "binding" ? 6 : 7 }] }) });
  const valid = await helper.assertLegacy0009(client());
  assert.equal(valid.noInventedSnapshots, true);
  for (const error of ["binding", "template", "trigger"]) await assert.rejects(helper.assertLegacy0009(client(error)));
});

test("default0009 tool is no-access preparation; missing root release rejects before external commands", async () => {
  const log = console.log, previous = process.env.SIGNAL_STAGE_0009_RELEASE, records:any[] = [];
  console.log = value => records.push(JSON.parse(value));
  delete process.env.SIGNAL_STAGE_0009_RELEASE;
  try {
    await helper.main([]);
    await assert.rejects(helper.main(["--upgrade-owned-stage"]), /Root release/);
    await assert.rejects(helper.main(["--reset"]));
    await assert.rejects(helper.main(["--upgrade-owned-stage", "extra"]));
  } finally { console.log = log; if (previous === undefined) delete process.env.SIGNAL_STAGE_0009_RELEASE; else process.env.SIGNAL_STAGE_0009_RELEASE = previous; }
  assert.equal(records.length, 1); assert.equal(records[0].checkOnly, true);
  for (const field of ["dockerCalled", "databaseAccess", "backupCreated", "migrated", "seeded", "restarted"]) assert.equal(records[0][field], false);
});
