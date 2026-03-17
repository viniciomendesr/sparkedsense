-- =====================================================
-- Migration 002: Fix schema gaps found during test suite
-- =====================================================
-- Issues:
--   1. kv_store_4a89e1c9 table missing (used by KV store module)
--   2. devices table missing IoT columns (challenge, nft_address, etc.)
--   3. sensor_readings missing nft_address + data columns for IoT path

-- =====================================================
-- 1. KV Store table (used by kv_store.ts)
-- =====================================================
CREATE TABLE IF NOT EXISTS kv_store_4a89e1c9 (
  key TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL
);

-- Service role needs full access
ALTER TABLE kv_store_4a89e1c9 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access kv_store" ON kv_store_4a89e1c9
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================
-- 2. Add missing IoT columns to devices table
-- =====================================================
-- challenge: temporary challenge for device registration handshake
ALTER TABLE devices ADD COLUMN IF NOT EXISTS challenge TEXT;

-- nft_address: simulated NFT identity assigned after registration
ALTER TABLE devices ADD COLUMN IF NOT EXISTS nft_address TEXT;

-- tx_signature: simulated transaction signature from registration
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tx_signature TEXT;

-- last_ts_seen: epoch seconds of last sensor-data submission (rate limiting)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_ts_seen BIGINT;

-- revoked: flag to disable a device
ALTER TABLE devices ADD COLUMN IF NOT EXISTS revoked BOOLEAN DEFAULT false;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_devices_nft_address ON devices(nft_address);

-- Drop NOT NULL on name/type so IoT registration path (which only has publicKey+macAddress) works
ALTER TABLE devices ALTER COLUMN name DROP NOT NULL;
ALTER TABLE devices ALTER COLUMN type DROP NOT NULL;

-- Make public_key unique (used as upsert conflict target in register-device)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'devices_public_key_key'
  ) THEN
    ALTER TABLE devices ADD CONSTRAINT devices_public_key_key UNIQUE (public_key);
  END IF;
END $$;

-- =====================================================
-- 3. Add IoT columns to sensor_readings
-- =====================================================
-- nft_address: links reading to device via nft identity (IoT path)
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS nft_address TEXT;

-- data: raw JSON payload from device (IoT path stores full payload here)
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS data JSONB;

-- Make sensor_id nullable so IoT path (which uses nft_address) can insert
ALTER TABLE sensor_readings ALTER COLUMN sensor_id DROP NOT NULL;
ALTER TABLE sensor_readings ALTER COLUMN variable DROP NOT NULL;
ALTER TABLE sensor_readings ALTER COLUMN value DROP NOT NULL;
ALTER TABLE sensor_readings ALTER COLUMN unit DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_readings_nft_address ON sensor_readings(nft_address);

-- Composite index for efficient readings queries: WHERE nft_address = X ORDER BY timestamp DESC LIMIT N
CREATE INDEX IF NOT EXISTS idx_sensor_readings_nft_ts ON sensor_readings(nft_address, timestamp DESC);

-- =====================================================
-- 4. WiFi geolocation columns (ADR-009)
-- =====================================================
ALTER TABLE devices ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS location_accuracy NUMERIC;

-- =====================================================
-- 5. RLS: allow IoT endpoints (anon role) to read/write devices
-- =====================================================
-- register-device and sensor-data use the service_role client,
-- so the existing "Service role full access devices" policy covers them.
-- No additional policies needed.
