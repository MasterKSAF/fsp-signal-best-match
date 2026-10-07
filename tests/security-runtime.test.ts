import assert from "node:assert/strict";
import test from "node:test";
import {
  isDemoModeEnabled,
  isDemoVerificationCodeExposureEnabled,
  isSecureCookieRequired,
  isTrustedBrowserOrigin,
} from "../artifacts/api-server/src/lib/signal-runtime.ts";

test("demo capabilities require an explicit DEMO_MODE switch", () => {
  assert.equal(isDemoModeEnabled({ NODE_ENV: "development" }), false);
  assert.equal(isDemoModeEnabled({ DEMO_MODE: "false" }), false);
  assert.equal(isDemoModeEnabled({ DEMO_MODE: "true" }), true);
  assert.equal(
    isDemoVerificationCodeExposureEnabled({ DEMO_MODE: "true" }),
    false,
  );
  assert.equal(
    isDemoVerificationCodeExposureEnabled({
      DEMO_MODE: "true",
      EXPOSE_DEMO_VERIFICATION_CODE: "true",
    }),
    true,
  );
});

test("session cookie follows the public HTTPS scheme and local CORS stays demo-only", () => {
  assert.equal(
    isSecureCookieRequired({ NODE_ENV: "production", PUBLIC_URL: "http://127.0.0.1:4310" }),
    false,
  );
  assert.equal(
    isSecureCookieRequired({ NODE_ENV: "production", PUBLIC_URL: "https://signal.example" }),
    true,
  );
  assert.equal(
    isSecureCookieRequired({
      NODE_ENV: "production",
      PUBLIC_URL: "http://signal.example",
      SESSION_COOKIE_SECURE: "false",
    }),
    true,
  );
  assert.equal(
    isTrustedBrowserOrigin("http://127.0.0.1:4310", { DEMO_MODE: "true" }),
    true,
  );
  assert.equal(
    isTrustedBrowserOrigin("https://attacker.example", { DEMO_MODE: "true" }),
    false,
  );
  assert.equal(
    isTrustedBrowserOrigin("http://127.0.0.1:4310", { DEMO_MODE: "false" }),
    false,
  );
  assert.equal(
    isTrustedBrowserOrigin("http://signal.example", {
      NODE_ENV: "production",
      PUBLIC_URL: "http://signal.example",
    }),
    false,
  );
});
