import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import { createClerkAuthenticator, createProtectedHandler } from '../_lib/auth.js';

export function validateCompanyDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = new Set(['name', 'industry', 'location', 'website']);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const clean = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? item.trim() : item]));
  if (typeof clean.name !== 'string' || clean.name.length < 1 || clean.name.length > 160) return null;
  if (typeof clean.industry !== 'string' || clean.industry.length < 1 || clean.industry.length > 120) return null;
  for (const key of ['location', 'website']) {
    if (clean[key] !== undefined && (typeof clean[key] !== 'string' || clean[key].length > 240)) return null;
  }
  if (clean.website) {
    try { if (!['http:', 'https:'].includes(new URL(clean.website).protocol)) return null; }
    catch { return null; }
  }
  return { name: clean.name, industry: clean.industry, location: clean.location || null, website: clean.website || null };
}

function readBody(body) {
  if (typeof body !== 'string') return body;
  try { return JSON.parse(body); } catch { return null; }
}

export default createProtectedHandler({
  authenticate: createClerkAuthenticator(),
  method: 'POST',
  handle: async ({ clerkUserId }, req, res) => {
    const company = validateCompanyDetails(readBody(req.body));
    if (!company) return res.status(400).json({ error: 'invalid_company_details' });
    const connectionString = process.env.DATABASE_URL;
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!connectionString || !secretKey) return res.status(503).json({ error: 'onboarding_not_configured' });

    try {
      const { createClerkClient } = await import('@clerk/backend');
      const clerk = createClerkClient({ secretKey, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
      const user = await clerk.users.getUser(clerkUserId);
      const primaryEmail = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
      if (!primaryEmail || primaryEmail.verification?.status !== 'verified') {
        return res.status(403).json({ error: 'verified_email_required' });
      }
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
      if (!fullName) return res.status(400).json({ error: 'profile_name_required' });
      const sql = neon(connectionString);
      const companyId = randomUUID();
      const [subjectContext, result] = await sql.transaction([
        sql`SELECT set_config('app.current_clerk_subject', ${clerkUserId}, true),
                   set_config('app.current_company_id', ${companyId}, true),
                   set_config('app.onboarding_company_id', ${companyId}, true)`,
        sql`WITH new_user AS (
              INSERT INTO users (auth_provider, auth_subject, email, full_name)
              VALUES ('clerk', ${clerkUserId}, ${primaryEmail.emailAddress}, ${fullName})
              RETURNING id
            ), bind_user AS MATERIALIZED (
              SELECT id, set_config('app.current_user_id', id::text, true) AS configured FROM new_user
            ), new_company AS (
              INSERT INTO companies (id, name, industry, location, website)
              SELECT ${companyId}::uuid, ${company.name}, ${company.industry}, ${company.location}, ${company.website}
              FROM bind_user WHERE bind_user.configured IS NOT NULL
              RETURNING id, name, industry, location, website
            ), bind_company AS MATERIALIZED (
              SELECT id, set_config('app.current_company_id', id::text, true) AS configured FROM new_company
            ), new_membership AS (
              INSERT INTO company_memberships (company_id, user_id, role)
              SELECT bind_company.id, bind_user.id, 'owner' FROM bind_company CROSS JOIN bind_user
              WHERE bind_company.configured IS NOT NULL AND bind_user.configured IS NOT NULL
              RETURNING company_id, user_id, role
            )
            SELECT created_company.id, created_company.name, created_company.industry, created_company.location,
                   created_company.website, membership.role
            FROM new_membership AS membership JOIN new_company AS created_company
              ON created_company.id = membership.company_id`,
      ]);
      void subjectContext;
      if (!result[0]) return res.status(409).json({ error: 'account_already_provisioned' });
      return res.status(201).json({ company: result[0] });
    } catch (error) {
      // Unique conflicts (e.g. concurrent onboarding attempts) fail the entire
      // SQL statement, so no partial user/company/owner rows are left behind.
      if (error?.code === '23505') return res.status(409).json({ error: 'account_already_provisioned' });
      throw error;
    }
  },
});
