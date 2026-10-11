import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCompanyDetails } from './company.js';

test('onboarding accepts company details and supplies optional empty fields safely', () => {
  assert.deepEqual(validateCompanyDetails({ name: 'North Plant', industry: 'Manufacturing' }), {
    name: 'North Plant', industry: 'Manufacturing', location: null, website: null,
  });
});

test('onboarding refuses browser-supplied ownership, identity, or company identifiers', () => {
  assert.equal(validateCompanyDetails({ name: 'Plant', industry: 'Manufacturing', role: 'owner' }), null);
  assert.equal(validateCompanyDetails({ name: 'Plant', industry: 'Manufacturing', companyId: 'known-id' }), null);
  assert.equal(validateCompanyDetails({ name: 'Plant', industry: 'Manufacturing', userId: 'known-id' }), null);
});

test('onboarding validates company fields and website protocol', () => {
  assert.equal(validateCompanyDetails({ name: ' ', industry: 'Manufacturing' }), null);
  assert.equal(validateCompanyDetails({ name: 'Plant', industry: 'Manufacturing', website: 'javascript:alert(1)' }), null);
});

