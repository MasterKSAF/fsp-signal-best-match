import assert from "node:assert/strict";

const targets = {
  "stage-v1": {
    database: "signal_resume_stage",
    postgresPort: "55435",
    apiPort: "4313",
    appPort: "4314",
  },
  "dedicated-v1": {
    database: "signal_resume_load_check",
    postgresPort: "55435",
    apiPort: "4315",
    appPort: "4316",
  },
} as const;

/** Exact local targets; never accepts a supplied arbitrary database/API origin. */
export function validatedLoadTarget(
  environment: NodeJS.ProcessEnv,
  requireHttp = true,
) {
  assert.equal(environment.SIGNAL_CATALOG_TEST_ISOLATED, "1");
  const key = environment.SIGNAL_LOAD_PROFILE as keyof typeof targets;
  assert.ok(
    Object.hasOwn(targets, key),
    "Explicit allowlisted SIGNAL_LOAD_PROFILE required",
  );
  const target = targets[key];
  const database = new URL(environment.DATABASE_URL!);
  assert.equal(database.protocol, "postgresql:");
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, target.postgresPort);
  assert.equal(database.pathname, `/${target.database}`);
  if (requireHttp) {
    assert.equal(
      environment.LOAD_API_ORIGIN,
      `http://127.0.0.1:${target.apiPort}`,
    );
    assert.equal(
      environment.INTEGRATION_APP_ORIGIN,
      `http://127.0.0.1:${target.appPort}`,
    );
  }
  return { key, ...target };
}
