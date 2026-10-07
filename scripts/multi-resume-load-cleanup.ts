/** Crash recovery for this benchmark's exact manifest-owned isolated fixtures. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  signalUsersTable as users,
  signalCandidateResumesTable as resumes,
  signalAssessmentAttemptsTable as attempts,
} from "../lib/db/src/index";
import { validatedLoadTarget } from "./multi-resume-load-target";

const target = validatedLoadTarget(process.env, false);
const path = "outputs/local-backup/multi-resume-load-owned.json";
const manifest = JSON.parse(await readFile(path, "utf8"));
assert.equal(manifest.database, target.database);
if (manifest.profile) assert.equal(manifest.profile, target.key);
assert.ok(/^[a-f0-9]{12}$/.test(manifest.id));
const capturedIds: number[] = manifest.createdUserIds;
const expectedEmployerEmails = Array.from(
  { length: 16 },
  (_, index) => `multi-load-${manifest.id}-employer-${index}@example.test`,
);
// The first failed run persisted the manifest before employer creation. Exact
// expected fixture addresses recover only those sixteen controlled accounts.
const recoverEmployers = await db
  .select({ id: users.id })
  .from(users)
  .where(inArray(users.email, expectedEmployerEmails));
const ids: number[] = [
  ...new Set([...capturedIds, ...recoverEmployers.map((row) => row.id)]),
];
assert.ok(
  Array.isArray(ids) &&
    ids.length <= 5016 &&
    ids.every((id) => Number.isSafeInteger(id) && id > 0),
);
try {
  const owned = ids.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  assert.ok(
    owned.every(
      (row) =>
        row.email.startsWith(`multi-load-${manifest.id}-`) &&
        row.email.endsWith("@example.test"),
    ),
    "Every captured account must retain the exact synthetic owner prefix",
  );
  const before = {
    users: owned.length,
    resumes: (
      await db
        .select({ id: resumes.id })
        .from(resumes)
        .where(inArray(resumes.userId, ids))
    ).length,
    attempts: (
      await db
        .select({ id: attempts.id })
        .from(attempts)
        .where(inArray(attempts.userId, ids))
    ).length,
  };
  for (let offset = 0; offset < owned.length; offset += 100) {
    const batch = owned.slice(offset, offset + 100).map((row) => row.id);
    for (let retry = 0; ; retry++) {
      try {
        await db.delete(users).where(inArray(users.id, batch));
        break;
      } catch (error) {
        const code = (error as { cause?: { code?: string } }).cause?.code;
        if (!["40P01", "40001"].includes(code ?? "") || retry >= 2) throw error;
      }
    }
  }
  const remaining = (
    await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))
  ).length;
  assert.equal(remaining, 0);
  const cleanup = {
    createdUsers: ids.length,
    remainingUsers: remaining,
    ownerOnly: true,
    recoveredAfterApiDrain: true,
    before,
    at: new Date().toISOString(),
  };
  await writeFile(
    path,
    JSON.stringify(
      {
        ...manifest,
        createdUserIds: ids,
        cleanup: "complete",
        recovery: cleanup,
      },
      null,
      2,
    ),
  );
  await writeFile(
    "outputs/verification/multi-resume/load-cleanup-recovery.json",
    JSON.stringify(cleanup, null, 2),
  );
  console.log(JSON.stringify(cleanup));
} finally {
  await pool.end();
}
