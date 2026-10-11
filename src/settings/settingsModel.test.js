import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANY_STORAGE_KEY, PROFILE_STORAGE_KEY, defaultCompany, defaultProfile,
  readSettings, validateCompany, validateProfile, writeSetting,
} from './settingsModel.js';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('settings read separately from storage and default when absent', () => {
  const storage = memoryStorage();
  const result = readSettings(storage);
  assert.deepEqual(result.profile, defaultProfile);
  assert.deepEqual(result.company, defaultCompany);
  assert.deepEqual(result.errors, []);
});

test('profile editing persists without overwriting company settings', () => {
  const storage = memoryStorage();
  const edited = { ...defaultProfile, name: 'Alex Kim', email: 'alex@example.com' };
  assert.equal(writeSetting(storage, PROFILE_STORAGE_KEY, edited).ok, true);
  const loaded = readSettings(storage);
  assert.deepEqual(loaded.profile, edited);
  assert.deepEqual(loaded.company, defaultCompany);
});

test('company changes persist independently and can be discarded by retaining saved value', () => {
  const storage = memoryStorage();
  const edited = { ...defaultCompany, name: 'Summit Fabrication' };
  writeSetting(storage, COMPANY_STORAGE_KEY, edited);
  assert.equal(readSettings(storage).company.name, 'Summit Fabrication');
  const unsavedDraft = { ...edited, name: 'Unsaved Name' };
  assert.equal(readSettings(storage).company.name, 'Summit Fabrication');
  assert.equal(unsavedDraft.name, 'Unsaved Name');
});

test('validates required profile fields and email format', () => {
  assert.deepEqual(validateProfile({ name: ' ', email: 'bad', role: '' }), {
    name: 'Enter your name.', email: 'Enter a valid email address.', role: 'Enter your job title.',
  });
  assert.deepEqual(validateProfile(defaultProfile), {});
});

test('validates required company fields and optional website format', () => {
  assert.deepEqual(validateCompany({ name: '', industry: '', location: '', website: 'ftp://example.com' }), {
    name: 'Enter a company name.', industry: 'Enter an industry.', location: 'Enter a location.',
    website: 'Enter a valid website URL, including https://.',
  });
  assert.deepEqual(validateCompany(defaultCompany), {});
});

test('storage failures are reported and malformed records fall back safely', () => {
  const brokenStorage = { getItem: () => '{bad json', setItem: () => { throw new Error('quota'); } };
  assert.match(readSettings(brokenStorage).errors[0], /could not be read/i);
  assert.equal(writeSetting(brokenStorage, PROFILE_STORAGE_KEY, defaultProfile).ok, false);
});
