/** Local operator CLI. Never expose this module as a candidate or employer endpoint. */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, signalAssessmentAttemptsTable, signalAssessmentCorrectionsTable, signalBankAuditTable, signalBankTemplateOverridesTable, signalCandidateProfilesTable } from "@workspace/db";
import { managedTemplates, exposedTemplateIds, programSpecialization, verifiedSkillsForAttempt } from "../artifacts/api-server/src/lib/assessment-managed";
import { scoreAttempt, type AttemptOracle } from "../artifacts/api-server/src/lib/assessment-bank";

import { recomputeCandidateResumes } from "../artifacts/api-server/src/lib/signal-resume";

const args = process.argv.slice(2);
const option = (key: string) => { const index = args.indexOf(`--${key}`); return index >= 0 ? args[index + 1] : undefined; };
const command = args[0];
const actor = option("operator")?.trim(); const reason = option("reason")?.trim();
if (!["inventory", "disable", "enable", "annul"].includes(command ?? "")) throw new Error("Usage: inventory | disable|enable --template ID --operator NAME --reason TEXT | annul --attempt ID --operator NAME --reason TEXT");
if (command !== "inventory" && (!actor || actor.length > 120 || !reason || reason.length < 12 || reason.length > 1000)) throw new Error("Supply operator (1..120) and a specific reason (12..1000 characters).");

if (command === "inventory") {
  const overrides = await db.select().from(signalBankTemplateOverridesTable);
  const attempts = await db.select({ oracles: signalAssessmentAttemptsTable.oracles }).from(signalAssessmentAttemptsTable);
  const counts = new Map<string, number>();
  attempts.flatMap(row => exposedTemplateIds(row.oracles)).forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
  // Template metadata and aggregate exposure only. Never print answers, seeds, users or case prompts.
  console.log(JSON.stringify(managedTemplates.map(template => ({ ...template, status: overrides.find(row => row.templateId === template.id)?.status ?? "active", issued: counts.get(template.id) ?? 0 })), null, 2));
} else if (command === "disable" || command === "enable") {
  const templateId = option("template");
  if (!managedTemplates.some(item => item.id === templateId)) throw new Error("Unknown stable template ID.");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(751203)`);
    const values = { status: command === "disable" ? "disabled" as const : "active" as const, operator: actor!, reason: reason!, updatedAt: new Date() };
    await tx.insert(signalBankTemplateOverridesTable).values({ templateId: templateId!, ...values }).onConflictDoUpdate({ target: signalBankTemplateOverridesTable.templateId, set: values });
    await tx.insert(signalBankAuditTable).values({ action: command, templateId: templateId!, operator: actor!, reason: reason!, details: { policy: "new_attempts_only", activeSnapshots: "unchanged" } });
  });
  console.log(JSON.stringify({ action: command, templateId, policy: "New attempts only. Issued snapshots remain unchanged." }));
} else {
  const attemptId = Number(option("attempt"));
  if (!Number.isSafeInteger(attemptId) || attemptId < 1) throw new Error("Supply a positive attempt ID.");
  await db.transaction(async tx => {
    const [owner] = await tx.select({ userId: signalAssessmentAttemptsTable.userId }).from(signalAssessmentAttemptsTable).where(eq(signalAssessmentAttemptsTable.id, attemptId)).limit(1);
    if (!owner) throw new Error("Attempt not found.");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${owner.userId})`);
    const [attempt] = await tx.select().from(signalAssessmentAttemptsTable).where(eq(signalAssessmentAttemptsTable.id, attemptId)).limit(1);
    const [already] = await tx.select().from(signalAssessmentCorrectionsTable).where(eq(signalAssessmentCorrectionsTable.attemptId, attemptId)).limit(1);
    if (already) throw new Error("Attempt already annulled; original correction is immutable.");
    await tx.insert(signalAssessmentCorrectionsTable).values({ attemptId, operator: actor!, reason: reason!, originalDecision: { score: attempt!.score, verified: attempt!.verified, status: attempt!.status } });
    await recomputeCandidateResumes(owner.userId, tx);
    const affectsCurrentEvidence = true;
    await tx.insert(signalBankAuditTable).values({ action: "annul_attempt", attemptId, operator: actor!, reason: reason!, details: { originalScore: attempt!.score, originalVerified: attempt!.verified, originalStatus: attempt!.status, profileEvidenceRestored: affectsCurrentEvidence, immutableSnapshot: true } });
  });
  console.log(JSON.stringify({ action: "annul_attempt", attemptId, policy: "Historical snapshot preserved; correction shown to candidate; fresh attempt allowed." }));
}
process.exit(0);
