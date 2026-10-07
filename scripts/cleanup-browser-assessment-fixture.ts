/** Removes only the exact self-created local browser fixture. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db, pool, signalUsersTable as users } from "../lib/db/src/index";
const filename = "outputs/local-backup/browser-qa.json";
const fixture = JSON.parse(await readFile(filename, "utf8"));
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.DATABASE_URL ?? "").hostname));
assert.equal(fixture.candidate.email, `${fixture.fixtureId}@example.test`);
assert.match(fixture.fixtureId, /^browser-qa-[0-9a-f-]{36}$/);
assert.ok(Number.isSafeInteger(fixture.candidate.id));
try {
  if (fixture.employer) {
    assert.equal(fixture.employer.email, `${fixture.fixtureId}-employer@example.test`);
    assert.ok(Number.isSafeInteger(fixture.employer.id));
    await db.delete(users).where(and(eq(users.id, fixture.employer.id), eq(users.email, fixture.employer.email), eq(users.role, "employer"), eq(users.demoMode, false)));
    delete fixture.employer.password;
  }
  await db.delete(users).where(and(eq(users.id, fixture.candidate.id), eq(users.email, fixture.candidate.email), eq(users.demoMode, false)));
  delete fixture.candidate.password;
  fixture.cleanedAt = new Date().toISOString();
  await writeFile(filename, JSON.stringify(fixture, null, 2));
  console.log("Exact synthetic browser candidate and optional employer removed. Working user records preserved.");
} finally { await pool.end(); }
