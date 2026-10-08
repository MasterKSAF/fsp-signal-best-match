import test from "node:test";
import assert from "node:assert/strict";
import { decodeRecipientCursor, encodeRecipientCursor, microRecipientQuery, recipientCursorContext, recipientSearch } from "../artifacts/api-server/src/lib/microtask-recipient-query";
const context = recipientCursorContext({ companyId: 5, scope: { demoMode: true, reviewScopeId: null },
  templateId: 17, specialization: "Backend / Python", search: "Same alias", grade: "Middle" });
test("recipient page is bounded and rejects repeated or unknown filters", () => {
  assert.equal(microRecipientQuery.parse({}).limit, 25);
  assert.equal(microRecipientQuery.parse({ limit: "50", templateId: "1" }).limit, 50);
  for (const input of [{ limit: "51" }, { limit: "0" }, { templateId: ["1", "2"] }, { limit: ["1"] },
    { grade: "Other" }, { search: "x".repeat(101) }, { scope: "foreign" }, { cursor: "x".repeat(513) }]) {
    assert.equal(microRecipientQuery.safeParse(input).success, false);
  }
});
test("unique resume key survives duplicate aliases; cursor is bound to filter, company and pool", () => {
  const cursor = encodeRecipientCursor(101, context);
  assert.equal(decodeRecipientCursor(cursor, context), 101);
  assert.equal(decodeRecipientCursor(undefined, context), null);
  for (const changed of ["different-filter", recipientCursorContext({ companyId: 6, scope: { demoMode: true, reviewScopeId: null },
    templateId: 17, specialization: "Backend / Python", search: "Same alias", grade: "Middle" })]) {
    assert.throws(() => decodeRecipientCursor(cursor, changed), /Начните поиск/);
  }
  assert.throws(() => decodeRecipientCursor(Buffer.from(JSON.stringify({ v: 1, after: 0, context })).toString("base64url"), context));
});
test("recipient search normalizes surrounding Unicode whitespace without introducing fuzzy aliases", () => {
  assert.equal(recipientSearch("\u00a0 Same   alias \u00a0"), "Same alias");
  assert.equal(recipientSearch("SQL"), "SQL");
  assert.notEqual(recipientSearch("Java"), recipientSearch("JavaScript"));
});
