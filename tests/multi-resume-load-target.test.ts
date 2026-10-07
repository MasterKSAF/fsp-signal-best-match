import assert from "node:assert/strict";
import test from "node:test";
import { validatedLoadTarget } from "../scripts/multi-resume-load-target";

const dedicated = {
  SIGNAL_CATALOG_TEST_ISOLATED: "1",
  SIGNAL_LOAD_PROFILE: "dedicated-v1",
  DATABASE_URL:
    "postgresql://fixture:unused@127.0.0.1:55435/signal_resume_load_check",
  LOAD_API_ORIGIN: "http://127.0.0.1:4315",
  INTEGRATION_APP_ORIGIN: "http://127.0.0.1:4316",
};
test("dedicated load guard requires exact named database and API/app ports", () => {
  assert.equal(
    validatedLoadTarget(dedicated).database,
    "signal_resume_load_check",
  );
  for (const [field, value] of [
    [
      "DATABASE_URL",
      "postgresql://fixture:unused@127.0.0.1:55435/signal_resume_stage",
    ],
    ["DATABASE_URL", "postgresql://fixture:unused@127.0.0.1:55433/signal"],
    ["LOAD_API_ORIGIN", "http://127.0.0.1:4313"],
    ["INTEGRATION_APP_ORIGIN", "http://127.0.0.1:4314"],
    [
      "DATABASE_URL",
      "postgresql://fixture:unused@192.168.1.1:55435/signal_resume_load_check",
    ],
  ])
    assert.throws(() => validatedLoadTarget({ ...dedicated, [field]: value }));
});
test("no implicit profile, isolation flag or arbitrary target bypass", () => {
  for (const changes of [
    { SIGNAL_LOAD_PROFILE: undefined },
    { SIGNAL_LOAD_PROFILE: "production" },
    { SIGNAL_LOAD_PROFILE: "__proto__" },
    { SIGNAL_CATALOG_TEST_ISOLATED: "0" },
  ])
    assert.throws(() => validatedLoadTarget({ ...dedicated, ...changes }));
});
test("legacy stage profile stays distinct and cleanup still checks exact database", () => {
  const stage = {
    ...dedicated,
    SIGNAL_LOAD_PROFILE: "stage-v1",
    DATABASE_URL:
      "postgresql://fixture:unused@127.0.0.1:55435/signal_resume_stage",
    LOAD_API_ORIGIN: "http://127.0.0.1:4313",
    INTEGRATION_APP_ORIGIN: "http://127.0.0.1:4314",
  };
  assert.equal(validatedLoadTarget(stage).database, "signal_resume_stage");
  assert.throws(() =>
    validatedLoadTarget(
      { ...stage, DATABASE_URL: dedicated.DATABASE_URL },
      false,
    ),
  );
});
