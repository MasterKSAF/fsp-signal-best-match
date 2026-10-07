import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { POSTGRES_INT_ID_MAX, postgresIntIdSchema, postgresIntIdTextSchema, parsePostgresIntId, postgresIntIdParam } from '../artifacts/api-server/src/lib/postgres-id';

test('PostgreSQL integer ID parser accepts inclusive real database bounds without truncation', () => {
  for (const value of [1, 2, POSTGRES_INT_ID_MAX - 1, POSTGRES_INT_ID_MAX]) {
    assert.equal(parsePostgresIntId(value), value);
    assert.equal(parsePostgresIntId(String(value)), value);
    assert.equal(postgresIntIdSchema.safeParse(value).success, true);
    assert.equal(postgresIntIdTextSchema.safeParse(String(value)).success, true);
  }
});

test('PostgreSQL integer ID parser rejects out of range, nonintegers and invalid text before SQL binding', () => {
  for (const value of [0, -1, -2147483648, 1.5, NaN, Infinity, -Infinity, POSTGRES_INT_ID_MAX + 1, Number.MAX_SAFE_INTEGER, '0', '-1', '1.5', 'NaN', 'Infinity', '2147483648', '9007199254740991', '1e2', '0x10', '+1', '01', '1 ', ' 1', '', ' ', '1abc', '9999999999999999999999999999999999999999999']) {
    assert.equal(parsePostgresIntId(value), null, `Rejected value: ${String(value)}`);
  }
});

test('PostgreSQL integer ID parsing never coerces arrays, objects, booleans, bigint or UUID values', () => {
  let coerced = false;
  const object = { valueOf() { coerced = true; return 1; }, toString() { coerced = true; return '1'; } };
  for (const value of [true, false, [], [1], ['1'], {}, object, null, undefined, 1n, 2147483648n, 'a67b6392-17c7-4d46-bbe6-31f1a6c36a0b']) assert.equal(parsePostgresIntId(value), null);
  assert.equal(coerced, false);
});

test('JSON body ID schema requires a number; URL decimal text has a separate explicit contract', () => {
  assert.equal(postgresIntIdSchema.safeParse(42).success, true);
  assert.equal(postgresIntIdSchema.safeParse('42').success, false);
  assert.equal(postgresIntIdTextSchema.safeParse('42').success, true);
  assert.equal(postgresIntIdTextSchema.safeParse(42).success, false);
});

test('Real isolated Express param middleware rejects invalid integer IDs before a handler can bind SQL, preserves text/UUID routes', async () => {
  const requireApi = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
  const express = requireApi('express');
  const app = express();
  const integerRouter = express.Router();
  let handlerCount = 0;
  integerRouter.param('id', postgresIntIdParam);
  integerRouter.all('/integer/:id', (req: { params: { id: string } }, res: { json(value: unknown): void }) => {
    handlerCount++;
    const value = parsePostgresIntId(req.params.id);
    assert.ok(value !== null && value <= POSTGRES_INT_ID_MAX);
    res.json({ id: value });
  });
  app.use(integerRouter);
  app.get('/program/:id', (req: { params: { id: string } }, res: { json(value: unknown): void }) => res.json({ id: req.params.id }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const method of ['GET', 'POST', 'PUT']) for (const value of ['2147483648', '9007199254740991', '-1', '0', '1.5', 'NaN', '1e2', '0x10', 'bad']) {
      const response = await fetch(`${base}/integer/${encodeURIComponent(value)}`, { method });
      assert.equal(response.status, 400, `${method}/${value}`);
      assert.deepEqual(await response.json(), { error: 'Некорректный идентификатор.' });
    }
    assert.equal(handlerCount, 0, 'An invalid ID must never reach the SQL-bound handler.');
    for (const value of ['1', String(POSTGRES_INT_ID_MAX)]) {
      const response = await fetch(`${base}/integer/${value}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { id: Number(value) });
    }
    assert.equal(handlerCount, 2);
    for (const value of ['backend-python', 'a67b6392-17c7-4d46-bbe6-31f1a6c36a0b']) {
      const response = await fetch(`${base}/program/${value}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { id: value });
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  }
});
