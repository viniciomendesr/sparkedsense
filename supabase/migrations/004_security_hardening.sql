-- =====================================================
-- Migration 004: Security hardening (Supabase advisor fixes)
-- =====================================================
-- Fixes flagged by Supabase database linter:
--  - rls_disabled_in_public for devices / sensor_readings / sensor_metrics
--  - sensitive_columns_exposed for devices.mac_address
--  - security_definer_view for sensor_readings_compat
--  - function_search_path_mutable for update_updated_at_column / update_sensor_metrics
--  - rls_policy_always_true for kv_store_4a89e1c9 "Service role has full access"
--
-- Trust model preserved: edge function uses SERVICE_ROLE which bypasses RLS.
-- No anon/authenticated policies added for write access — all writes go through
-- the edge function, which is the authoritative ingestion path (ADR-002).

-- =====================================================
-- 1. devices: enable RLS + owner SELECT policy
-- =====================================================
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "devices owner select" ON public.devices;
CREATE POLICY "devices owner select" ON public.devices
  FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid());

-- Service role is bypassed automatically by RLS; no explicit policy needed.

-- =====================================================
-- 2. sensor_readings: enable RLS (no public/authenticated policies)
-- =====================================================
-- All reads/writes go through the edge function (service_role).
-- Direct PostgREST access from anon/authenticated is correctly denied.
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 3. sensor_metrics: enable RLS
-- =====================================================
ALTER TABLE public.sensor_metrics ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 4. sensor_readings_compat: recreate as SECURITY INVOKER
-- =====================================================
-- Views default to SECURITY DEFINER, which bypasses caller's RLS on the
-- underlying tables. Use security_invoker so the view respects whoever
-- is querying (service_role bypasses; others hit RLS on sensor_readings).
DROP VIEW IF EXISTS public.sensor_readings_compat;

CREATE VIEW public.sensor_readings_compat
WITH (security_invoker = true)
AS
SELECT
  (r.id::text || '-' || rec_idx)::uuid                                  AS id,
  r.device_id                                                           AS sensor_id,
  COALESCE((rec.value ->> 't')::timestamptz, r.time)                    AS timestamp,
  COALESCE(rec.value ->> 'n', 'value')                                  AS variable,
  COALESCE((rec.value ->> 'v')::numeric, 0)                             AS value,
  COALESCE(rec.value ->> 'u', '')                                       AS unit,
  true                                                                  AS verified,
  encode(digest(r.id::text || '-' || rec_idx, 'sha256'), 'hex')         AS verification_hash,
  r.signature                                                           AS signature,
  r.created_at                                                          AS created_at
FROM public.readings r
CROSS JOIN LATERAL jsonb_array_elements(r.data) WITH ORDINALITY AS rec(value, rec_idx)
WHERE r.event_type IN (
  'io.sparkedsense.sensor.environmental',
  'io.sparkedsense.sensor.generic'
)
  AND jsonb_typeof(r.data) = 'array'
  AND rec.value ? 'v';

COMMENT ON VIEW public.sensor_readings_compat IS
  'Back-compat projection of SenML environmental records into the legacy sensor_readings shape. SECURITY INVOKER — see migration 004.';

-- =====================================================
-- 5. kv_store_4a89e1c9: replace always-true policy with role-scoped
-- =====================================================
DROP POLICY IF EXISTS "Service role has full access" ON public.kv_store_4a89e1c9;
DROP POLICY IF EXISTS "Service role full access kv_store" ON public.kv_store_4a89e1c9;

CREATE POLICY "kv_store service role access" ON public.kv_store_4a89e1c9
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- The `TO service_role` role restriction limits the policy scope, resolving
-- the `rls_policy_always_true` lint while preserving edge-function access.

-- =====================================================
-- 6. Pin search_path on public functions
-- =====================================================
-- Prevents malicious schema shadowing attacks where a caller could shadow
-- `public.devices` by creating a table in a schema listed earlier in the
-- session search_path.
DO $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column') THEN
    EXECUTE 'ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_catalog';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'update_sensor_metrics') THEN
    EXECUTE 'ALTER FUNCTION public.update_sensor_metrics() SET search_path = public, pg_catalog';
  END IF;
END
$fn$;
