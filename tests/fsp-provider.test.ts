import assert from "node:assert/strict";
import test from "node:test";
import { canUseFspExample, fspDemoFixtureId, fspRegistryProvider, hasTrustedFspHistory, normalizeFspId, resolveFspSafely, validFspLinkInput, type FspRegistryProvider } from "../artifacts/api-server/src/lib/fsp-provider.ts";

test("FSP identity input is bounded and opaque, consent cannot be coerced", () => {
  assert.equal(normalizeFspId("  FSP-001:abc.2_3  "), "FSP-001:abc.2_3");
  for (const value of [null, undefined, 12, {}, "", " ", "a".repeat(101), "someone@example.com", "https://example.org/profile", "<script>", "abc\n123", "АBC"]) assert.equal(normalizeFspId(value), null);
  assert.deepEqual(validFspLinkInput({ fspId: " 123 ", consentImport: true }), { fspId: "123", consentImport: true });
  for (const consentImport of [false, undefined, null, "true", 1]) assert.equal(validFspLinkInput({ fspId: "123", consentImport }), null);
  assert.equal(validFspLinkInput({ fspId: "123", consentImport: true, verified: true }), null);
});

test("real and disabled demo accounts cannot import a synthetic identity", async () => {
  for (const context of [{ accountIsDemo: false, demoEnabled: false }, { accountIsDemo: false, demoEnabled: true }, { accountIsDemo: true, demoEnabled: false }]) {
    assert.equal(canUseFspExample(context), false);
    const result = await fspRegistryProvider.resolve(fspDemoFixtureId, context);
    assert.equal(result.status, "pending"); assert.equal(result.verified, false);
    assert.deepEqual(result.achievements, []); assert.equal(hasTrustedFspHistory(result, context), false);
  }
});

test("an arbitrary ID never claims ownership, imports a stranger or grants a bonus", async () => {
  const context = { accountIsDemo: true, demoEnabled: true };
  for (const id of ["123456", "FSP-DEMO-2027", "fsp-demo-2026"]) {
    const result = await fspRegistryProvider.resolve(id, context);
    assert.equal(result.status, "pending"); assert.equal(result.provenance, "user_supplied");
    assert.equal(result.providerVersion, null); assert.equal(result.errorCode, "registry_not_configured");
    assert.deepEqual(result.achievements, []); assert.equal(hasTrustedFspHistory(result, context), false);
  }
});

test("the allowlisted example is isolated and provenance is required for ranking", async () => {
  const context = { accountIsDemo: true, demoEnabled: true };
  const first = await fspRegistryProvider.resolve(fspDemoFixtureId, context);
  assert.equal(first.status, "connected_demo"); assert.equal(first.verified, true);
  assert.equal(hasTrustedFspHistory(first, context), true);
  assert.ok(first.achievements.every((item) => item.event.startsWith("Пример:")));
  const second = await fspRegistryProvider.resolve(fspDemoFixtureId, context);
  assert.deepEqual(first, second);
  first.achievements.splice(0);
  assert.equal(second.achievements.length, 3);
  assert.deepEqual(second.achievements.map(item=>item.result),['participation','prize','win']);
  assert.equal(hasTrustedFspHistory({ ...second, verified: false }, context), false);
  assert.equal(hasTrustedFspHistory({ ...second, provenance: "user_supplied" }, context), false);
  assert.equal(hasTrustedFspHistory({ ...second, providerVersion: null }, context), false);
  assert.equal(hasTrustedFspHistory({ ...second, status: "unavailable", errorCode: "registry_timeout" }, context), false);
  assert.equal(hasTrustedFspHistory(second, { ...context, demoEnabled: false }), false);
});

test("replacing a connected example with a user-entered ID clears imported claims", async () => {
  const context = { accountIsDemo: true, demoEnabled: true };
  assert.equal(hasTrustedFspHistory(await fspRegistryProvider.resolve(fspDemoFixtureId, context), context), true);
  const replacement = await fspRegistryProvider.resolve("MY-UNVERIFIED-ID", context);
  assert.equal(hasTrustedFspHistory(replacement, context), false);
  assert.equal(replacement.verified, false); assert.equal(replacement.achievements.length, 0);
});

test("provider failures, malformed responses and spoofed claims degrade without leaking errors", async () => {
  const context = { accountIsDemo: true, demoEnabled: true };
  const trusted = await fspRegistryProvider.resolve(fspDemoFixtureId, context);
  const providers: FspRegistryProvider[] = [
    { resolve: async () => { throw new Error("secret upstream token=never-expose"); } },
    { resolve: async () => undefined } as unknown as FspRegistryProvider,
    { resolve: async () => ({ ...trusted, status: "pending" }) },
    ...['false',1,null,undefined].map(verified=>({resolve:async()=>({...trusted,verified})}) as unknown as FspRegistryProvider),
    {resolve:async()=>({...trusted,achievements:[{...trusted.achievements[0]!,hiddenCredential:'not-an-achievement-field'}]})} as unknown as FspRegistryProvider,
    {resolve:async()=>({...trusted,errorCode:'registry_timeout'})},
    { resolve: async () => trusted },
  ];
  for (const provider of providers) {
    const result = await resolveFspSafely("unverified-id", context, provider);
    assert.equal(result.status, "unavailable"); assert.equal(result.errorCode, "registry_unavailable");
    assert.deepEqual(result.achievements, []); assert.equal(hasTrustedFspHistory(result, context), false);
    assert.ok(!JSON.stringify(result).includes("token"));
  }
});
