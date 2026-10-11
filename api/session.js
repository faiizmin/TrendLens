import { neon } from '@neondatabase/serverless';
import { createClerkAuthenticator, createProtectedHandler } from './_lib/auth.js';
import { resolveAuthorizedCompany, isValidCompanyId } from './_lib/authorization.js';

export default createProtectedHandler({
  authenticate: createClerkAuthenticator(),
  method: 'GET',
  handle: async ({ clerkUserId }, req, res) => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return res.status(503).json({ error: 'database_not_configured' });
    const rawCompanyId = typeof req.query?.companyId === 'string' ? req.query.companyId : null;
    if (rawCompanyId && !isValidCompanyId(rawCompanyId)) return res.status(400).json({ error: 'invalid_company_id' });
    const resolved = await resolveAuthorizedCompany(neon(connectionString), clerkUserId, rawCompanyId);
    if (resolved.forbidden) return res.status(403).json({ error: 'company_forbidden' });
    return res.status(200).json({
      authenticated: true,
      profileProvisioned: Boolean(resolved.user),
      onboardingRequired: !resolved.user || resolved.memberships.length === 0,
      memberships: resolved.memberships,
      company: resolved.company,
    });
  },
});

