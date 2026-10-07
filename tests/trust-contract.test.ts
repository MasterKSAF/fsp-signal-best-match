import assert from "node:assert/strict";
import test from "node:test";
import { AppealDecisionSchema, BlockCompanySchema, ComplaintDecisionSchema, complaintTransitionAllowed, publicRestrictionReasons, SubmitComplaintSchema } from "../artifacts/api-server/src/lib/signal-trust-contract.ts";

const complaint = { objectType: "invitation", objectId: 13, category: "spam", explanation: "Повторные обращения", idempotencyKey: "request_case_1" };
test("complaints accept explicit accessible-object contracts and reject role, owner and status forgery", () => {
  assert.ok(SubmitComplaintSchema.safeParse(complaint).success);
  for (const attack of [{ reporterUserId: 42 }, { companyId: 8 }, { status: "upheld" }, { moderator: true }, { contactEmail: "private@example.test" }]) assert.equal(SubmitComplaintSchema.safeParse({ ...complaint, ...attack }).success, false);
  assert.equal(SubmitComplaintSchema.safeParse({ ...complaint, objectId: -1 }).success, false);
  assert.equal(SubmitComplaintSchema.safeParse({ ...complaint, objectType: "user" }).success, false);
});
test("complaint input bounds prevent unbounded or control-character audit/display content", () => {
  assert.equal(SubmitComplaintSchema.safeParse({ ...complaint, explanation: "x".repeat(2001) }).success, false);
  assert.equal(SubmitComplaintSchema.safeParse({ ...complaint, explanation: "abc\u0000def" }).success, false);
  assert.equal(SubmitComplaintSchema.safeParse({ ...complaint, idempotencyKey: "<script>" }).success, false);
  assert.equal(SubmitComplaintSchema.safeParse({ ...complaint, explanation: "<script>alert(1)</script>" }).success, true, "Content is text; React must render as text rather than HTML.");
});
test("terminal moderation decisions cannot be silently rewritten into another disposition", () => {
  for (const state of ["submitted", "in_review"]) for (const action of ["review", "dismiss", "restrict"] as const) assert.equal(complaintTransitionAllowed(state, action), true);
  for (const state of ["dismissed", "upheld"]) for (const action of ["review", "dismiss", "restrict"] as const) assert.equal(complaintTransitionAllowed(state, action), false);
  assert.equal(ComplaintDecisionSchema.safeParse({ action: "restrict", reason: "Основание проверено", durationHours: 0 }).success, false);
  assert.equal(ComplaintDecisionSchema.safeParse({ action: "restrict", reason: "Основание проверено", durationHours: 721 }).success, false);
});
test("public restriction reasons come from a controlled category, never from raw reporter explanation", () => {
  const decision = ComplaintDecisionSchema.parse({ action: "restrict", reason: "Проверено модератором", publicReasonCode: "privacy" });
  assert.match(publicRestrictionReasons[decision.publicReasonCode], /правил доступа/);
  assert.equal(ComplaintDecisionSchema.safeParse({ action: "restrict", reason: "Проверено модератором", publicReason: "Жалоба от private@example.test" }).success, false);
  assert.equal(ComplaintDecisionSchema.safeParse({ action: "restrict", reason: "Проверено модератором", publicReasonCode: "private@example.test" }).success, false);
});
test("unblocking is an explicit boolean action, not contact-consent restoration or moderation privilege", () => {
  assert.ok(BlockCompanySchema.safeParse({ blocked: false }).success);
  assert.equal(BlockCompanySchema.safeParse({ blocked: false, restoreContacts: true }).success, false);
  assert.equal(BlockCompanySchema.safeParse({ blocked: false, moderator: true }).success, false);
  assert.equal(AppealDecisionSchema.safeParse({ action: "grant-role", reason: "Выдать права" }).success, false);
});
