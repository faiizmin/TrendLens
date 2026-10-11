const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidCompanyId(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function selectAuthorizedMembership(memberships, requestedCompanyId = null) {
  if (!requestedCompanyId) return memberships[0] || null;
  return memberships.find(({ id }) => id === requestedCompanyId) || false;
}

// All app.* settings are SET LOCAL inside a single Neon transaction. The Clerk
// subject is accepted here only from a verified server-side Clerk session.
export async function resolveAuthorizedCompany(sql, clerkUserId, requestedCompanyId = null) {
  const [bindSubject, userRows, bindUser, memberships] = await sql.transaction([
    sql`SELECT set_config('app.current_clerk_subject', ${clerkUserId}, true)`,
    sql`SELECT id FROM users WHERE auth_provider = 'clerk' AND auth_subject = ${clerkUserId} LIMIT 1`,
    sql`SELECT set_config('app.current_user_id', COALESCE((SELECT id::text FROM users WHERE auth_provider = 'clerk' AND auth_subject = ${clerkUserId}), ''), true)`,
    sql`SELECT company_id, role FROM company_memberships
        WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid`,
  ]);
  void bindSubject; void bindUser;
  const user = userRows[0];
  if (!user) return { user: null, memberships: [], company: null };
  const authorizedMemberships = memberships.map(({ company_id, role }) => ({ id: company_id, role }));
  const selectedMembership = selectAuthorizedMembership(authorizedMemberships, requestedCompanyId);
  if (selectedMembership === false) {
    return { user: { id: user.id }, memberships: authorizedMemberships, company: null, forbidden: true };
  }
  const selected = selectedMembership?.id;
  if (!selected) return { user: { id: user.id }, memberships: authorizedMemberships, company: null };
  const [setCompany, companyRows] = await sql.transaction([
    sql`SELECT set_config('app.current_clerk_subject', ${clerkUserId}, true),
               set_config('app.current_user_id', ${user.id}, true),
               set_config('app.current_company_id', ${selected}, true)`,
    sql`SELECT id, name, industry, location, website FROM companies WHERE id = ${selected}::uuid LIMIT 1`,
  ]);
  void setCompany;
  if (!companyRows[0]) return { user: { id: user.id }, memberships: authorizedMemberships, company: null, forbidden: true };
  const membership = selectedMembership || authorizedMemberships.find(({ id }) => id === selected);
  return { user: { id: user.id }, memberships: authorizedMemberships, company: { ...companyRows[0], role: membership.role } };
}
