import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthHandler } from './healthHandler.js';

function responseMock() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('health responds with a safe connected status when its probe succeeds', async () => {
  const response = responseMock();
  let connectionStringSeen;
  const handler = createHealthHandler({
    getConnectionString: () => 'server-only-secret',
    queryDatabase: async (connectionString) => { connectionStringSeen = connectionString; },
  });
  await handler({ method: 'GET' }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(response.body, { ok: true, status: 'connected' });
  assert.equal(JSON.stringify(response.body).includes('server-only-secret'), false);
  assert.equal(connectionStringSeen, 'server-only-secret');
});

test('health reports missing configuration without attempting a query', async () => {
  const response = responseMock();
  let queried = false;
  const handler = createHealthHandler({ getConnectionString: () => '', queryDatabase: async () => { queried = true; } });
  await handler({ method: 'GET' }, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ok: false, status: 'not_configured' });
  assert.equal(queried, false);
});

test('health hides database driver errors and rejects non-GET requests', async () => {
  const unavailable = responseMock();
  const broken = createHealthHandler({ getConnectionString: () => 'secret', queryDatabase: async () => { throw new Error('postgres://user:password@host/db'); } });
  await broken({ method: 'GET' }, unavailable);
  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(unavailable.body, { ok: false, status: 'unavailable' });
  assert.equal(JSON.stringify(unavailable.body).includes('password'), false);

  const methodResponse = responseMock();
  await broken({ method: 'POST' }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, 'GET');
});
