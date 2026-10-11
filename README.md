# TrendLens manufacturing dashboard

## Local development

```sh
pnpm install
pnpm dev
```

Create a production bundle with `pnpm build` and run the automated checks with `pnpm test`.

With Docker installed, run `pnpm test:db` to start a loopback-only disposable PostgreSQL 16 container, apply both migrations, check role/schema/table privileges and RLS behavior, exercise transaction-local setting reset, and confirm migration 002 rolls back after a deliberate failure. The container is removed automatically. The integration check uses synthetic rows and a throwaway password; it never reads `DATABASE_URL`.

The database check deliberately demonstrates that a holder of `trendlens_app` can set the custom identity GUCs to another user's values. That is a documented trust-boundary finding, not evidence that GUC-based tenant isolation is safe. It also confirms manufacturing table access is currently blocked by missing grants.

## Vercel, Clerk, and Neon backend foundation

The Vite frontend remains a static Vite build. Vercel discovers Node.js Functions from the root `api/` directory, so this project does not need a framework migration or a custom `vercel.json` rewrite. `GET /api/health` performs a minimal database probe and returns only `connected`, `unavailable`, or `not_configured`; it never returns the connection string or raw driver error. Use Node.js 20.9 or newer for current Clerk SDK support.

### Configure credentials

1. Create a Clerk application and configure its sign-in/sign-up methods. Set the public publishable key as `VITE_CLERK_PUBLISHABLE_KEY`; this is intentionally available in the browser bundle. Set `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_AUTHORIZED_PARTIES` for the server functions. The authorized parties value is a comma-separated allowlist of exact frontend origins, including your production domain and local Vercel development origin.
2. In Neon, create separate development and production branches. Apply both SQL migrations using an administrative migration connection; never use that administrator URL as the app's `DATABASE_URL`.
3. Migration `002_clerk_authz.sql` creates the non-login, `NOINHERIT` `trendlens_app` role and fails if that role is already a member of another role. It also revokes `CREATE` on the `public` schema from `PUBLIC`. Create a separate restricted Neon runtime login with `INHERIT` and without superuser, `CREATEROLE`, or `BYPASSRLS` attributes, then grant it membership in `trendlens_app` (for example, `GRANT trendlens_app TO <runtime_login>;`). Put only that runtime login's URL in `DATABASE_URL` in Vercel. The role has permission to read the authenticated user's profile/memberships and create the first company; it has no grants on manufacturing tables. Run migrations using a separate privileged connection held only in your migration environment.
4. In Vercel Project Settings → Environment Variables, set `DATABASE_URL` and the server-only Clerk variables for the intended environments. Never prefix database or Clerk secret credentials with `VITE_`. Vite exposes `VITE_` variables to the browser. `.env.example` contains placeholders only.
5. For local Vercel Function development, copy `.env.example` to `.env.local`, replace placeholders with development values, and run `pnpm dlx vercel dev` after linking the local project with the Vercel CLI. `.env.local` is ignored by Git. The plain `pnpm dev` command runs Vite only and does not execute the `/api` functions.

Never commit `.env.local`, paste secrets into source files, or expose `DATABASE_URL` to browser code. Vercel Functions read the secret from server-side `process.env`.

### Apply the schema

Review `db/migrations/001_initial_schema.sql` and `db/migrations/002_clerk_authz.sql`, then apply them to a development Neon branch with an administrative migration connection:

```sh
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_initial_schema.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/002_clerk_authz.sql
```

Set `MIGRATION_DATABASE_URL` in your shell to the reviewed migration/admin connection before running these commands; do not store it in Vercel or commit it.

These migrations create tables, constraints, indexes, restricted role privileges, and tenant row-level security policies only. They do not insert demo or synthetic records. Run both on production only through your normal reviewed migration process. Afterward, configure the app runtime login as described above. Do not grant that login `BYPASSRLS` or superuser privileges.

### Tenant authorization boundary

Clerk is used for frontend sign-in/sign-up and authenticated-user display. `GET /api/session` verifies each request's Clerk session token, maps its verified Clerk subject to a database user, and checks `company_memberships` server-side. An optional `companyId` query parameter is only a selector: it is returned only when membership confirms access. `POST /api/onboarding/company` verifies the Clerk account's primary email with Clerk's Backend API and atomically creates the first database user, company, and owner membership. The browser submits company details only; it cannot supply a user ID, company ID, or role. One Clerk user can own at most one company in this initial onboarding model. All SQL values are parameterized.

The API sets `app.current_clerk_subject`, `app.current_user_id`, and `app.current_company_id` with transaction-local `set_config(..., true)` calls after Clerk verification and membership resolution. PostgreSQL clears these settings at transaction end, including pooled connections. RLS checks remain enabled and forced; the old SECURITY DEFINER membership helper was removed. The app role has no permissions on manufacturing tables, and there are no manufacturing-data routes. Do not grant the runtime login superuser or `BYPASSRLS`.

The database cannot independently validate a Clerk JWT. The server's database credential is therefore inside the trust boundary: a compromised server or stolen `DATABASE_URL` could set custom transaction-local settings directly. RLS and scoped grants reduce accidental exposure; they do not make a compromised API credential safe. Keep the runtime login private, rotate it if exposed, and never connect to Neon from browser code.

Self-service onboarding allows a newly authenticated user with a verified primary email to create one new company and become its first owner. It does not allow claiming an existing company. If production signup needs invitation, domain allowlisting, administrator approval, or abuse throttling, add that policy before opening signup broadly.

### Prototype settings persistence

User profile and company settings currently remain independently stored in this browser's `localStorage` under `trendlens.profile.v1` and `trendlens.company.v1`. This storage is not secure, is not sent to a server, and is not shared across users or devices. It is not an authentication mechanism. When a verified database company is loaded, its name is shown in the dashboard workspace header; other settings fields remain prototype-local until dedicated APIs are added.
