import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validFspSaveInput, savedFspIdentityValues } from '../artifacts/api-server/src/lib/fsp-provider';

// JSON-compatible YAML avoids any dependency on a parent-workspace parser.
const fragment = JSON.parse(readFileSync(new URL('../docs/contracts/fsp-openapi.yaml', import.meta.url), 'utf8'));
test('published FSP save contract matches strict identity-only implementation', () => {
  const input = fragment.components.schemas.FspConnectionInput;
  assert.deepEqual(input.required, ['fspId']); assert.equal(input.additionalProperties, false);
  assert.deepEqual(Object.keys(input.properties), ['fspId']); assert.equal(input.properties.fspId.maxLength, 100);
  assert.deepEqual(validFspSaveInput({fspId:'MY-ID-22'}), {fspId:'MY-ID-22'});
  assert.equal(validFspSaveInput({fspId:'MY-ID-22',consentImport:true}), null);
  for (const fspId of ['MY-ID-22','FSP-DEMO-2026']) {
    const value = savedFspIdentityValues(fspId, new Date());
    assert.equal(value.status, 'pending'); assert.deepEqual(value.achievements, []);
    assert.equal(value.verifiedAt, null); assert.equal(value.consentedAt, null);
  }
  const description = fragment.paths['/me/fsp-connection'].put.description;
  assert.match(description, /Every entered ID/); assert.doesNotMatch(description, /imports synthetic achievements/);
});
test('published import contract reports consent, missing ID and unavailable registry distinctly', () => {
  const operation = fragment.paths['/me/fsp-connection/import'].post;
  const schema = operation.requestBody.content['application/json'].schema;
  assert.deepEqual(schema.required,['consentImport']); assert.equal(schema.additionalProperties,false);
  assert.deepEqual(schema.properties.consentImport,{type:'boolean',const:true});
  for (const code of [400,401,403,409,503]) assert.ok(operation.responses[code]);
  assert.equal(operation.responses[503].content['application/json'].example.code,'registry_not_configured');
  assert.ok(!operation.responses[200]);
  assert.ok(fragment.components.schemas.FspConnection.required.includes('importAvailable'));
  assert.ok(fragment.components.schemas.FspConnection.required.includes('fspSignal'));
});
