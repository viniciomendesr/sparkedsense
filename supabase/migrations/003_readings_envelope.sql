-- =====================================================
-- Migration 003: Sensor-agnostic ingestion envelope (ADR-010)
-- =====================================================
-- Introduces the `readings` table, which stores CloudEvents 1.0 envelopes
-- carrying arbitrary typed payloads. The legacy `sensor_readings` table is
-- preserved; a view `sensor_readings_compat` projects SenML environmental
-- records out of `readings` so existing consumers keep working during the
-- dual-write window.
--
-- Idempotent via IF NOT EXISTS guards.

-- =====================================================
-- 1. `readings` canonical ingestion table
-- =====================================================
CREATE TABLE IF NOT EXISTS readings (
  id UUID PRIMARY KEY,

  -- CloudEvents required attributes
  spec_version TEXT NOT NULL DEFAULT '1.0',
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,                -- 'spark:device:<pubkey_hex>'
  time TIMESTAMP WITH TIME ZONE NOT NULL,
  datacontenttype TEXT NOT NULL,
  data JSONB NOT NULL,

  -- Sparked Sense extensions
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_readings_device_time ON readings (device_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_readings_type_time ON readings (event_type, time DESC);
CREATE INDEX IF NOT EXISTS idx_readings_source_time ON readings (source, time DESC);

-- Access: write via service role only (the edge function verifies signatures).
-- Public reads are mediated by dedicated endpoints.
ALTER TABLE readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "readings service role full access" ON readings;
CREATE POLICY "readings service role full access" ON readings
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "readings authenticated can read own devices" ON readings;
CREATE POLICY "readings authenticated can read own devices" ON readings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM devices d
      WHERE d.id = readings.device_id
        AND d.owner_user_id = auth.uid()
    )
  );

-- =====================================================
-- 2. Back-compat view over the legacy shape
-- =====================================================
-- Projects numeric-scalar SenML records (type=io.sparkedsense.sensor.environmental)
-- into the legacy sensor_readings columns so existing frontend code that queries
-- by variable/value/unit continues to work without a client-side migration.
--
-- Each SenML record in the `data` array becomes one row. `verification_hash`
-- is derived from the envelope `id` + record index for idempotency.
CREATE OR REPLACE VIEW sensor_readings_compat AS
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
FROM readings r
CROSS JOIN LATERAL jsonb_array_elements(r.data) WITH ORDINALITY AS rec(value, rec_idx)
WHERE r.event_type IN (
  'io.sparkedsense.sensor.environmental',
  'io.sparkedsense.sensor.generic'
)
  AND jsonb_typeof(r.data) = 'array'
  AND rec.value ? 'v';

-- `pgcrypto` supplies the digest() function used above. Safe to enable repeatedly.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

COMMENT ON TABLE readings IS
  'Canonical ingestion table for CloudEvents 1.0 envelopes carrying typed payloads. See ADR-010.';
COMMENT ON VIEW sensor_readings_compat IS
  'Back-compat projection of SenML environmental records into the legacy sensor_readings shape. Drop after frontend fully migrates to /public/readings consumption.';
