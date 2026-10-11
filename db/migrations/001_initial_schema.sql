-- TrendLens tenant-aware foundation. This migration creates schema only; it inserts no rows.
BEGIN;

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  industry text NOT NULL CHECK (length(btrim(industry)) > 0),
  location text,
  website text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider text NOT NULL,
  auth_subject text NOT NULL,
  email text NOT NULL CHECK (length(btrim(email)) > 0),
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  job_title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_auth_identity_unique UNIQUE (auth_provider, auth_subject)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS company_memberships (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

-- Each company can have at most one owner membership. Onboarding must create the
-- company and its owner membership together in one server-side transaction.
CREATE UNIQUE INDEX IF NOT EXISTS company_single_owner ON company_memberships(company_id) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS production_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  production_line text NOT NULL CHECK (length(btrim(production_line)) > 0),
  product text NOT NULL CHECK (length(btrim(product)) > 0),
  produced_on date NOT NULL,
  shift text,
  target_units numeric(14, 3) NOT NULL CHECK (target_units >= 0),
  actual_units numeric(14, 3) NOT NULL CHECK (actual_units >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_records_id_company_unique UNIQUE (id, company_id)
);

CREATE INDEX IF NOT EXISTS production_records_company_date_idx ON production_records(company_id, produced_on DESC);

CREATE TABLE IF NOT EXISTS downtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  production_line text NOT NULL CHECK (length(btrim(production_line)) > 0),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_minutes numeric(12, 2) NOT NULL CHECK (duration_minutes >= 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  is_planned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT downtime_event_time_order CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS downtime_events_company_started_idx ON downtime_events(company_id, started_at DESC);

CREATE TABLE IF NOT EXISTS quality_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  production_record_id uuid,
  production_line text NOT NULL CHECK (length(btrim(production_line)) > 0),
  product text NOT NULL CHECK (length(btrim(product)) > 0),
  inspected_on date NOT NULL,
  inspected_units integer NOT NULL CHECK (inspected_units >= 0),
  defect_count integer NOT NULL CHECK (defect_count >= 0 AND defect_count <= inspected_units),
  defect_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_production_same_company_fk
    FOREIGN KEY (production_record_id, company_id)
    REFERENCES production_records(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS quality_records_company_inspected_idx ON quality_records(company_id, inspected_on DESC);

-- API requests must set these transaction-local values only after verifying an
-- authenticated session and resolving the user's membership server-side.
CREATE OR REPLACE FUNCTION app_can_access_company(requested_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT requested_company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM public.company_memberships AS membership
      WHERE membership.company_id = requested_company_id
        AND membership.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    );
$$;

REVOKE ALL ON FUNCTION app_can_access_company(uuid) FROM PUBLIC;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE production_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_records FORCE ROW LEVEL SECURITY;
ALTER TABLE downtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE downtime_events FORCE ROW LEVEL SECURITY;
ALTER TABLE quality_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_records FORCE ROW LEVEL SECURITY;

CREATE POLICY companies_member_read ON companies FOR SELECT
  USING (id = NULLIF(current_setting('app.current_company_id', true), '')::uuid AND app_can_access_company(id));
CREATE POLICY users_self_read ON users FOR SELECT
  USING (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY memberships_self_read ON company_memberships FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
CREATE POLICY production_records_member_read ON production_records FOR SELECT
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid AND app_can_access_company(company_id));
CREATE POLICY downtime_events_member_read ON downtime_events FOR SELECT
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid AND app_can_access_company(company_id));
CREATE POLICY quality_records_member_read ON quality_records FOR SELECT
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid AND app_can_access_company(company_id));

COMMIT;
