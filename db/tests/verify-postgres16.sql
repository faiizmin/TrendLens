\set ON_ERROR_STOP on

DO $$
DECLARE
  expected text[] := ARRAY['companies','users','company_memberships','production_records','downtime_events','quality_records'];
  actual text[];
  app_role oid;
  runtime_role oid;
  object_name text;
  table_name text;
  privilege_name text;
  should_have_privilege boolean;
BEGIN
  SELECT array_agg(tablename ORDER BY tablename) INTO actual
    FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY(expected);
  IF actual IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(expected) x) THEN
    RAISE EXCEPTION 'expected tables missing: %', expected;
  END IF;
  FOREACH object_name IN ARRAY ARRAY[
    'companies_member_read','companies_onboarding_returning','companies_owner_onboarding_insert',
    'users_self_read','users_clerk_onboarding_insert',
    'memberships_self_read','memberships_owner_onboarding_insert',
    'production_records_member_read','downtime_events_member_read','quality_records_member_read'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname=object_name) THEN
      RAISE EXCEPTION 'expected RLS policy is missing: %', object_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public') <> 10 THEN
    RAISE EXCEPTION 'unexpected extra or missing RLS policies';
  END IF;
  IF to_regprocedure('public.app_can_access_company(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'migration 002 should remove the obsolete helper function';
  END IF;
  FOREACH object_name IN ARRAY ARRAY[
    'companies_pkey','companies_name_check','companies_industry_check',
    'users_pkey','users_email_check','users_full_name_check','users_auth_identity_unique',
    'company_memberships_pkey','company_memberships_company_id_fkey',
    'company_memberships_user_id_fkey','company_memberships_role_check',
    'production_records_pkey','production_records_company_id_fkey',
    'production_records_production_line_check','production_records_product_check',
    'production_records_target_units_check','production_records_actual_units_check',
    'production_records_id_company_unique',
    'downtime_events_pkey','downtime_events_company_id_fkey',
    'downtime_events_production_line_check','downtime_events_duration_minutes_check',
    'downtime_events_reason_check','downtime_event_time_order',
    'quality_records_pkey','quality_records_company_id_fkey',
    'quality_records_production_line_check','quality_records_product_check',
    'quality_records_inspected_units_check','quality_records_check',
    'quality_production_same_company_fk'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname=object_name) THEN
      RAISE EXCEPTION 'expected constraint is missing: %', object_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class relation_row ON relation_row.oid = constraint_row.conrelid
    JOIN pg_namespace schema_row ON schema_row.oid = relation_row.relnamespace
    WHERE schema_row.nspname = 'public'
      AND relation_row.relname = 'quality_records'
      AND constraint_row.conname = 'quality_records_check'
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) ~* 'CHECK.*defect_count\s*>=\s*0.*defect_count\s*<=\s*inspected_units'
  ) THEN
    RAISE EXCEPTION 'quality_records_check is missing or does not enforce the defect-count rule';
  END IF;
  FOREACH object_name IN ARRAY ARRAY[
    'users_email_lower_unique','company_single_owner','company_owner_single_company'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_index idx JOIN pg_class rel ON rel.oid=idx.indexrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      WHERE ns.nspname='public' AND rel.relname=object_name AND idx.indisunique AND idx.indisvalid) THEN
      RAISE EXCEPTION 'expected unique index is missing or invalid: %', object_name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relkind='r'
      AND c.relname = ANY(expected) AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN RAISE EXCEPTION 'a table does not have enabled and forced RLS'; END IF;

  app_role := 'trendlens_app'::regrole;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid=app_role AND NOT rolcanlogin AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit) THEN
    RAISE EXCEPTION 'trendlens_app has unsafe role attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=app_role) THEN
    RAISE EXCEPTION 'trendlens_app inherits a parent role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace ns,
         LATERAL aclexplode(COALESCE(ns.nspacl, acldefault('n', ns.nspowner))) acl
    WHERE ns.nspname='public' AND acl.grantee=0 AND acl.privilege_type='CREATE'
  ) THEN RAISE EXCEPTION 'PUBLIC can create objects in public schema'; END IF;
  IF has_schema_privilege(app_role,'public','CREATE') OR NOT has_schema_privilege(app_role,'public','USAGE') THEN
    RAISE EXCEPTION 'trendlens_app schema privileges are incorrect';
  END IF;
  -- The restricted role gets only SELECT/INSERT on identity and onboarding
  -- tables, and no table privileges at all on manufacturing records.
  FOREACH table_name IN ARRAY ARRAY['users','companies','company_memberships'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      should_have_privilege := privilege_name IN ('SELECT','INSERT');
      IF has_table_privilege(app_role, table_name, privilege_name) IS DISTINCT FROM should_have_privilege THEN
        RAISE EXCEPTION 'unexpected trendlens_app % privilege on %', privilege_name, table_name;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['production_records','downtime_events','quality_records'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(app_role, table_name, privilege_name) THEN
        RAISE EXCEPTION 'trendlens_app has unintended % grant on %', privilege_name, table_name;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_class rel JOIN pg_namespace ns ON ns.oid=rel.relnamespace,
         LATERAL aclexplode(COALESCE(rel.relacl, acldefault('r', rel.relowner))) acl
    WHERE ns.nspname='public' AND rel.relname=ANY(expected) AND acl.grantee=0
  ) THEN RAISE EXCEPTION 'PUBLIC has privileges on a TrendLens table'; END IF;

  -- Model the intended separate connection login. NOINHERIT forces explicit
  -- SET ROLE, and its only membership is the dedicated application role.
  CREATE ROLE trendlens_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  GRANT trendlens_app TO trendlens_runtime;
  runtime_role := 'trendlens_runtime'::regrole;
  IF (SELECT count(*) FROM pg_auth_members WHERE member=runtime_role) <> 1
      OR NOT pg_has_role(runtime_role, app_role, 'MEMBER') THEN
    RAISE EXCEPTION 'runtime login does not have exactly the application membership';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid=runtime_role AND rolcanlogin AND NOT rolinherit
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'runtime login has administrative attributes';
  END IF;
END
$$;

INSERT INTO companies(id,name,industry) VALUES
  ('10000000-0000-0000-0000-000000000001','Synthetic A','Manufacturing'),
  ('20000000-0000-0000-0000-000000000002','Synthetic B','Manufacturing');
INSERT INTO users(id,auth_provider,auth_subject,email,full_name) VALUES
  ('10000000-0000-0000-0000-000000000001','clerk','subject-a','a@example.invalid','Synthetic A'),
  ('20000000-0000-0000-0000-000000000002','clerk','subject-b','b@example.invalid','Synthetic B');
INSERT INTO company_memberships(company_id,user_id,role) VALUES
  ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner'),
  ('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','owner');
INSERT INTO production_records(company_id,production_line,product,produced_on,target_units,actual_units)
VALUES ('10000000-0000-0000-0000-000000000001','Synthetic line','Synthetic product',current_date,1,1),
       ('20000000-0000-0000-0000-000000000002','Synthetic line','Synthetic product',current_date,1,1);

-- Change the session identity as well as current_user. The following SET ROLE
-- must now be authorized by trendlens_runtime's membership, not postgres's
-- superuser privileges.
SET SESSION AUTHORIZATION trendlens_runtime;
SET ROLE trendlens_app;
BEGIN;
SELECT set_config('app.current_clerk_subject','subject-a',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM users) <> 1 THEN RAISE EXCEPTION 'self-read policy failed'; END IF;
END $$;
COMMIT;

-- Transaction-local values must not survive commit on a reused connection.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM users) <> 0 THEN RAISE EXCEPTION 'identity context leaked to next transaction'; END IF;
END $$;
COMMIT;

-- Threat-model proof: the SQL credential itself can set an arbitrary custom
-- GUC. This is an expected demonstration of the current trust boundary, not a
-- passing authorization property. Do not use GUCs as sole tenant isolation.
BEGIN;
SELECT set_config('app.current_clerk_subject','subject-b',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM users) <> 1 THEN RAISE EXCEPTION 'unexpected: app role could not demonstrate GUC spoofability'; END IF;
END $$;
COMMIT;

-- The application role has no manufacturing grants, even with a forged tenant
-- context. Verify PostgreSQL denies the query at the ACL layer.
BEGIN;
SELECT set_config('app.current_company_id','20000000-0000-0000-0000-000000000002',true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM production_records;
    RAISE EXCEPTION 'manufacturing SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;
ROLLBACK;

RESET ROLE;
RESET SESSION AUTHORIZATION;
REVOKE trendlens_app FROM trendlens_runtime;
DROP ROLE trendlens_runtime;
