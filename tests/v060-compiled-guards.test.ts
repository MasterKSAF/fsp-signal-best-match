import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const noRelease = { ...process.env };
delete noRelease.SIGNAL_V060_COMPILED_RELEASE;

test("compiled DB preparation cannot call external operations without explicit root release", () => {
  const result = spawnSync(process.execPath, ["scripts/prepare-v060-compiled-check.cjs"], { cwd: process.cwd(), env: noRelease, encoding: "utf8", timeout: 10_000, windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Explicit root-owned compiled check release required before DB access/);
  assert.doesNotMatch(result.stdout, /migrated|seeded|privateEnvironmentFile/);
});
