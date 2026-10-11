#!/usr/bin/env bash
set -euo pipefail

# Disposable PostgreSQL 16 migration/security checks. This uses only a local,
# throwaway container and a synthetic password. It never reads DATABASE_URL.
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for this PostgreSQL 16 integration test." >&2
  exit 2
fi

if [[ -n "${DOCKER_HOST:-}" || -n "${DOCKER_CONTEXT:-}" ]]; then
  echo "Refusing Docker override: unset DOCKER_HOST and DOCKER_CONTEXT, then select Docker Desktop." >&2
  exit 2
fi

context="$(docker context show 2>/dev/null)" || {
  echo "Cannot determine the active Docker context; refusing to start a container." >&2
  exit 2
}
if [[ "$context" != "desktop-linux" ]]; then
  echo "Docker context is '$context', not the local Docker Desktop context 'desktop-linux'." >&2
  exit 2
fi

endpoint="$(docker context inspect desktop-linux --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null)" || {
  echo "Cannot inspect the Docker Desktop endpoint; refusing to start a container." >&2
  exit 2
}
if [[ "$endpoint" != unix://* ]]; then
  echo "Docker Desktop context does not use a local Unix socket; refusing to start a container." >&2
  exit 2
fi

docker_local() { docker --context desktop-linux "$@"; }
daemon_os="$(docker_local info --format '{{.OperatingSystem}}' 2>/dev/null)" || {
  echo "Cannot verify the local Docker daemon; refusing to start a container." >&2
  exit 2
}
if [[ "$daemon_os" != "Docker Desktop" ]]; then
  echo "Docker daemon identifies as '$daemon_os', not Docker Desktop; refusing to start a container." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="trendlens-pgtest-$$-$RANDOM"
container_attempted=0
cleanup() {
  status=$?
  trap - EXIT
  if [[ "$container_attempted" == 1 ]]; then
    docker_local rm -f "$container" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# The password is disposable, exists only inside this temporary container, and
# is never printed. There are no port publications, mounts, or volumes, and the
# container has no network access.
container_attempted=1
docker_local run --rm --detach --name "$container" --network none \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=512m \
  -e POSTGRES_PASSWORD='disposable-test-only' \
  -e POSTGRES_DB=trendlens_test \
  postgres:16-alpine >/dev/null
ready=0
for _ in $(seq 1 60); do
  if docker_local exec "$container" pg_isready -U postgres -d trendlens_test >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo "Disposable PostgreSQL did not become ready." >&2
  exit 1
fi

psql_test() {
  docker_local exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres "$@"
}

echo "Applying migrations 001 and 002 to disposable PostgreSQL 16..."
psql_test -d trendlens_test < "$repo_root/db/migrations/001_initial_schema.sql" >/dev/null
psql_test -d trendlens_test < "$repo_root/db/migrations/002_clerk_authz.sql" >/dev/null

echo "Verifying schema, role attributes, privileges, and RLS behavior..."
psql_test -d trendlens_test < "$repo_root/db/tests/verify-postgres16.sql"

echo "Verifying migration 002 rolls back atomically after a deliberate failure..."
psql_test -d postgres -c 'CREATE DATABASE trendlens_rollback' >/dev/null
psql_test -d trendlens_rollback < "$repo_root/db/migrations/001_initial_schema.sql" >/dev/null
psql_test -d trendlens_rollback <<'SQL' >/dev/null
ALTER ROLE trendlens_app NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CREATE ON SCHEMA public TO PUBLIC;
CREATE FUNCTION public.trendlens_fail_after_helper_drop() RETURNS event_trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_event_trigger_dropped_objects()
    WHERE object_type = 'function'
      AND schema_name = 'public'
      AND object_identity = 'public.app_can_access_company(pg_catalog.uuid)'
  ) THEN
    RAISE EXCEPTION 'intentional test failure after helper and policy changes';
  END IF;
END
$$;
CREATE EVENT TRIGGER trendlens_test_fail_after_helper_drop
  ON sql_drop EXECUTE FUNCTION public.trendlens_fail_after_helper_drop();
SQL
if psql_test -d trendlens_rollback < "$repo_root/db/migrations/002_clerk_authz.sql" >/dev/null 2>&1; then
  echo "Expected the deliberate sql_drop failure after helper and policy changes." >&2
  exit 1
fi
psql_test -d trendlens_rollback <<'SQL' >/dev/null
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trendlens_app' AND rolinherit) THEN
    RAISE EXCEPTION 'failed migration did not roll back ALTER ROLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'production_records' AND policyname = 'production_records_member_read') THEN
    RAISE EXCEPTION 'failed migration did not preserve the original policy';
  END IF;
  IF to_regprocedure('public.app_can_access_company(uuid)') IS NULL THEN
    RAISE EXCEPTION 'failed migration did not restore the helper function';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace ns,
         LATERAL aclexplode(COALESCE(ns.nspacl, acldefault('n', ns.nspowner))) acl
    WHERE ns.nspname = 'public' AND acl.grantee = 0 AND acl.privilege_type = 'CREATE'
  ) THEN
    RAISE EXCEPTION 'failed migration did not roll back the PUBLIC schema grant change';
  END IF;
  IF has_table_privilege('trendlens_app', 'users', 'SELECT')
      OR to_regclass('public.company_owner_single_company') IS NOT NULL THEN
    RAISE EXCEPTION 'failed migration did not roll back table grants or index creation';
  END IF;
END
$$;
SQL

echo "PostgreSQL 16 disposable integration checks passed."
