import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedHandler } from './auth.js';
import { resolveAuthorizedCompany, selectAuthorizedMembership } from './authorization.js';

function responseMock() {
  return {
    headers: {}, setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fakeAuthorizationSql({ user = { id: 'user-1' }, memberships = [], company = null } = {}) {
  const sql = (strings, ...values) => ({ text: strings.join(' '), values });
  sql.transaction = async (queries) => queries.map(({ text }) => {
    if (text.includes('SELECT id FROM users') && text.includes('LIMIT 1')) return user ? [user] : [];
    if (text.includes('SELECT company_id, role FROM company_memberships')) return memberships;
    if (text.includes('SELECT id, name, industry, location, website FROM companies')) return company ? [company] : [];
    return [];
  });
  return sql;
}

test('protected endpoint rejects unauthenticated requests', async () => {
  const res = responseMock();
  await createProtectedHandler({ authenticate: async () => null, handle: async () => assert.fail('must not run') })({ method: 'GET' }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'unauthenticated' });
});

test('protected endpoint rejects invalid sessions', async () => {
  const res = responseMock();
  await createProtectedHandler({ authenticate: async () => { throw new Error('bad token'); }, handle: async () => assert.fail('must not run') })({ method: 'GET' }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'invalid_session' });
});

test('protected endpoint denies a company the authenticated user is not a member of', async () => {
  const sql = fakeAuthorizationSql({ memberships: [{ company_id: 'company-a', role: 'owner' }] });
  const res = responseMock();
  const handler = createProtectedHandler({
    authenticate: async () => ({ clerkUserId: 'verified-clerk-subject' }),
    handle: async ({ clerkUserId }, req, response) => {
      const resolved = await resolveAuthorizedCompany(sql, clerkUserId, req.query.companyId);
      if (resolved.forbidden) return response.status(403).json({ error: 'company_forbidden' });
      return response.status(200).json({ company: resolved.company });
    },
  });
  await handler({ method: 'GET', query: { companyId: 'company-b' } }, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'company_forbidden' });
  assert.equal(selectAuthorizedMembership([{ id: 'company-a', role: 'owner' }], 'company-b'), false);
});

test('protected endpoint serves an authorized identity', async () => {
  const membership = selectAuthorizedMembership([{ id: 'company-a', role: 'owner' }], 'company-a');
  assert.deepEqual(membership, { id: 'company-a', role: 'owner' });
  const sql = fakeAuthorizationSql({
      memberships: [{ company_id: 'company-a', role: 'owner' }],
      company: { id: 'company-a', name: 'North Plant', industry: 'Manufacturing', location: null, website: null },
    });
  const res = responseMock();
  const handler = createProtectedHandler({
    authenticate: async () => ({ clerkUserId: 'verified-clerk-subject' }),
    handle: async ({ clerkUserId }, req, response) => {
      const resolved = await resolveAuthorizedCompany(sql, clerkUserId, req.query.companyId);
      return response.status(200).json({ user: clerkUserId, company: resolved.company });
    },
  });
  await handler({ method: 'GET', query: { companyId: 'company-a' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    user: 'verified-clerk-subject',
    company: { id: 'company-a', name: 'North Plant', industry: 'Manufacturing', location: null, website: null, role: 'owner' },
  });
});
