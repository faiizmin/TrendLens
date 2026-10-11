export const PROFILE_STORAGE_KEY = 'trendlens.profile.v1';
export const COMPANY_STORAGE_KEY = 'trendlens.company.v1';

export const defaultProfile = Object.freeze({
  name: 'Jamie Morgan',
  email: 'jamie.morgan@northstar.example',
  role: 'Operations manager',
});

export const defaultCompany = Object.freeze({
  name: 'Northstar Works',
  industry: 'Manufacturing',
  location: 'Kuala Lumpur, Malaysia',
  website: 'https://northstar.example',
});

function readOne(storage, key, defaults) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { value: { ...defaults }, error: '' };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: { ...defaults }, error: 'Saved settings were invalid. Defaults are shown.' };
    }
    return { value: { ...defaults, ...parsed }, error: '' };
  } catch {
    return { value: { ...defaults }, error: 'Saved settings could not be read. Defaults are shown.' };
  }
}

export function readSettings(storage) {
  const profile = readOne(storage, PROFILE_STORAGE_KEY, defaultProfile);
  const company = readOne(storage, COMPANY_STORAGE_KEY, defaultCompany);
  return { profile: profile.value, company: company.value, errors: [profile.error, company.error].filter(Boolean) };
}

export function validateProfile(profile) {
  const errors = {};
  if (!profile.name.trim()) errors.name = 'Enter your name.';
  if (!profile.email.trim()) errors.email = 'Enter your email address.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) errors.email = 'Enter a valid email address.';
  if (!profile.role.trim()) errors.role = 'Enter your job title.';
  return errors;
}

export function validateCompany(company) {
  const errors = {};
  if (!company.name.trim()) errors.name = 'Enter a company name.';
  if (!company.industry.trim()) errors.industry = 'Enter an industry.';
  if (!company.location.trim()) errors.location = 'Enter a location.';
  if (company.website.trim()) {
    try {
      const url = new URL(company.website.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol');
    } catch {
      errors.website = 'Enter a valid website URL, including https://.';
    }
  }
  return errors;
}

export function writeSetting(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return { ok: true, error: '' };
  } catch {
    return { ok: false, error: 'Could not save settings in this browser. Check storage availability and try again.' };
  }
}
