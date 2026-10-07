import assert from "node:assert/strict";
import test from "node:test";
import { resolveMailTransport } from "../artifacts/api-server/src/lib/signal-mail.ts";
import { FixedWindowRateLimiter } from "../artifacts/api-server/src/lib/signal-rate-limit.ts";

test("rate limiter caps attempts and recovers at the next window", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000, 10);
  assert.equal(limiter.consume("127.0.0.1", 100).limited, false);
  assert.equal(limiter.consume("127.0.0.1", 200).limited, false);
  const blocked = limiter.consume("127.0.0.1", 300);
  assert.equal(blocked.limited, true);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(limiter.consume("127.0.0.1", 1_101).limited, false);
});

test("Mailpit transport is explicit and rejects non-HTTP configuration", () => {
  assert.deepEqual(resolveMailTransport({}), null);
  assert.deepEqual(resolveMailTransport({ MAILPIT_URL: "file:///tmp/mailpit" }), null);
  assert.deepEqual(resolveMailTransport({ MAILPIT_URL: "http://mailpit:8025", MAIL_FROM: "not-an-email" }), null);
  assert.deepEqual(resolveMailTransport({ MAILPIT_URL: "http://mailpit:8025" }), {
    endpoint: "http://mailpit:8025/api/v1/send",
    from: "no-reply@fsp-signal.local",
  });
});
