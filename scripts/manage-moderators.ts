import { eq } from "drizzle-orm";
import { db, pool, signalModeratorPermissionsTable, signalTrustAuditTable, signalUsersTable } from "../lib/db/src/index.ts";
const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const userId = Number(option("--user-id")); const operator = option("--operator");
if (!args.includes("--user-id") || !Number.isSafeInteger(userId) || userId <= 0 || !args.includes("--operator") || !operator || operator.length > 120 || /[\r\n\u0000]/.test(operator)) {
  console.error("Usage: node --env-file-if-exists=.env --import tsx scripts/manage-moderators.ts --user-id <id> --operator <name> [--revoke]");
  await pool.end(); process.exitCode = 2;
} else {
  try {
    const active = !args.includes("--revoke");
    await db.transaction(async tx => {
      const [user] = await tx.select({ id: signalUsersTable.id }).from(signalUsersTable).where(eq(signalUsersTable.id, userId)).limit(1);
      if (!user) throw new Error("Account not found");
      await tx.insert(signalModeratorPermissionsTable).values({ userId, grantedBy: operator, active }).onConflictDoUpdate({ target: signalModeratorPermissionsTable.userId, set: { grantedBy: operator, active, grantedAt: new Date() } });
      await tx.insert(signalTrustAuditTable).values({ actorOperator: operator, action: active ? "moderator_granted" : "moderator_revoked", objectType: "permission", objectId: userId, reason: "Explicit local operator privilege change." });
    });
    console.info(`Moderator permission ${active ? "granted" : "revoked"} for account ${userId}.`);
  } catch (error) { console.error(error instanceof Error ? error.message : "Privilege update failed"); process.exitCode = 1; }
  finally { await pool.end(); }
}
