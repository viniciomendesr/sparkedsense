import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import * as kv from "./kv_store.ts";
import { crypto } from "jsr:@std/crypto@1.0.3";
import * as secp256k1 from "https://esm.sh/@noble/curves@1.4.0/secp256k1";
import { buildTree, generateProof, verifyProof, sha256Hex } from "./lib/merkle.ts";
import type { MerkleTree } from "./lib/merkle.ts";
import {
  validateEnvelopeShape,
  validateTypedPayload,
  verifyEnvelopeSignature,
  isPlatformType,
  parseSource,
  type Envelope,
} from "./lib/ingest.ts";
// Solana integration is loaded lazily inside handlers that need it — the
// @solana/web3.js bundle is too large for eager cold-start in the edge runtime.

const app = new Hono();

// Create Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "apikey", "x-client-info", "Cache-Control"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

// Explicit OPTIONS handler for preflight requests
app.options("*", (c) => {
  return c.text("", 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, Cache-Control",
    "Access-Control-Max-Age": "600",
  });
});

// Helper to generate IDs
const generateId = () => crypto.randomUUID();

// Helper to build a Merkle tree from readings (sorted by timestamp, then id)
const buildMerkleTreeFromReadings = async (readings: any[]): Promise<MerkleTree> => {
  const sorted = [...readings].sort((a, b) => {
    const dt = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (dt !== 0) return dt;
    return (a.id || '').localeCompare(b.id || '');
  });
  const hashes = sorted.map((r: any) => r.hash || '');
  return buildTree(hashes);
};

// Sensor type configs — single source of truth
const sensorTypeConfigs: Record<string, { unit: string; variable: string; dataKey: string }> = {
  temperature: { unit: '°C', variable: 'temperature', dataKey: 'temperature' },
  humidity: { unit: '%', variable: 'humidity', dataKey: 'humidity' },
  ph: { unit: 'pH', variable: 'ph_level', dataKey: 'ph_level' },
  pressure: { unit: 'hPa', variable: 'pressure', dataKey: 'pressure' },
  light: { unit: 'lux', variable: 'light_intensity', dataKey: 'light_intensity' },
  co2: { unit: 'ppm', variable: 'co2_level', dataKey: 'co2_level' },
};

// Resolve sensorId → nft_address via sensor.claimToken → devices table
const resolveNftAddress = async (sensorId: string, sensor: any): Promise<string | null> => {
  if (!sensor?.claimToken) return null;
  const { data: device } = await supabase
    .from('devices')
    .select('nft_address')
    .eq('claim_token', sensor.claimToken)
    .single();
  return device?.nft_address || null;
};

// ADR-014: resolve sensor (mode=unverified) → devices.id via devicePublicKey.
// Unverified sensors don't have a claim_token (mint hasn't happened), so we
// match on the raw pubkey the frontend stored when calling register-device Step 1.
const resolveDeviceIdForUnverified = async (sensor: any): Promise<string | null> => {
  if (!sensor?.devicePublicKey) return null;
  const { data: device } = await supabase
    .from('devices')
    .select('id')
    .eq('public_key', sensor.devicePublicKey)
    .maybeSingle();
  return device?.id ?? null;
};

// Map a row from the canonical `readings` table (ADR-010 envelope storage) to the
// flat reading shape the frontend renders. Handles the two envelope families:
//   - io.sparkedsense.inference.classification: { class, confidence, model_id }
//   - io.sparkedsense.sensor.environmental / .generic: SenML array [{ n, v, u }]
// Anything else falls through with a best-effort mapping.
//
// `hash` is a deterministic SHA-256 of the flat projection (sensorId + timestamp
// + variable + value + unit), matching the shape used by `pgReadingToKvFormat`
// for legacy sensor_readings rows. This is a *content* hash (tamper-evident for
// the payload between storage and display), not a signature hash — unsigned_dev
// rows still carry `verified: false` so the UI can show the attestation gap.
const envelopeRowToKvFormat = async (row: any, sensorId: string) => {
  const eventType = row.event_type as string;
  const data = row.data ?? {};
  let variable = 'value';
  let value: number = 0;
  let unit = '';

  if (eventType === 'io.sparkedsense.inference.classification') {
    // confidence ∈ [0, 1]; surface it as-is and carry the predicted class label
    // into `variable` so the dashboard displays the inference outcome.
    variable = typeof data.class === 'string' ? data.class : 'class';
    value = typeof data.confidence === 'number' ? data.confidence : 0;
    unit = '';
  } else if (
    eventType === 'io.sparkedsense.sensor.environmental' ||
    eventType === 'io.sparkedsense.sensor.generic'
  ) {
    const records = Array.isArray(data) ? data : [];
    const first = records[0] as Record<string, unknown> | undefined;
    if (first) {
      variable = (first.n as string) ?? 'value';
      value = typeof first.v === 'number' ? (first.v as number) : 0;
      unit = (first.u as string) ?? '';
    }
  }

  const timestamp = row.time;
  const canonical = JSON.stringify({ sensorId, timestamp, variable, value, unit });
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hash = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    id: row.id,
    sensorId,
    timestamp,
    variable,
    value,
    unit,
    // unsigned_dev rows are explicitly unverified; any other signature value is a
    // real secp256k1 signature that the /server/reading handler already verified.
    verified: row.signature !== 'unsigned_dev',
    hash,
    signature: row.signature as string,
  };
};

// Map a PG sensor_readings row to the KV reading format expected by frontend
const pgReadingToKvFormat = async (pgRow: any, sensorId: string, sensorType: string) => {
  const config = sensorTypeConfigs[sensorType] || sensorTypeConfigs.temperature;
  const value = pgRow.data?.[config.dataKey] ?? pgRow.data?.temperature ?? 0;
  const timestamp = pgRow.timestamp;

  // Compute hash to match KV format (deterministic)
  const readingData = JSON.stringify({ sensorId, timestamp, value, unit: config.unit });
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(readingData));
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    id: pgRow.id,
    sensorId,
    timestamp,
    variable: config.variable,
    value,
    unit: config.unit,
    verified: true,
    hash,
    signature: '',
  };
};

// Fetch readings — dispatches to PG for real sensors, KV for mock sensors
const getSensorReadings = async (
  sensorId: string,
  sensor: any,
  options?: { limit?: number; since?: Date; until?: Date }
): Promise<any[]> => {
  // Mock sensors: always read from KV (no nft_address)
  if (sensor?.mode === 'mock') {
    const allReadings = await kv.getByPrefix(`reading:${sensorId}:`);
    allReadings.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const globalTotal = allReadings.length;
    let readings = allReadings;
    if (options?.since) readings = readings.filter((r: any) => new Date(r.timestamp) >= options.since!);
    if (options?.until) readings = readings.filter((r: any) => new Date(r.timestamp) <= options.until!);
    if (options?.limit) readings = readings.slice(0, options.limit);
    // Attach global sequence based on position in the unfiltered DESC list.
    return readings.map((r: any) => {
      const fullIdx = allReadings.findIndex((x: any) => x.id === r.id);
      return { ...r, sequence: globalTotal - fullIdx };
    });
  }

  // ADR-014: unverified sensors live in the `readings` table (ADR-010 envelopes),
  // keyed by device_id not nft_address. Resolve via devicePublicKey and query.
  if (sensor?.mode === 'unverified') {
    const deviceId = await resolveDeviceIdForUnverified(sensor);
    if (!deviceId) return [];

    let q = supabase
      .from('readings')
      .select('id, time, event_type, data, signature')
      .eq('device_id', deviceId)
      .order('time', { ascending: false });
    if (options?.since) q = q.gte('time', options.since.toISOString());
    if (options?.until) q = q.lte('time', options.until.toISOString());
    if (options?.limit) q = q.limit(options.limit);

    // Global total (unfiltered) — used to assign a monotonic `sequence` field
    // so the UI can render the reading's position in the sensor's full history
    // ("#1234 of 1234"), not just its position within the visible slice.
    const globalCountQ = supabase
      .from('readings')
      .select('id', { count: 'exact', head: true })
      .eq('device_id', deviceId);

    const [rowsRes, countRes] = await Promise.all([q, globalCountQ]);
    const { data: rows, error } = rowsRes;
    if (error) {
      console.error('getSensorReadings (unsigned_dev) error:', error.message);
      return [];
    }
    const globalTotal = countRes.count ?? (rows?.length ?? 0);
    const mapped = await Promise.all((rows ?? []).map(r => envelopeRowToKvFormat(r, sensorId)));
    // rows are DESC by time → rows[0] is globally newest → sequence = globalTotal.
    // This assumes the visible slice is a prefix of the full DESC list (true for
    // "latest N" and "since=1h-ago" queries — the only shapes the UI emits).
    return mapped.map((reading, i) => ({ ...reading, sequence: globalTotal - i }));
  }

  // Real sensors: union of legacy `sensor_readings` (keyed by nft_address,
  // ADR-003 transport) and ADR-010 envelope `readings` (keyed by device_id).
  // Per ADR-015 §"Migration plan" step 2, the real-mode reader unions both
  // tables during the transition window so that:
  //   - sensors with only legacy rows keep working (Node #1 pre-firmware-update),
  //   - sensors that have already switched firmware to envelopes surface their data,
  //   - sensors created as `mode: "real"` whose firmware actually publishes
  //     envelopes (e.g. Node #2 acoustic) are not silently empty.
  //
  // top-N-DESC(A ∪ B) = top-N-DESC(top-N-DESC(A) ∪ top-N-DESC(B)), so fetching
  // the latest N from each side and merging is equivalent to the latest N of
  // the union — at twice the bandwidth in the worst case but without a JOIN we
  // don't have on PostgREST.
  const nftAddress = await resolveNftAddress(sensorId, sensor);
  let deviceId: string | null = null;
  if (sensor?.claimToken) {
    const { data } = await supabase
      .from('devices')
      .select('id')
      .eq('claim_token', sensor.claimToken)
      .maybeSingle();
    deviceId = data?.id ?? null;
  }

  if (!nftAddress && !deviceId) {
    // No linked device — fallback to KV (covers fixtures from before device linking)
    let readings = await kv.getByPrefix(`reading:${sensorId}:`);
    if (options?.since) readings = readings.filter((r: any) => new Date(r.timestamp) >= options.since!);
    if (options?.until) readings = readings.filter((r: any) => new Date(r.timestamp) <= options.until!);
    readings.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (options?.limit) readings = readings.slice(0, options.limit);
    return readings;
  }

  const PAGE_SIZE = 1000;
  const target = options?.limit ?? PAGE_SIZE;

  // Legacy side: Supabase PostgREST caps each response at 1000 rows. We page
  // via .range() in parallel, which is ~10–15x faster than serial when the
  // caller asks for a lot (e.g. historical chart asking for 50k) and avoids
  // hitting HTTP 546 WORKER_RESOURCE_LIMIT on the free tier. Past ~50k rows
  // the real fix is LTTB downsampling, not more paging.
  const fetchLegacy = async (): Promise<{ rows: any[]; total: number }> => {
    if (!nftAddress) return { rows: [], total: 0 };

    let countQ = supabase
      .from('sensor_readings')
      .select('id', { count: 'exact', head: true })
      .eq('nft_address', nftAddress);
    if (options?.since) countQ = countQ.gte('timestamp', options.since.toISOString());
    if (options?.until) countQ = countQ.lte('timestamp', options.until.toISOString());

    const globalCountQ = supabase
      .from('sensor_readings')
      .select('id', { count: 'exact', head: true })
      .eq('nft_address', nftAddress);

    const [windowedRes, globalRes] = await Promise.all([countQ, globalCountQ]);
    if (windowedRes.error) {
      console.error('getSensorReadings legacy count error:', windowedRes.error.message);
      return { rows: [], total: globalRes.count ?? 0 };
    }
    const totalAvailable = windowedRes.count ?? 0;
    const totalToFetch = Math.min(totalAvailable, target);
    const globalTotal = globalRes.count ?? totalAvailable;
    if (totalToFetch === 0) return { rows: [], total: globalTotal };

    const numPages = Math.ceil(totalToFetch / PAGE_SIZE);
    const pagePromises = Array.from({ length: numPages }, (_, i) => {
      const offset = i * PAGE_SIZE;
      const endInclusive = Math.min(offset + PAGE_SIZE, totalToFetch) - 1;
      let pq = supabase
        .from('sensor_readings')
        .select('id, timestamp, data')
        .eq('nft_address', nftAddress)
        .order('timestamp', { ascending: false })
        .range(offset, endInclusive);
      if (options?.since) pq = pq.gte('timestamp', options.since.toISOString());
      if (options?.until) pq = pq.lte('timestamp', options.until.toISOString());
      return pq;
    });
    const pageResults = await Promise.all(pagePromises);
    const rows: any[] = [];
    for (const { data, error } of pageResults) {
      if (error) {
        console.error('getSensorReadings legacy page error:', error.message);
        continue;
      }
      if (data) rows.push(...data);
    }
    const sensorType = sensor?.type || 'temperature';
    const mapped = await Promise.all(rows.map(r => pgReadingToKvFormat(r, sensorId, sensorType)));
    return { rows: mapped, total: globalTotal };
  };

  // Envelope side: same shape as the unverified branch above. Single non-paged
  // query capped at `target`; PostgREST's 1000-row default applies if target
  // exceeds it. Acceptable because the union is dominated by the legacy side
  // for sensors created before ADR-015 cutover, and post-cutover historical
  // depth grows linearly with time so 1000 rows = ~16h at 1Hz, enough for
  // typical chart windows.
  const fetchEnvelopes = async (): Promise<{ rows: any[]; total: number }> => {
    if (!deviceId) return { rows: [], total: 0 };

    let q = supabase
      .from('readings')
      .select('id, time, event_type, data, signature')
      .eq('device_id', deviceId)
      .order('time', { ascending: false })
      .limit(target);
    if (options?.since) q = q.gte('time', options.since.toISOString());
    if (options?.until) q = q.lte('time', options.until.toISOString());

    const globalCountQ = supabase
      .from('readings')
      .select('id', { count: 'exact', head: true })
      .eq('device_id', deviceId);

    const [rowsRes, countRes] = await Promise.all([q, globalCountQ]);
    if (rowsRes.error) {
      console.error('getSensorReadings envelope error:', rowsRes.error.message);
      return { rows: [], total: countRes.count ?? 0 };
    }
    const mapped = await Promise.all((rowsRes.data ?? []).map(r => envelopeRowToKvFormat(r, sensorId)));
    return { rows: mapped, total: countRes.count ?? mapped.length };
  };

  const [legacy, envelope] = await Promise.all([fetchLegacy(), fetchEnvelopes()]);

  // Merge DESC by timestamp and slice to limit. globalTotal feeds the
  // per-reading `sequence` field — same prefix-of-DESC-list assumption as the
  // unverified branch, valid here too because we fetch latest N from each side.
  const merged = [...legacy.rows, ...envelope.rows].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const sliced = options?.limit ? merged.slice(0, options.limit) : merged;
  const globalTotal = legacy.total + envelope.total;
  return sliced.map((reading, i) => ({ ...reading, sequence: globalTotal - i }));
};

// Count readings efficiently via PG (avoids fetching all rows)
const countSensorReadings = async (
  sensorId: string,
  sensor: any,
  options?: { since?: Date; until?: Date },
): Promise<number> => {
  if (sensor?.mode === 'mock') {
    let readings = await kv.getByPrefix(`reading:${sensorId}:`);
    if (options?.since) readings = readings.filter((r: any) => new Date(r.timestamp) >= options.since!);
    if (options?.until) readings = readings.filter((r: any) => new Date(r.timestamp) <= options.until!);
    return readings.length;
  }
  // ADR-014: unverified → count rows in `readings` table by device_id.
  if (sensor?.mode === 'unverified') {
    const deviceId = await resolveDeviceIdForUnverified(sensor);
    if (!deviceId) return 0;
    let q = supabase
      .from('readings')
      .select('id', { count: 'exact', head: true })
      .eq('device_id', deviceId);
    if (options?.since) q = q.gte('time', options.since.toISOString());
    if (options?.until) q = q.lte('time', options.until.toISOString());
    const { count, error } = await q;
    if (error) return 0;
    return count ?? 0;
  }
  // Real sensors: union count of legacy `sensor_readings` (by nft_address)
  // and ADR-010 envelope `readings` (by device_id). Mirrors getSensorReadings
  // real-mode dispatch per ADR-015 step 2 — without this, public sensor pages
  // for envelope-publishing sensors show totalReadingsCount=0.
  const nftAddress = await resolveNftAddress(sensorId, sensor);
  let deviceId: string | null = null;
  if (sensor?.claimToken) {
    const { data } = await supabase
      .from('devices')
      .select('id')
      .eq('claim_token', sensor.claimToken)
      .maybeSingle();
    deviceId = data?.id ?? null;
  }

  if (!nftAddress && !deviceId) {
    let readings = await kv.getByPrefix(`reading:${sensorId}:`);
    if (options?.since) readings = readings.filter((r: any) => new Date(r.timestamp) >= options.since!);
    if (options?.until) readings = readings.filter((r: any) => new Date(r.timestamp) <= options.until!);
    return readings.length;
  }

  const legacyQ = nftAddress
    ? (() => {
        let q = supabase
          .from('sensor_readings')
          .select('id', { count: 'exact', head: true })
          .eq('nft_address', nftAddress);
        if (options?.since) q = q.gte('timestamp', options.since.toISOString());
        if (options?.until) q = q.lte('timestamp', options.until.toISOString());
        return q;
      })()
    : null;

  const envelopeQ = deviceId
    ? (() => {
        let q = supabase
          .from('readings')
          .select('id', { count: 'exact', head: true })
          .eq('device_id', deviceId);
        if (options?.since) q = q.gte('time', options.since.toISOString());
        if (options?.until) q = q.lte('time', options.until.toISOString());
        return q;
      })()
    : null;

  const [legacyRes, envelopeRes] = await Promise.all([
    legacyQ ?? Promise.resolve({ count: 0, error: null }),
    envelopeQ ?? Promise.resolve({ count: 0, error: null }),
  ]);

  const legacyCount = legacyRes.error ? 0 : (legacyRes.count ?? 0);
  const envelopeCount = envelopeRes.error ? 0 : (envelopeRes.count ?? 0);
  return legacyCount + envelopeCount;
};

// Helper to generate mock readings for a sensor
const generateMockReading = async (sensor: any) => {
  const typeConfigs: Record<string, { min: number; max: number; unit: string; variable: string }> = {
    temperature: { min: 15, max: 30, unit: '°C', variable: 'temperature' },
    humidity: { min: 30, max: 80, unit: '%', variable: 'humidity' },
    ph: { min: 6.5, max: 8.5, unit: 'pH', variable: 'ph_level' },
    pressure: { min: 980, max: 1020, unit: 'hPa', variable: 'pressure' },
    light: { min: 100, max: 1000, unit: 'lux', variable: 'light_intensity' },
    co2: { min: 400, max: 1000, unit: 'ppm', variable: 'co2_level' },
  };

  const config = typeConfigs[sensor.type] || typeConfigs.temperature;
  const value = config.min + Math.random() * (config.max - config.min);
  const timestamp = new Date();
  
  const readingData = JSON.stringify({
    sensorId: sensor.id,
    timestamp: timestamp.toISOString(),
    value: parseFloat(value.toFixed(2)),
    unit: config.unit,
  });

  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(readingData));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const reading = {
    id: generateId(),
    sensorId: sensor.id,
    timestamp: timestamp.toISOString(),
    variable: config.variable,
    value: parseFloat(value.toFixed(2)),
    unit: config.unit,
    verified: true,
    hash,
    signature: `mock_sig_${hash.substring(0, 16)}`,
  };

  await kv.set(`reading:${sensor.id}:${reading.id}`, reading);
  return reading;
};

// Helper to get user from token
const getUserFromToken = async (request: Request) => {
  const accessToken = request.headers.get('Authorization')?.split(' ')[1];
  if (!accessToken || accessToken === Deno.env.get('SUPABASE_ANON_KEY')) {
    return null;
  }
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) {
    return null;
  }
  return user;
};

// Health check endpoint
app.get("/server/health", (c) => {
  return c.json({ status: "ok" });
});

// ======================
// Authentication Routes
// ======================

app.post("/server/auth/signup", async (c) => {
  try {
    const { email, password, name } = await c.req.json();
    
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      // Automatically confirm the user's email since an email server hasn't been configured.
      email_confirm: true,
    });

    if (error) {
      console.error('Sign up error:', error);
      
      // Check if user already exists
      if (error.message.includes('already been registered') || error.status === 422) {
        return c.json({ 
          error: 'This email is already registered. Please sign in instead.' 
        }, 409);
      }
      
      return c.json({ error: error.message }, 400);
    }

    return c.json({ user: data.user });
  } catch (error) {
    console.error('Sign up error:', error);
    return c.json({ error: 'Sign up failed' }, 500);
  }
});

app.post("/server/auth/signin", async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    const client = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Sign in error:', error);
      return c.json({ error: error.message }, 400);
    }

    return c.json({ 
      accessToken: data.session?.access_token,
      user: data.user 
    });
  } catch (error) {
    console.error('Sign in error:', error);
    return c.json({ error: 'Sign in failed' }, 500);
  }
});

app.post("/server/auth/signout", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const client = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );

    await client.auth.admin.signOut(accessToken ?? '');
    return c.json({ success: true });
  } catch (error) {
    console.error('Sign out error:', error);
    return c.json({ error: 'Sign out failed' }, 500);
  }
});

app.get("/server/auth/session", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ session: null });
    }
    return c.json({ session: { user } });
  } catch (error) {
    console.error('Session check error:', error);
    return c.json({ session: null });
  }
});

// ======================
// Sensor Routes
// ======================

// Generate claim token
app.post("/server/sensors/generate-claim-token", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Generate a cryptographically secure claim token
    const tokenBytes = new Uint8Array(16);
    crypto.getRandomValues(tokenBytes);
    const claimToken = `CLAIM_${Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

    return c.json({ claimToken });
  } catch (error) {
    console.error('Failed to generate claim token:', error);
    return c.json({ error: 'Failed to generate claim token' }, 500);
  }
});

// Retrieve claim token (mocked for now)
app.post("/server/sensors/retrieve-claim-token", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { wallet_public_key, mac_address, device_public_key } = body;

    // Validate inputs
    if (!wallet_public_key || !mac_address || !device_public_key) {
      return c.json({ error: 'Missing wallet_public_key, mac_address, or device_public_key' }, 400);
    }

    // Validate Solana public key format (base58, 32-44 chars)
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!base58Regex.test(wallet_public_key)) {
      return c.json({ error: 'Invalid Solana wallet public key format' }, 400);
    }

    // Validate Device public key format (base58, 32-44 chars)
    if (!base58Regex.test(device_public_key)) {
      return c.json({ error: 'Invalid device public key format' }, 400);
    }

    // Validate MAC address format
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (!macRegex.test(mac_address)) {
      return c.json({ error: 'Invalid MAC address format' }, 400);
    }

    // For now, generate a mocked claim token
    // In a real implementation, this would query a database or blockchain
    // to retrieve an existing token associated with this wallet, device key, and MAC address
    const tokenBytes = new Uint8Array(16);
    crypto.getRandomValues(tokenBytes);
    const claim_token = `SPARKED-${Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().substring(0, 12)}`;

    return c.json({ claim_token });
  } catch (error) {
    console.error('Failed to retrieve claim token:', error);
    return c.json({ error: 'Failed to retrieve claim token' }, 500);
  }
});

app.get("/server/sensors", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sensors = await kv.getByPrefix(`sensor:${user.id}:`);
    return c.json({ sensors: sensors || [] });
  } catch (error) {
    console.error('Failed to fetch sensors:', error);
    return c.json({ error: 'Failed to fetch sensors' }, 500);
  }
});

app.get("/server/sensors/:id", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const sensor = await kv.get(`sensor:${user.id}:${id}`);
    
    if (!sensor) {
      return c.json({ error: 'Sensor not found' }, 404);
    }

    // Calculate hourly Merkle root
    const readings = await getSensorReadings(id, sensor);
    let hourlyMerkleRoot = null;
    let totalVerified = 0;

    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const lastHourReadings = readings.filter((r: any) => new Date(r.timestamp) >= oneHourAgo);
      const tree = await buildMerkleTreeFromReadings(lastHourReadings);
      hourlyMerkleRoot = tree.root;
    } catch (merkleError) {
      console.error('Failed to compute Merkle root for sensor:', id, merkleError);
    }

    try {
      // Calculate total verified (sum of dataset accesses + sensor views)
      const datasets = await kv.getByPrefix(`dataset:${id}:`);
      totalVerified = datasets.reduce((sum: number, d: any) => sum + (d.accessCount || 0), 0) + 1;
    } catch (datasetError) {
      console.error('Failed to compute datasets for sensor:', id, datasetError);
    }

    const totalReadingsCount = await countSensorReadings(id, sensor);

    return c.json({
      sensor: {
        ...sensor,
        hourlyMerkleRoot,
        totalVerified,
        totalReadingsCount,
        totalDataBytes: totalReadingsCount * AVG_READING_BYTES,
      }
    });
  } catch (error) {
    console.error('Failed to fetch sensor:', error);
    return c.json({ error: 'Failed to fetch sensor' }, 500);
  }
});

// Get hourly Merkle root for a sensor
app.get("/server/sensors/:id/hourly-merkle", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sensor = await kv.get(`sensor:${user.id}:${id}`);
    const lastHourReadings = await getSensorReadings(id, sensor, { since: oneHourAgo });
    const tree = await buildMerkleTreeFromReadings(lastHourReadings);

    return c.json({
      merkleRoot: tree.root,
      leafCount: tree.leafCount,
      leaves: tree.leaves,
      readingsCount: lastHourReadings.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to calculate hourly Merkle root:', error);
    return c.json({ error: 'Failed to calculate hourly Merkle root' }, 500);
  }
});

app.post("/server/sensors", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { name, type, description, visibility, mode, claimToken, walletPublicKey, devicePublicKey } = await c.req.json();

    const resolvedMode = mode || 'real';
    const VALID_MODES = ['real', 'mock', 'unverified'] as const;
    if (!VALID_MODES.includes(resolvedMode)) {
      return c.json({ error: `Invalid mode: ${resolvedMode}. Expected one of ${VALID_MODES.join(', ')}` }, 400);
    }

    // ADR-014: unverified sensors skip challenge-response and NFT mint at create
    // time. The caller must have already registered the device via Step 1 of
    // /server/register-device, so a row in `devices` exists for devicePublicKey.
    // Mint can be triggered later via POST /server/sensors/:id/mint.
    if (resolvedMode === 'unverified' && !devicePublicKey) {
      return c.json({ error: 'devicePublicKey is required for unverified mode' }, 400);
    }

    const id = generateId();

    // Real sensors get a claim token to link to their NFT-minted device.
    // Mock sensors get a generated token for internal consistency.
    // Unverified sensors have no claim token until mint completes.
    const finalClaimToken = resolvedMode === 'unverified' ? null : (claimToken || generateId());

    const sensor = {
      id,
      name,
      type,
      description,
      visibility,
      mode: resolvedMode,
      status: resolvedMode === 'mock' ? 'active' : 'inactive', // Mock is immediately active; real/unverified activate on first POST
      owner: user.id,
      claimToken: finalClaimToken,
      walletPublicKey: walletPublicKey || null,
      devicePublicKey: resolvedMode === 'unverified' ? devicePublicKey : (devicePublicKey || null),
      thumbnailUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`sensor:${user.id}:${id}`, sensor);

    if (resolvedMode === 'mock') {
      console.log(`Initializing mock sensor ${id} with sample readings`);
    }

    if (resolvedMode === 'unverified') {
      // ADR-014 audit trail: explains why this sensor lacks NFT/claim_token at creation.
      console.warn(`🔓 Created sensor ${id} in unverified mode (ADR-014) — device ${devicePublicKey.substring(0, 16)}... publishes real data; mint deferred. No NFT yet.`);
    } else {
      console.log(`Created sensor ${id} (mode: ${resolvedMode}, wallet: ${walletPublicKey ? 'linked' : 'none'})`);
    }

    return c.json({ sensor });
  } catch (error) {
    console.error('Failed to create sensor:', error);
    return c.json({ error: 'Failed to create sensor' }, 500);
  }
});

// Average on-disk size of a single reading record (JSON payload + KV key + signature).
// Used to approximate the human-readable "stored" metric.
const AVG_READING_BYTES = 206;

// Build a human-readable location string from a Nominatim reverse-geocode result.
// Prioritizes neighborhood/suburb (bairro) so the label is more specific than just the city.
// Falls back to raw coordinates if nothing usable is returned.
const buildLocationText = (
  address: { displayName?: string; address?: Record<string, string> } | undefined,
  latitude: number,
  longitude: number,
): string => {
  const addr = address?.address;
  if (!addr) return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

  const neighborhood =
    addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || addr.residential;
  const city = addr.city || addr.town || addr.village || addr.municipality;

  const parts: string[] = [];
  if (neighborhood) parts.push(neighborhood);
  // Only add city if it's different from the neighborhood (dense rural areas can collide)
  if (city && city !== neighborhood) parts.push(city);
  if (addr.state) parts.push(addr.state);
  if (addr.country) parts.push(addr.country);

  if (parts.length > 0) return parts.join(', ');
  return address?.displayName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
};

// Fields a user may change via PUT /sensors/:id for `real` sensors.
// location/latitude/longitude/locationAccuracy come from the device firmware and
// must never be mutable by the user — changing them would break the DePIN trust model.
const USER_EDITABLE_SENSOR_FIELDS = ['name', 'description', 'visibility'] as const;

// ADR-014: unverified sensors don't have signed geolocation yet (mint hasn't
// happened, firmware may not even publish signed events). Until mint, the user
// manually sets the sensor's location so the card/audit surface isn't blank.
// After mint, location becomes firmware-attested and this editability is removed
// (the gating is by mode === 'unverified', not a per-sensor flag).
const UNVERIFIED_EXTRA_EDITABLE_FIELDS = [
  'location',
  'latitude',
  'longitude',
  'locationAccuracy',
] as const;

app.put("/server/sensors/:id", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const body = await c.req.json();

    const existingForMode = await kv.get(`sensor:${user.id}:${id}`);
    const editable: readonly string[] = existingForMode?.mode === 'unverified'
      ? [...USER_EDITABLE_SENSOR_FIELDS, ...UNVERIFIED_EXTRA_EDITABLE_FIELDS]
      : USER_EDITABLE_SENSOR_FIELDS;

    if (!existingForMode) {
      return c.json({ error: 'Sensor not found' }, 404);
    }

    const updates: Record<string, unknown> = {};
    for (const key of editable) {
      if (key in body) updates[key] = body[key];
    }

    const sensor = {
      ...existingForMode,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`sensor:${user.id}:${id}`, sensor);

    return c.json({ sensor });
  } catch (error) {
    console.error('Failed to update sensor:', error);
    return c.json({ error: 'Failed to update sensor' }, 500);
  }
});

// ADR-014: deferred mint endpoint. Owner-only. Server wallet pays mint cost
// (devnet today; mainnet revisits this — see ADR-014 open questions).
//
// Mint flow today is the same simulated pattern as Step 2 of /server/register-device:
// random nft_address + claim_token + tx_signature placeholder. When real on-chain
// minting lands (Metaplex-capable runtime), this endpoint becomes the single seam
// where that change is implemented.
//
// Trust-model note: this mint does NOT prove the device physically possesses
// the private key (no challenge-response). The trust still flows from per-event
// signature verification at /server/reading. The mint is the on-chain anchor of
// sensor identity; events that arrive without signatures continue to be flagged
// as unverified per ADR-011 even after mint.
// ADR-014/ADR-016: rotate the device public key bound to a sensor. Owner-only.
//
// Why this exists: the Node 2 sensor was registered with a placeholder pubkey
// at demo time (no real private key existed on the device). After mint, the
// firmware needs to produce real signatures, but it can't sign for a pubkey
// it doesn't own. This endpoint rewrites devices.public_key + sensor.devicePublicKey
// in one atomic-ish operation, preserving nft_address / claim_token / device_id
// (so historical readings stay linked through device_id).
//
// Trust-model note: rotating a key invalidates the bond between past readings
// (signed by the OLD key) and the new identity. Audit consumers should see
// `pubkeyRotatedAt` and treat events from before that timestamp as a separate
// trust epoch. The endpoint records the timestamp on both the device row
// (rotated_at column if present, or commented out below) and on the sensor.
app.post("/server/sensors/:id/rotate-pubkey", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const { newPublicKey, newMacAddress } = await c.req.json();

    if (!newPublicKey || typeof newPublicKey !== 'string') {
      return c.json({ error: 'newPublicKey is required (hex string)' }, 400);
    }
    if (!/^[0-9a-fA-F]+$/.test(newPublicKey)) {
      return c.json({ error: 'newPublicKey must be hex' }, 400);
    }
    // 64 = compressed (no 02/03 prefix), 66 = compressed with prefix,
    // 128 = uncompressed without 04 prefix, 130 = uncompressed with 04 prefix.
    const len = newPublicKey.length;
    if (len !== 64 && len !== 66 && len !== 128 && len !== 130) {
      return c.json({ error: `newPublicKey hex length must be 64/66/128/130 (got ${len})` }, 400);
    }
    if (newMacAddress && !/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(newMacAddress)) {
      return c.json({ error: 'newMacAddress format invalid (AA:BB:CC:DD:EE:FF)' }, 400);
    }

    const sensor = await kv.get(`sensor:${user.id}:${id}`);
    if (!sensor) {
      return c.json({ error: 'Sensor not found' }, 404);
    }

    // Resolve the current device row. Prefer devicePublicKey (unverified path);
    // fall back to claim_token (real-mode legacy linkage).
    let currentDevice: any = null;
    if (sensor.devicePublicKey) {
      const { data } = await supabase
        .from('devices')
        .select('id, public_key, nft_address, claim_token')
        .eq('public_key', sensor.devicePublicKey)
        .maybeSingle();
      if (data) currentDevice = data;
    }
    if (!currentDevice && sensor.claimToken) {
      const { data } = await supabase
        .from('devices')
        .select('id, public_key, nft_address, claim_token')
        .eq('claim_token', sensor.claimToken)
        .maybeSingle();
      if (data) currentDevice = data;
    }
    if (!currentDevice) {
      return c.json({ error: 'No device row linked to this sensor', code: 'rotate_no_device' }, 404);
    }

    if (currentDevice.public_key === newPublicKey) {
      return c.json({ error: 'newPublicKey is identical to current', code: 'rotate_noop' }, 400);
    }

    // Refuse if newPublicKey is already used by a different device (sanity).
    const { data: collision } = await supabase
      .from('devices')
      .select('id')
      .eq('public_key', newPublicKey)
      .neq('id', currentDevice.id)
      .maybeSingle();
    if (collision) {
      return c.json({
        error: 'newPublicKey is already registered by another device',
        code: 'rotate_pubkey_taken',
      }, 409);
    }

    // Update devices row in place. nft_address, claim_token, and device.id are
    // preserved → historical readings stay linked through device_id, claim_token
    // linkage in the KV mirror keeps working.
    const deviceUpdates: Record<string, unknown> = { public_key: newPublicKey };
    if (newMacAddress) deviceUpdates.mac_address = newMacAddress;
    const { error: devErr } = await supabase
      .from('devices')
      .update(deviceUpdates)
      .eq('id', currentDevice.id);
    if (devErr) {
      console.error('Rotate pubkey device update error:', devErr);
      return c.json({ error: 'DB error: ' + devErr.message, code: 'rotate_db_error' }, 500);
    }

    // Update sensor KV with new pubkey + rotation timestamp for audit.
    const updatedSensor = {
      ...sensor,
      devicePublicKey: newPublicKey,
      pubkeyRotatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`sensor:${user.id}:${id}`, updatedSensor);

    console.log(
      `🔄 Rotated pubkey for sensor ${id}: ${currentDevice.public_key.substring(0, 16)}... → ${newPublicKey.substring(0, 16)}...`,
    );

    return c.json({ sensor: updatedSensor });
  } catch (err: any) {
    console.error('Rotate pubkey error:', err);
    return c.json({ error: err.message || 'Internal server error', code: 'rotate_internal_error' }, 500);
  }
});

app.post("/server/sensors/:id/mint", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const sensor = await kv.get(`sensor:${user.id}:${id}`);
    if (!sensor) {
      return c.json({ error: 'Sensor not found' }, 404);
    }
    if (sensor.mode !== 'unverified') {
      return c.json({
        error: `Mint only applies to unverified sensors (current mode: ${sensor.mode})`,
        code: 'mint_invalid_mode',
      }, 400);
    }
    if (!sensor.devicePublicKey) {
      return c.json({
        error: 'Sensor has no devicePublicKey — re-register before minting',
        code: 'mint_missing_pubkey',
      }, 400);
    }

    // Resolve the device row by pubkey. It must already exist (created by Step 1
    // of /server/register-device when the sensor was first registered).
    const { data: device, error: fetchError } = await supabase
      .from('devices')
      .select('*')
      .eq('public_key', sensor.devicePublicKey)
      .single();

    if (fetchError || !device) {
      return c.json({ error: 'Device row not found for this sensor', code: 'mint_device_not_found' }, 404);
    }

    // Idempotency: if device already has an nft_address, return existing identity.
    // Sensor side may still be 'unverified' if a previous mint partially failed —
    // we recover by syncing both sides.
    let nftAddress = device.nft_address as string | null;
    let claimToken = device.claim_token as string | null;
    let txSignature = device.tx_signature as string | null;

    if (!nftAddress) {
      const nftBytes = new Uint8Array(32);
      crypto.getRandomValues(nftBytes);
      nftAddress = Array.from(nftBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      const tokenBytes = new Uint8Array(16);
      crypto.getRandomValues(tokenBytes);
      claimToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      txSignature = 'devnet_sim_' + Array.from(nftBytes).slice(0, 16)
        .map(b => b.toString(16).padStart(2, '0')).join('');

      const { error: updateError } = await supabase
        .from('devices')
        .update({
          nft_address: nftAddress,
          claim_token: claimToken,
          tx_signature: txSignature,
          challenge: null,
        })
        .eq('public_key', sensor.devicePublicKey);

      if (updateError) {
        console.error('Mint device update error:', updateError);
        return c.json({ error: 'DB error: ' + updateError.message, code: 'mint_db_error' }, 500);
      }
    }

    // Promote sensor: unverified → real, persist mint metadata.
    const updatedSensor = {
      ...sensor,
      mode: 'real',
      claimToken,
      nftAddress,
      txSignature,
      mintedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`sensor:${user.id}:${id}`, updatedSensor);

    console.log(`✨ Minted sensor ${id} (ADR-014) — pubkey=${sensor.devicePublicKey.substring(0, 16)}... nft=${nftAddress.substring(0, 16)}...`);

    return c.json({ sensor: updatedSensor });
  } catch (err: any) {
    console.error('Mint error:', err);
    return c.json({ error: err.message || 'Internal server error', code: 'mint_internal_error' }, 500);
  }
});

// Re-derive the human-readable location text from the sensor's stored lat/lng.
// Useful after changing the location-text formatter (e.g., adding neighborhood) for
// sensors that already have coords ingested from firmware. Owner-only. Does NOT
// accept new coordinates from the client — the physical signal remains firmware-driven.
app.post("/server/sensors/:id/refresh-location", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const sensor = await kv.get(`sensor:${user.id}:${id}`);
    if (!sensor) {
      return c.json({ error: 'Sensor not found' }, 404);
    }
    if (sensor.latitude == null || sensor.longitude == null) {
      return c.json({ error: 'Sensor has no stored coordinates' }, 400);
    }

    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${sensor.latitude}&lon=${sensor.longitude}&zoom=18&addressdetails=1`,
      { headers: { 'User-Agent': 'sparked-sense/1.0' } },
    );
    if (!nomRes.ok) {
      return c.json({ error: 'Reverse geocoding failed' }, 502);
    }
    const nomData = await nomRes.json();
    const locationText = buildLocationText(
      { displayName: nomData.display_name, address: nomData.address },
      sensor.latitude,
      sensor.longitude,
    );

    sensor.location = locationText;
    sensor.updatedAt = new Date().toISOString();
    await kv.set(`sensor:${user.id}:${id}`, sensor);

    // Mirror to devices table so public endpoints also see the update
    if (sensor.nftAddress) {
      await supabase
        .from('devices')
        .update({ location: locationText })
        .eq('nft_address', sensor.nftAddress);
    }

    return c.json({ sensor });
  } catch (error) {
    console.error('Failed to refresh sensor location:', error);
    return c.json({ error: 'Failed to refresh location' }, 500);
  }
});

app.delete("/server/sensors/:id", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    
    // Delete the main sensor
    await kv.del(`sensor:${user.id}:${id}`);
    
    // Get all readings and datasets by prefix to find their keys
    // Note: getByPrefix returns the values, and each reading/dataset has an id field
    const readingValues = await kv.getByPrefix(`reading:${id}:`);
    const datasetValues = await kv.getByPrefix(`dataset:${id}:`);
    
    // Build the list of keys to delete
    const keysToDelete: string[] = [];
    
    // Add reading keys
    for (const reading of readingValues) {
      if (reading && reading.id) {
        keysToDelete.push(`reading:${id}:${reading.id}`);
      }
    }
    
    // Add dataset keys
    for (const dataset of datasetValues) {
      if (dataset && dataset.id) {
        keysToDelete.push(`dataset:${id}:${dataset.id}`);
      }
    }
    
    // Delete all associated readings and datasets
    if (keysToDelete.length > 0) {
      await kv.mdel(keysToDelete);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to delete sensor:', error);
    return c.json({ error: 'Failed to delete sensor', details: error.message }, 500);
  }
});

// ======================
// Reading Routes
// ======================

// Project each reading to only the fields the chart uses.
// Saves ~70% bytes when the caller only needs to render a time series.
const slimReading = (r: any) => ({ timestamp: r.timestamp, value: r.value, unit: r.unit });

app.get("/server/readings/:sensorId", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sensorId = c.req.param('sensorId');
    const limit = parseInt(c.req.query('limit') || '100');
    const slim = c.req.query('slim') === '1';

    const sensor = await kv.get(`sensor:${user.id}:${sensorId}`);
    const sortedReadings = await getSensorReadings(sensorId, sensor, { limit });

    return c.json({ readings: slim ? sortedReadings.map(slimReading) : sortedReadings });
  } catch (error) {
    console.error('Failed to fetch readings:', error);
    return c.json({ error: 'Failed to fetch readings' }, 500);
  }
});

app.get("/server/readings/:sensorId/historical", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sensorId = c.req.param('sensorId');
    const start = new Date(c.req.query('start') || '');
    const end = new Date(c.req.query('end') || '');
    
    const sensor = await kv.get(`sensor:${user.id}:${sensorId}`);
    const filteredReadings = await getSensorReadings(sensorId, sensor, { since: start, until: end });

    return c.json({ readings: filteredReadings });
  } catch (error) {
    console.error('Failed to fetch historical readings:', error);
    return c.json({ error: 'Failed to fetch historical readings' }, 500);
  }
});

app.post("/server/readings", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { sensorId, variable, value, unit, signature } = await c.req.json();
    const id = generateId();
    const timestamp = new Date().toISOString();

    // Generate hash for the reading
    const hashInput = `${sensorId}-${timestamp}-${value}-${variable}`;
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const reading = {
      id,
      sensorId,
      timestamp,
      variable,
      value,
      unit,
      verified: !!signature,
      signature,
      hash,
    };

    await kv.set(`reading:${sensorId}:${id}`, reading);
    
    // Update sensor's last reading and status
    const sensor = await kv.get(`sensor:${user.id}:${sensorId}`);
    if (sensor) {
      sensor.lastReading = reading;
      sensor.status = 'active';
      await kv.set(`sensor:${user.id}:${sensorId}`, sensor);
    }

    return c.json({ reading });
  } catch (error) {
    console.error('Failed to create reading:', error);
    return c.json({ error: 'Failed to create reading' }, 500);
  }
});

// ======================
// Dataset Routes
// ======================

app.get("/server/datasets/:sensorId", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sensorId = c.req.param('sensorId');
    const datasets = await kv.getByPrefix(`dataset:${sensorId}:`);

    // Backfill stale readingsCount: datasets created before the HEAD-count fix
    // (commit 9d1fa95) have a capped value persisted (often exactly 1000).
    // Recompute via HEAD count on read so UI always shows the true figure.
    const sensor = await kv.get(`sensor:${user.id}:${sensorId}`);
    const refreshed = await Promise.all((datasets || []).map(async (d: any) => {
      try {
        const count = await countSensorReadings(sensorId, sensor, {
          since: new Date(d.startDate),
          until: new Date(d.endDate),
        });
        if (count !== d.readingsCount) {
          const updated = { ...d, readingsCount: count };
          await kv.set(`dataset:${sensorId}:${d.id}`, updated);
          return updated;
        }
        return d;
      } catch {
        return d;
      }
    }));

    return c.json({ datasets: refreshed });
  } catch (error) {
    console.error('Failed to fetch datasets:', error);
    return c.json({ error: 'Failed to fetch datasets' }, 500);
  }
});

app.get("/server/datasets/detail/:id", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const datasets = await kv.getByPrefix(`dataset:`);
    const dataset = datasets.find((d: any) => d.id === id);
    
    if (!dataset) {
      return c.json({ error: 'Dataset not found' }, 404);
    }

    // Get preview readings from last hour within dataset period
    const allSensorsForDetail = await kv.getByPrefix('sensor:');
    const dsensor = allSensorsForDetail.find((s: any) => s.id === dataset.sensorId);
    const readings = await getSensorReadings(dataset.sensorId, dsensor);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const datasetStart = new Date(dataset.startDate);
    const datasetEnd = new Date(dataset.endDate);

    const previewReadings = readings.filter((r: any) => {
      const timestamp = new Date(r.timestamp);
      return timestamp >= oneHourAgo && timestamp >= datasetStart && timestamp <= datasetEnd;
    }).slice(0, 50); // Limit to 50 readings

    // Backfill stale readingsCount for datasets created before the HEAD-count fix.
    try {
      const trueCount = await countSensorReadings(dataset.sensorId, dsensor, {
        since: datasetStart,
        until: datasetEnd,
      });
      dataset.readingsCount = trueCount;
    } catch {
      // Keep persisted value if recount fails.
    }

    // Increment access count
    const currentAccessCount = dataset.accessCount || 0;
    dataset.accessCount = currentAccessCount + 1;
    await kv.set(`dataset:${dataset.sensorId}:${id}`, dataset);

    return c.json({
      dataset: {
        ...dataset,
        previewReadings
      }
    });
  } catch (error) {
    console.error('Failed to fetch dataset:', error);
    return c.json({ error: 'Failed to fetch dataset' }, 500);
  }
});

app.post("/server/datasets", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { name, sensorId, startDate, endDate, isPublic } = await c.req.json();
    const id = generateId();

    // Count readings in range via a HEAD count — no row fetch, no 1000-row cap.
    const sensor = await kv.get(`sensor:${user.id}:${sensorId}`);
    const start = new Date(startDate);
    const end = new Date(endDate);
    const readingsCount = await countSensorReadings(sensorId, sensor, { since: start, until: end });

    // ADR-014: capture the source sensor's attestation status at dataset creation
    // time. This is metadata only — does not block creation. For unverified
    // sensors we also break down signed vs unsigned event counts so auditors
    // know what fraction of the dataset carries cryptographic attestation.
    const mintStatus: 'real' | 'unverified' | 'mock' =
      sensor?.mode === 'unverified' ? 'unverified' : (sensor?.mode === 'mock' ? 'mock' : 'real');

    let signatureComposition: { verified: number; unsigned: number } | undefined;
    if (mintStatus === 'unverified') {
      const deviceId = await resolveDeviceIdForUnverified(sensor);
      if (deviceId) {
        const baseQ = (q: any) => {
          let qq = q.eq('device_id', deviceId);
          if (startDate) qq = qq.gte('time', new Date(startDate).toISOString());
          if (endDate) qq = qq.lte('time', new Date(endDate).toISOString());
          return qq;
        };
        const unsignedQ = baseQ(supabase.from('readings').select('id', { count: 'exact', head: true })).eq('signature', 'unsigned_dev');
        const verifiedQ = baseQ(supabase.from('readings').select('id', { count: 'exact', head: true })).neq('signature', 'unsigned_dev');
        const [{ count: unsignedCount }, { count: verifiedCount }] = await Promise.all([unsignedQ, verifiedQ]);
        signatureComposition = {
          verified: verifiedCount ?? 0,
          unsigned: unsignedCount ?? 0,
        };
      }
    }

    const dataset = {
      id,
      name,
      sensorId,
      startDate,
      endDate,
      readingsCount,
      status: 'preparing',
      isPublic: isPublic || false,
      createdAt: new Date().toISOString(),
      accessCount: 0,
      mintStatus,
      ...(signatureComposition ? { signatureComposition } : {}),
    };

    await kv.set(`dataset:${sensorId}:${id}`, dataset);
    return c.json({ dataset });
  } catch (error) {
    console.error('Failed to create dataset:', error);
    return c.json({ error: 'Failed to create dataset' }, 500);
  }
});

app.put("/server/datasets/:id", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const updates = await c.req.json();
    
    const datasets = await kv.getByPrefix(`dataset:`);
    const dataset = datasets.find((d: any) => d.id === id);
    
    if (!dataset) {
      return c.json({ error: 'Dataset not found' }, 404);
    }

    const updatedDataset = { ...dataset, ...updates };
    await kv.set(`dataset:${dataset.sensorId}:${id}`, updatedDataset);
    
    return c.json({ dataset: updatedDataset });
  } catch (error) {
    console.error('Failed to update dataset:', error);
    return c.json({ error: 'Failed to update dataset' }, 500);
  }
});

app.post("/server/datasets/:id/anchor", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const datasets = await kv.getByPrefix(`dataset:`);
    const dataset = datasets.find((d: any) => d.id === id);

    if (!dataset) {
      return c.json({ error: 'Dataset not found' }, 404);
    }

    // Ownership check: only the sensor's owner can anchor / re-anchor.
    const ownSensor = await kv.get(`sensor:${user.id}:${dataset.sensorId}`);
    if (!ownSensor) {
      return c.json({ error: 'Forbidden: you do not own this sensor' }, 403);
    }

    const start = new Date(dataset.startDate);
    const end = new Date(dataset.endDate);

    // Optional pre-computed path: the client sends a Merkle root it already
    // built from the public export. This avoids WORKER_RESOURCE_LIMIT when
    // hashing tens of thousands of readings server-side on the free tier.
    // The root the client sends must be reproducible from the export spec,
    // so it's not a trust issue — anyone else can verify it the same way.
    let clientRoot: string | undefined;
    let clientReadingsCount: number | undefined;
    try {
      const body = await c.req.json();
      if (body && typeof body === 'object') {
        if (typeof body.merkleRoot === 'string' && /^[0-9a-f]{64}$/.test(body.merkleRoot)) {
          clientRoot = body.merkleRoot;
        }
        if (typeof body.readingsCount === 'number' && body.readingsCount > 0) {
          clientReadingsCount = body.readingsCount;
        }
      }
    } catch {
      // empty body — fall back to server-side computation
    }

    let merkleRoot: string;
    let anchoredCount: number;

    if (clientRoot && clientReadingsCount) {
      merkleRoot = clientRoot;
      anchoredCount = clientReadingsCount;
    } else {
      // Fallback: fetch + hash + build tree server-side. Works for small datasets
      // but hits WORKER_RESOURCE_LIMIT past ~5-10k readings on the free tier.
      const allSensorsForAnchor = await kv.getByPrefix('sensor:');
      const anchorSensor = allSensorsForAnchor.find((s: any) => s.id === dataset.sensorId);
      const readingsInRange = await getSensorReadings(dataset.sensorId, anchorSensor, { since: start, until: end, limit: Number.MAX_SAFE_INTEGER });
      const tree = await buildMerkleTreeFromReadings(readingsInRange);
      merkleRoot = tree.root;
      anchoredCount = readingsInRange.length;
    }

    dataset.status = 'anchoring';
    dataset.merkleRoot = merkleRoot;
    dataset.readingsCount = anchoredCount;
    dataset.accessCount = dataset.accessCount || 0;
    await kv.set(`dataset:${dataset.sensorId}:${id}`, dataset);

    // ADR-007 partial: real Solana Memo Program anchoring when the server
    // keypair is configured. Lazy import — @solana/web3.js is too heavy to load
    // on every edge-function cold start; keep it scoped to this handler only.
    if (Deno.env.get("SOLANA_SERVER_SECRET_KEY_BASE58")) {
      try {
        const { anchorMerkleRoot } = await import("./lib/solana.ts");
        const result = await anchorMerkleRoot({
          datasetId: id,
          merkleRoot,
          readingsCount: anchoredCount,
          startISO: start.toISOString(),
          endISO: end.toISOString(),
        });
        dataset.status = 'anchored';
        dataset.transactionId = result.signature;
        dataset.anchorTxSignature = result.signature;
        dataset.anchorExplorerUrl = result.explorerUrl;
        dataset.anchorCluster = result.cluster;
        dataset.anchorMemo = result.memo;
        dataset.anchoredAt = new Date().toISOString();
        await kv.set(`dataset:${dataset.sensorId}:${id}`, dataset);
        return c.json({ dataset });
      } catch (anchorErr: any) {
        console.error('Solana anchoring failed — falling back to simulated:', anchorErr.message);
        // Fall through to simulated flow so the dataset still publishes;
        // the UI surfaces the lack of an anchor tx when anchorExplorerUrl is null.
      }
    }

    // Legacy simulated flow — kept for environments without a Solana wallet
    // configured and as a safety net for transient RPC failures.
    const transactionId = generateId().replace(/-/g, '');
    dataset.transactionId = transactionId;
    await kv.set(`dataset:${dataset.sensorId}:${id}`, dataset);
    setTimeout(async () => {
      dataset.status = 'anchored';
      await kv.set(`dataset:${dataset.sensorId}:${id}`, dataset);
    }, 3000);

    return c.json({ dataset });
  } catch (error) {
    console.error('Failed to anchor dataset:', error);
    return c.json({ error: 'Failed to anchor dataset' }, 500);
  }
});

// Increment dataset access count
app.post("/server/datasets/:id/access", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const datasets = await kv.getByPrefix(`dataset:`);
    const dataset = datasets.find((d: any) => d.id === id);
    
    if (!dataset) {
      return c.json({ error: 'Dataset not found' }, 404);
    }

    dataset.accessCount = (dataset.accessCount || 0) + 1;
    await kv.set(`dataset:${dataset.sensorId}:${id}`, dataset);

    return c.json({ success: true, accessCount: dataset.accessCount });
  } catch (error) {
    console.error('Failed to increment access count:', error);
    return c.json({ error: 'Failed to increment access count' }, 500);
  }
});

// Export dataset as a self-contained JSON bundle for independent verification.
//
// We ship **raw** readings (no server-side hashing) and let the downloader
// recompute the canonical hash per reading client-side. This matters because:
//   1. The Supabase free-tier edge runtime hits WORKER_RESOURCE_LIMIT trying
//      to hash 30k+ readings in a single invocation.
//   2. It's cryptographically stronger — the buyer observes the raw data and
//      derives the hash themselves, instead of trusting a server-computed
//      field. They can literally read each value.
//
// The spec below documents the exact hash formula so that recomputation is
// deterministic regardless of who runs it.
const buildDatasetExport = async (dataset: any) => {
  const allSensors = await kv.getByPrefix('sensor:');
  const sensor = allSensors.find((s: any) => s.id === dataset.sensorId);
  const sensorType = sensor?.type || 'temperature';
  const typeConfig = sensorTypeConfigs[sensorType] || sensorTypeConfigs.temperature;

  // Mock sensors keep readings in KV; PG for everything else.
  let rawReadings: any[] = [];
  if (sensor?.mode === 'mock') {
    const kvReadings = await kv.getByPrefix(`reading:${dataset.sensorId}:`);
    const start = new Date(dataset.startDate).getTime();
    const end = new Date(dataset.endDate).getTime();
    rawReadings = kvReadings
      .filter((r: any) => {
        const t = new Date(r.timestamp).getTime();
        return t >= start && t <= end;
      })
      .map((r: any) => ({
        id: r.id,
        timestamp: r.timestamp,
        value: r.value,
        unit: r.unit,
        variable: r.variable,
      }));
  } else {
    const nftAddress = await resolveNftAddress(dataset.sensorId, sensor);
    if (nftAddress) {
      // Page PG in parallel, ASC order (no client-side re-sort needed).
      const start = new Date(dataset.startDate).toISOString();
      const end = new Date(dataset.endDate).toISOString();
      const { count } = await supabase
        .from('sensor_readings')
        .select('id', { count: 'exact', head: true })
        .eq('nft_address', nftAddress)
        .gte('timestamp', start)
        .lte('timestamp', end);
      const total = count ?? 0;
      const PAGE = 1000;
      const numPages = Math.ceil(total / PAGE);
      const pagePromises = Array.from({ length: numPages }, (_, i) => {
        const offset = i * PAGE;
        const endInclusive = Math.min(offset + PAGE, total) - 1;
        return supabase
          .from('sensor_readings')
          .select('id, timestamp, data')
          .eq('nft_address', nftAddress)
          .gte('timestamp', start)
          .lte('timestamp', end)
          .order('timestamp', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, endInclusive);
      });
      const pages = await Promise.all(pagePromises);
      for (const { data, error } of pages) {
        if (error) {
          console.error('export page error:', error.message);
          continue;
        }
        if (!data) continue;
        for (const row of data) {
          const value = row.data?.[typeConfig.dataKey] ?? row.data?.temperature ?? 0;
          rawReadings.push({
            id: row.id,
            timestamp: row.timestamp,
            value,
            unit: typeConfig.unit,
            variable: typeConfig.variable,
          });
        }
      }
    }
  }

  return {
    spec: 'sparked-sense.dataset.v1',
    dataset: {
      id: dataset.id,
      name: dataset.name,
      sensorId: dataset.sensorId,
      sensorName: sensor?.name ?? null,
      sensorType,
      startDate: dataset.startDate,
      endDate: dataset.endDate,
      createdAt: dataset.createdAt,
      readingsCount: rawReadings.length,
    },
    anchor: {
      merkleRoot: dataset.merkleRoot ?? null,
      chain: 'solana',
      cluster: dataset.anchorCluster ?? null,
      transactionId: dataset.anchorTxSignature ?? dataset.transactionId ?? null,
      explorerUrl: dataset.anchorExplorerUrl ?? null,
      memo: dataset.anchorMemo ?? null,
      anchoredAt: dataset.anchoredAt ?? null,
    },
    verification: {
      algorithm: 'sha256-merkle-v1',
      // Canonical per-reading hash: SHA-256 over the UTF-8 bytes of this JSON
      // string (keys in this exact order, no whitespace):
      //   {"sensorId":"<id>","timestamp":"<iso>","value":<number>,"unit":"<str>"}
      canonicalReadingHash:
        'sha256(utf8(JSON.stringify({sensorId,timestamp,value,unit})))',
      sortRule: 'ascending by timestamp, then by id as tiebreaker',
      leafRule: 'leaf = sha256(utf8(readingHashHex))',
      oddLayerRule: 'last node is duplicated',
    },
    readings: rawReadings,
  };
};

app.get("/server/datasets/:id/export", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const id = c.req.param('id');
    const datasets = await kv.getByPrefix(`dataset:`);
    const dataset = datasets.find((d: any) => d.id === id);
    if (!dataset) return c.json({ error: 'Dataset not found' }, 404);

    // Owner-only for private datasets; public datasets are exported via the
    // /public/ route so that auth isn't required from a buyer's browser.
    const sensor = await kv.get(`sensor:${user.id}:${dataset.sensorId}`);
    if (!sensor) return c.json({ error: 'Forbidden' }, 403);

    const payload = await buildDatasetExport(dataset);
    return c.json(payload);
  } catch (error) {
    console.error('Failed to export dataset:', error);
    return c.json({ error: 'Failed to export dataset' }, 500);
  }
});

app.get("/server/public/datasets/:id/export", async (c) => {
  try {
    const id = c.req.param('id');
    const datasets = await kv.getByPrefix(`dataset:`);
    const dataset = datasets.find((d: any) => d.id === id);
    if (!dataset) return c.json({ error: 'Dataset not found' }, 404);
    if (!dataset.isPublic) return c.json({ error: 'Dataset is not public' }, 403);

    const payload = await buildDatasetExport(dataset);
    return c.json(payload);
  } catch (error) {
    console.error('Failed to export public dataset:', error);
    return c.json({ error: 'Failed to export dataset' }, 500);
  }
});

// Delete dataset
app.delete("/server/datasets/:id", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    
    // Find the dataset
    const datasets = await kv.getByPrefix(`dataset:`);
    const dataset = datasets.find((d: any) => d.id === id);
    
    if (!dataset) {
      return c.json({ error: 'Dataset not found' }, 404);
    }

    // Check ownership - verify user owns the sensor
    const sensor = await kv.get(`sensor:${user.id}:${dataset.sensorId}`);
    if (!sensor) {
      return c.json({ error: 'Unauthorized: You do not own this sensor' }, 403);
    }

    // Delete the dataset
    await kv.del(`dataset:${dataset.sensorId}:${id}`);

    console.log(`Dataset ${id} deleted by user ${user.id}`);
    return c.json({ success: true, message: 'Dataset successfully deleted' });
  } catch (error) {
    console.error('Failed to delete dataset:', error);
    return c.json({ error: 'Failed to delete dataset' }, 500);
  }
});

// ======================
// Verification Routes
// ======================

// Verify single hash
app.post("/server/verify/hash", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { sensorId, hash } = await c.req.json();
    
    // Search for the hash in recent readings
    const sensor = await kv.get(`sensor:${user.id}:${sensorId}`);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentReadings = await getSensorReadings(sensorId, sensor, { since: oneHourAgo });
    const found = recentReadings.find((r: any) => r.hash === hash);

    if (found) {
      return c.json({ 
        verified: true, 
        reading: found,
        message: 'Hash verified! Reading is authentic.'
      });
    } else {
      return c.json({ 
        verified: false, 
        message: 'Hash not found in recent readings'
      });
    }
  } catch (error) {
    console.error('Failed to verify hash:', error);
    return c.json({ error: 'Failed to verify hash' }, 500);
  }
});

// Verify hourly Merkle root
app.post("/server/verify/merkle", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();

    // Mode 1: Inclusion proof verification (leafHash + proof + merkleRoot)
    if (body.leafHash && body.proof && body.merkleRoot) {
      const verified = await verifyProof(body.leafHash, body.proof, body.merkleRoot);
      return c.json({ verified, mode: 'inclusion-proof' });
    }

    // Mode 2: Full tree verification (sensorId + merkleRoot)
    const { sensorId, merkleRoot } = body;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const verSensor = await kv.get(`sensor:${user.id}:${sensorId}`);
    const lastHourReadings = await getSensorReadings(sensorId, verSensor, { since: oneHourAgo });
    const tree = await buildMerkleTreeFromReadings(lastHourReadings);

    if (tree.root === merkleRoot) {
      return c.json({
        verified: true,
        readingsCount: lastHourReadings.length,
        message: `Merkle root verified for ${lastHourReadings.length} readings from the last hour`
      });
    } else {
      return c.json({
        verified: false,
        expected: tree.root,
        received: merkleRoot,
        message: 'Merkle root does not match'
      });
    }
  } catch (error) {
    console.error('Failed to verify Merkle root:', error);
    return c.json({ error: 'Failed to verify Merkle root' }, 500);
  }
});

// Get Merkle inclusion proof for a specific reading (authenticated)
app.get("/server/sensors/:id/merkle-proof/:leafIndex", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const leafIndex = parseInt(c.req.param('leafIndex'), 10);
    if (isNaN(leafIndex) || leafIndex < 0) {
      return c.json({ error: 'Invalid leaf index' }, 400);
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const proofSensor = await kv.get(`sensor:${user.id}:${id}`);
    const lastHourReadings = await getSensorReadings(id, proofSensor, { since: oneHourAgo });
    const tree = await buildMerkleTreeFromReadings(lastHourReadings);

    if (leafIndex >= tree.leafCount) {
      return c.json({ error: `Leaf index ${leafIndex} out of range [0, ${tree.leafCount})` }, 400);
    }

    const proof = await generateProof(tree, leafIndex);
    return c.json({ proof, merkleRoot: tree.root, leafCount: tree.leafCount });
  } catch (error) {
    console.error('Failed to generate Merkle proof:', error);
    return c.json({ error: 'Failed to generate Merkle proof' }, 500);
  }
});

// Get Merkle inclusion proof for a specific reading (public)
app.get("/server/public/sensors/:sensorId/merkle-proof/:leafIndex", async (c) => {
  try {
    const sensorId = c.req.param('sensorId');
    const leafIndex = parseInt(c.req.param('leafIndex'), 10);
    if (isNaN(leafIndex) || leafIndex < 0) {
      return c.json({ error: 'Invalid leaf index' }, 400);
    }

    const allSensors = await kv.getByPrefix('sensor:');
    const sensor = allSensors.find((s: any) => s.id === sensorId);
    if (!sensor) {
      return c.json({ error: 'Sensor not found' }, 404);
    }
    if (sensor.visibility !== 'public') {
      return c.json({ error: 'Sensor data is not public' }, 403);
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lastHourReadings = await getSensorReadings(sensorId, sensor, { since: oneHourAgo });
    const tree = await buildMerkleTreeFromReadings(lastHourReadings);

    if (leafIndex >= tree.leafCount) {
      return c.json({ error: `Leaf index ${leafIndex} out of range [0, ${tree.leafCount})` }, 400);
    }

    const proof = await generateProof(tree, leafIndex);
    return c.json({ proof, merkleRoot: tree.root, leafCount: tree.leafCount });
  } catch (error) {
    console.error('Failed to generate public Merkle proof:', error);
    return c.json({ error: 'Failed to generate public Merkle proof' }, 500);
  }
});

// ======================
// Stats Route
// ======================

app.get("/server/stats", async (c) => {
  try {
    const user = await getUserFromToken(c.req.raw);
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sensors = await kv.getByPrefix(`sensor:${user.id}:`);
    const activeSensors = sensors.filter((s: any) => s.status === 'active').length;
    
    let totalReadings = 0;
    let totalDatasets = 0;
    
    for (const sensor of sensors) {
      const readingCount = await countSensorReadings(sensor.id, sensor);
      const datasets = await kv.getByPrefix(`dataset:${sensor.id}:`);
      totalReadings += readingCount;
      totalDatasets += datasets.length;
    }

    return c.json({
      totalSensors: sensors.length,
      activeSensors,
      totalReadings,
      totalDatasets,
    });
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }
});

// ======================
// Public API Routes (No Authentication Required)
// ======================

// Get all public sensors
app.get("/server/public/sensors", async (c) => {
  try {
    const allSensors = await kv.getByPrefix('sensor:');
    console.log(`Found ${allSensors.length} total sensors in database`);
    
    // Filter sensors with visibility = 'public'
    const publicSensors = allSensors.filter((sensor: any) => sensor.visibility === 'public');
    
    console.log(`Returning ${publicSensors.length} public sensors (filtered by visibility='public')`);
    return c.json({ sensors: publicSensors });
  } catch (error) {
    console.error('Failed to fetch public sensors:', error);
    return c.json({ error: 'Failed to fetch public sensors' }, 500);
  }
});

// Top 3 public sensors for the home page card.
//
// Sort key is `sensor.lastReading.timestamp` (mirrored on every ingest into the
// sensor KV row), so we can rank without hitting Postgres. Only the 3 sensors
// that will actually render get a totalReadingsCount union HEAD count — sensors
// that fall off the top-3 cost zero DB work.
//
// Previous version computed an hourly Merkle root, last-reading lookups, and
// a public-datasets KV scan per sensor. None of those fields were rendered on
// the card; removed alongside the corresponding fields in src/lib/types.ts.
app.get("/server/public/sensors/featured", async (c) => {
  try {
    const allSensors = await kv.getByPrefix('sensor:');

    const top3 = allSensors
      .filter((s: any) => s.visibility === 'public')
      .map((sensor: any) => ({
        sensor,
        lastActivity: sensor.lastReading?.timestamp ?? sensor.createdAt,
      }))
      .sort((a: any, b: any) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
      )
      .slice(0, 3);

    const featured = await Promise.all(top3.map(async ({ sensor, lastActivity }: any) => {
      const totalReadingsCount = await countSensorReadings(sensor.id, sensor);
      return {
        id: sensor.id,
        name: sensor.name,
        type: sensor.type,
        status: sensor.status,
        totalReadingsCount,
        totalDataBytes: totalReadingsCount * AVG_READING_BYTES,
        lastActivity,
      };
    }));

    return c.json({ sensors: featured });
  } catch (error) {
    console.error('Failed to fetch featured sensors:', error);
    return c.json({ error: 'Failed to fetch featured sensors' }, 500);
  }
});

// Get a specific public sensor
app.get("/server/public/sensors/:id", async (c) => {
  try {
    const sensorId = c.req.param('id');
    const allSensors = await kv.getByPrefix('sensor:');
    const sensor = allSensors.find((s: any) => s.id === sensorId);

    if (!sensor) {
      return c.json({ error: 'Sensor not found' }, 404);
    }

    // Check if sensor visibility is public
    if (sensor.visibility !== 'public') {
      return c.json({ error: 'Sensor is not public' }, 403);
    }

    const totalReadingsCount = await countSensorReadings(sensorId, sensor);

    return c.json({
      sensor: {
        ...sensor,
        totalReadingsCount,
        totalDataBytes: totalReadingsCount * AVG_READING_BYTES,
      },
    });
  } catch (error) {
    console.error('Failed to fetch public sensor:', error);
    return c.json({ error: 'Failed to fetch public sensor' }, 500);
  }
});

// Get public datasets for a sensor
app.get("/server/public/datasets/:sensorId", async (c) => {
  try {
    const sensorId = c.req.param('sensorId');
    
    // Check if sensor visibility is public
    const allSensors = await kv.getByPrefix('sensor:');
    const sensor = allSensors.find((s: any) => s.id === sensorId);
    
    if (!sensor) {
      return c.json({ error: 'Sensor not found' }, 404);
    }
    
    if (sensor.visibility !== 'public') {
      return c.json({ error: 'Sensor datasets are not public' }, 403);
    }
    
    const datasets = await kv.getByPrefix(`dataset:${sensorId}:`);
    const publicDatasets = datasets.filter((d: any) => d.isPublic === true);

    // Backfill stale readingsCount (see datasets/:sensorId handler for context).
    const refreshed = await Promise.all(publicDatasets.map(async (d: any) => {
      try {
        const count = await countSensorReadings(sensorId, sensor, {
          since: new Date(d.startDate),
          until: new Date(d.endDate),
        });
        return { ...d, readingsCount: count };
      } catch {
        return d;
      }
    }));

    return c.json({ datasets: refreshed });
  } catch (error) {
    console.error('Failed to fetch public datasets:', error);
    return c.json({ error: 'Failed to fetch public datasets' }, 500);
  }
});

// Get public readings for a sensor
app.get("/server/public/readings/:sensorId", async (c) => {
  try {
    const sensorId = c.req.param('sensorId');
    const limit = parseInt(c.req.query('limit') || '100');
    const slim = c.req.query('slim') === '1';

    // Check if sensor visibility is public
    const allSensors = await kv.getByPrefix('sensor:');
    const sensor = allSensors.find((s: any) => s.id === sensorId);

    if (!sensor) {
      return c.json({ error: 'Sensor not found' }, 404);
    }

    if (sensor.visibility !== 'public') {
      return c.json({ error: 'Sensor readings are not public' }, 403);
    }

    const sortedReadings = await getSensorReadings(sensorId, sensor, { limit });

    return c.json({ readings: slim ? sortedReadings.map(slimReading) : sortedReadings });
  } catch (error) {
    console.error('Failed to fetch public readings:', error);
    return c.json({ error: 'Failed to fetch public readings' }, 500);
  }
});

// Get public hourly Merkle root for a sensor
app.get("/server/public/sensors/:sensorId/hourly-merkle", async (c) => {
  try {
    const sensorId = c.req.param('sensorId');
    
    // Check if sensor visibility is public
    const allSensors = await kv.getByPrefix('sensor:');
    const sensor = allSensors.find((s: any) => s.id === sensorId);
    
    if (!sensor) {
      return c.json({ error: 'Sensor not found' }, 404);
    }
    
    if (sensor.visibility !== 'public') {
      return c.json({ error: 'Sensor data is not public' }, 403);
    }
    
    // Calculate hourly Merkle root
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lastHourReadings = await getSensorReadings(sensorId, sensor, { since: oneHourAgo });
    const tree = await buildMerkleTreeFromReadings(lastHourReadings);

    return c.json({
      merkleRoot: tree.root,
      leafCount: tree.leafCount,
      leaves: tree.leaves,
      readingsCount: lastHourReadings.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to fetch public hourly Merkle root:', error);
    return c.json({ error: 'Failed to fetch public hourly Merkle root' }, 500);
  }
});

// ======================
// Mock Data Generation
// ======================

// Generate mock readings for all mock sensors
app.post("/server/internal/generate-mock-data", async (c) => {
  try {
    const allSensors = await kv.getByPrefix('sensor:');
    const mockSensors = allSensors.filter((s: any) => s.mode === 'mock');
    
    console.log(`Generating mock data for ${mockSensors.length} mock sensors`);
    
    const results = [];
    for (const sensor of mockSensors) {
      const reading = await generateMockReading(sensor);
      results.push({ sensorId: sensor.id, readingId: reading.id });
      
      // Update sensor status to active and set last reading
      sensor.status = 'active';
      sensor.updatedAt = new Date().toISOString();
      await kv.set(`sensor:${sensor.owner}:${sensor.id}`, sensor);
    }
    
    return c.json({ 
      success: true, 
      generated: results.length,
      readings: results 
    });
  } catch (error) {
    console.error('Failed to generate mock data:', error);
    return c.json({ error: 'Failed to generate mock data' }, 500);
  }
});

// Mock-mode sensor data is generated on-demand via POST /server/internal/generate-mock-data.
// The previous setInterval that scanned every sensor every 5s was wasteful at all scales:
// it issued a kv.getByPrefix('sensor:') per tick whether or not any mock sensor existed, and
// edge-runtime intervals only fire while a worker is alive (driven by unrelated invocations),
// making the cadence non-deterministic anyway.

// ======================
// Device Registration Routes (ESP8266 physical devices - no user JWT required)
// ======================

// POST /server/register-device
// Step 1: {macAddress, publicKey}            → {challenge}
// Step 2: {publicKey, challenge, signature}  → {nftAddress, claimToken, txSignature}
app.post("/server/register-device", async (c) => {
  try {
    const body = await c.req.json();
    const { macAddress, publicKey, challenge, signature } = body;

    // --- STEP 1: Issue challenge ---
    if (!challenge && !signature) {
      if (!macAddress || !publicKey) {
        return c.json({ error: "Missing macAddress or publicKey" }, 400);
      }

      const challengeBytes = new Uint8Array(32);
      crypto.getRandomValues(challengeBytes);
      const challengeValue = Array.from(challengeBytes)
        .map(b => b.toString(16).padStart(2, '0')).join('');

      const { error: upsertError } = await supabase
        .from('devices')
        .upsert(
          { public_key: publicKey, mac_address: macAddress, challenge: challengeValue },
          { onConflict: 'public_key' }
        );

      if (upsertError) {
        console.error('Challenge upsert error:', upsertError);
        return c.json({ error: 'DB error: ' + upsertError.message }, 500);
      }

      console.log(`🔑 Challenge issued for ${publicKey.substring(0, 20)}...`);
      return c.json({ challenge: challengeValue });
    }

    // --- STEP 2: Verify signature and complete registration ---
    if (!publicKey || !challenge || !signature) {
      return c.json({ error: "Missing publicKey, challenge or signature" }, 400);
    }

    const { data: device, error: fetchError } = await supabase
      .from('devices')
      .select('*')
      .eq('public_key', publicKey)
      .single();

    if (fetchError || !device) {
      return c.json({ error: 'Device not found' }, 404);
    }

    if (device.challenge !== challenge) {
      return c.json({ error: 'Invalid challenge' }, 401);
    }

    // Already registered? Return existing identity (idempotent)
    if (device.nft_address) {
      console.log(`ℹ️  Device already registered, returning existing identity`);
      return c.json({
        nftAddress: device.nft_address,
        claimToken: device.claim_token,
        txSignature: device.tx_signature,
      });
    }

    // Verify secp256k1 signature using @noble/curves (Deno-native)
    const challengeBytes = new TextEncoder().encode(challenge);
    const hashBuffer = await crypto.subtle.digest('SHA-256', challengeBytes);
    const msgHash = new Uint8Array(hashBuffer);

    // Build 64-byte compact signature from r,s hex strings
    const rHex = signature.r.padStart(64, '0');
    const sHex = signature.s.padStart(64, '0');
    const sigBytes = new Uint8Array(64);
    for (let i = 0; i < 32; i++) {
      sigBytes[i] = parseInt(rHex.substring(i * 2, i * 2 + 2), 16);
      sigBytes[32 + i] = parseInt(sHex.substring(i * 2, i * 2 + 2), 16);
    }

    // Parse uncompressed public key (04 + 64 bytes)
    const pubKeyBytes = new Uint8Array(publicKey.length / 2);
    for (let i = 0; i < pubKeyBytes.length; i++) {
      pubKeyBytes[i] = parseInt(publicKey.substring(i * 2, i * 2 + 2), 16);
    }

    const sigObj = secp256k1.secp256k1.Signature.fromCompact(sigBytes);
    // lowS: false — uECC on ESP8266 doesn't normalize to low-S (BIP-0062)
    const isValid = secp256k1.secp256k1.verify(sigObj, msgHash, pubKeyBytes, { lowS: false });
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Generate device identity (simulated NFT address - 64 hex chars like a Solana pubkey)
    const nftBytes = new Uint8Array(32);
    crypto.getRandomValues(nftBytes);
    const nftAddress = Array.from(nftBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const tokenBytes = new Uint8Array(16);
    crypto.getRandomValues(tokenBytes);
    const claimToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const txSig = 'devnet_sim_' + Array.from(nftBytes).slice(0, 16)
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const { error: updateError } = await supabase
      .from('devices')
      .update({
        nft_address: nftAddress,
        claim_token: claimToken,
        tx_signature: txSig,
        challenge: null,
      })
      .eq('public_key', publicKey);

    if (updateError) {
      console.error('Device update error:', updateError);
      return c.json({ error: 'DB error: ' + updateError.message }, 500);
    }

    console.log(`✅ Device registered: ${publicKey.substring(0, 20)}... → nft: ${nftAddress.substring(0, 16)}...`);
    return c.json({ nftAddress, claimToken, txSignature: txSig });

  } catch (err: any) {
    console.error('register-device error:', err);
    return c.json({ error: err.message || 'Internal server error' }, 500);
  }
});

// POST /server/sensor-data — REMOVED per ADR-015 (cutover 2026-04-27).
//
// All ingestion now goes through /server/reading (ADR-010 envelope). The
// legacy ESP8266 firmware was migrated and flashed 2026-04-26; cutover to
// 410 Gone happened 2026-04-27 after ~17h of clean envelope traffic
// confirmed no straggler legacy publishers exist (single-device fleet,
// hard-cutover firmware — the 7-day buffer in ADR-015 step 5 was overkill
// for this deployment context). Reads from `sensor_readings` continue to
// work via getSensorReadings' real-mode union read; the table is frozen
// read-only history and Merkle proofs from pre-cutover datasets remain valid.
app.post("/server/sensor-data", async (c) => {
  console.warn(`⚠️  Legacy /server/sensor-data POST hit after cutover (ADR-015) — should not happen`);
  c.header('X-Sparked-Deprecation', 'endpoint removed; use /server/reading per ADR-015');
  return c.json({
    error: 'This endpoint was removed on 2026-04-27. Devices must publish CloudEvents envelopes to /server/reading per ADR-015.',
    code: 'gone',
    migration: 'https://github.com/viniciomendesr/sparkedsense/blob/main/docs/adr/015-unify-ingestion-on-adr-010.md',
  }, 410);
});

// ======================
// ADR-010: Sensor-agnostic ingestion endpoint
// ======================

// POST /server/reading
// Accepts a CloudEvents 1.0 envelope with Sparked Sense signature extension.
// No user JWT — device is authenticated via secp256k1 signature over canonical
// JSON of the envelope (minus `signature`). Writes to the `readings` table.
app.post("/server/reading", async (c) => {
  try {
    const body = await c.req.json();

    const { envelope, error: shapeError } = validateEnvelopeShape(body);
    if (shapeError || !envelope) {
      return c.json({ error: shapeError?.message ?? 'Invalid envelope', code: shapeError?.code }, 400);
    }

    const pubKeyHex = parseSource(envelope.source);
    if (!pubKeyHex) {
      return c.json({ error: 'Invalid source', code: 'envelope_bad_source' }, 400);
    }

    const { data: device, error: deviceError } = await supabase
      .from('devices')
      .select('*')
      .eq('public_key', pubKeyHex)
      .single();

    if (deviceError || !device) {
      return c.json({ error: 'Device not registered', code: 'device_not_found' }, 404);
    }

    if (device.revoked) {
      return c.json({ error: 'Device revoked', code: 'device_revoked' }, 403);
    }

    // Rate limit: relaxado pra 1s durante demo Claro 2026-04-24 (originalmente
    // 55s; passou por 5s durante os primeiros testes). 1s ainda bloqueia flood
    // de um device comprometido mas deixa o Nó 2 publicar múltiplos "claro" em
    // sequência. Usamos millisegundos pra ter resolução sub-segundo.
    // TODO: voltar pra 55s após a demo.
    const eventTimeSec = Math.floor(new Date(envelope.time).getTime() / 1000);
    const nowMs = Date.now();
    if (device.last_ts_seen && (nowMs - Number(device.last_ts_seen) * 1000) < 1000) {
      return c.json({ error: 'Rate limited — wait before sending another reading', code: 'rate_limited' }, 429);
    }

    // Verify signature — ADR-011 allows a time-limited bypass for Node 2 (ESP32-S3)
    // whose signing pipeline is not yet ported. Device identity is still enforced via
    // the `source` → public_key lookup above. Remove after the port lands.
    if (envelope.signature === 'unsigned_dev') {
      // TODO(ADR-011): remove after ESP32-S3 signing pipeline is ported.
      console.warn(`⚠️  Accepting unsigned event from ${envelope.source} (ADR-011 bypass)`);
    } else {
      const validSig = await verifyEnvelopeSignature(envelope, device.public_key);
      if (!validSig) {
        return c.json({ error: 'Invalid signature', code: 'bad_signature' }, 401);
      }
    }

    // Validate typed payload for platform-blessed types; custom types pass through
    if (isPlatformType(envelope.type)) {
      const typeError = validateTypedPayload(envelope.type, envelope.data);
      if (typeError) {
        return c.json({ error: typeError.message, code: typeError.code }, 400);
      }
    }

    // Insert into canonical readings table
    const { error: insertError } = await supabase.from('readings').insert({
      id: envelope.id,
      spec_version: envelope.specversion,
      event_type: envelope.type,
      source: envelope.source,
      time: envelope.time,
      datacontenttype: envelope.datacontenttype,
      data: envelope.data,
      device_id: device.id,
      signature: envelope.signature,
    });

    if (insertError) {
      console.error('readings insert error:', insertError);
      return c.json({ error: 'Storage error', code: 'storage_error', detail: insertError.message }, 500);
    }

    // Update rate-limit timestamp + KV sensor lastReading for live dashboard
    await supabase.from('devices').update({ last_ts_seen: eventTimeSec }).eq('id', device.id);

    try {
      const allSensors = await kv.getByPrefix('sensor:');
      // Match order:
      //  - s.id === device.id: legacy KV mirror (kept for older rows)
      //  - claimToken: real/mock sensors linked via claim_token (both sides must be non-null to avoid
      //    false matches when multiple sensors/devices have claim_token = null, e.g. unsigned_dev)
      //  - devicePublicKey: ADR-012 unsigned_dev sensors, which never receive a claim_token
      const linkedSensor = allSensors.find((s: any) =>
        s.id === device.id ||
        (s.claimToken && device.claim_token && s.claimToken === device.claim_token) ||
        (s.devicePublicKey && s.devicePublicKey === device.public_key)
      );
      if (linkedSensor) {
        linkedSensor.status = 'active';
        linkedSensor.updatedAt = new Date().toISOString();

        // ADR-012: Mirror firmware-supplied location on the envelope (CloudEvents
        // extensions: `latitude`, `longitude`, `location`) into the sensor KV row.
        // Only fills fields that are still empty — once a user edits location via
        // the UI, their value is authoritative and we never overwrite it. `real`
        // sensors go through the signed-geolocation path instead, so we gate by mode.
        if (linkedSensor.mode === 'unverified') {
          const envAny = envelope as unknown as Record<string, unknown>;
          const envLat = typeof envAny.latitude === 'number' ? envAny.latitude as number : null;
          const envLng = typeof envAny.longitude === 'number' ? envAny.longitude as number : null;
          const envLoc = typeof envAny.location === 'string' ? envAny.location as string : null;

          if (envLat !== null && linkedSensor.latitude == null) {
            linkedSensor.latitude = envLat;
          }
          if (envLng !== null && linkedSensor.longitude == null) {
            linkedSensor.longitude = envLng;
          }
          if (envLoc && (!linkedSensor.location || linkedSensor.location.length === 0)) {
            linkedSensor.location = envLoc;
          }
        }

        // Mirror a minimal lastReading for numeric SenML envelopes so existing
        // sparklines keep working during the dual-write period.
        if (envelope.type === 'io.sparkedsense.sensor.environmental' || envelope.type === 'io.sparkedsense.sensor.generic') {
          const records = envelope.data as Array<Record<string, unknown>>;
          const first = Array.isArray(records) ? records[0] : null;
          if (first && typeof first.v === 'number') {
            linkedSensor.lastReading = {
              id: envelope.id,
              sensorId: linkedSensor.id,
              timestamp: envelope.time,
              variable: (first.n as string) ?? 'value',
              value: first.v,
              unit: (first.u as string) ?? '',
              verified: true,
              hash: envelope.id,
              signature: envelope.signature.substring(0, 16),
            };
          }
        } else if (envelope.type === 'io.sparkedsense.inference.classification') {
          // ADR-012: acoustic inference events (Node 2 Claro demo) carry
          // { class, confidence, model_id }. Surface confidence as the numeric
          // value and the predicted class label as the `variable` so the card
          // shows e.g. "claro — 0.91" instead of a stale/synthetic reading.
          const data = envelope.data as Record<string, unknown> | undefined;
          const cls = typeof data?.class === 'string' ? data!.class as string : 'class';
          const confidence = typeof data?.confidence === 'number' ? data!.confidence as number : null;
          if (confidence !== null) {
            linkedSensor.lastReading = {
              id: envelope.id,
              sensorId: linkedSensor.id,
              timestamp: envelope.time,
              variable: cls,
              value: confidence,
              unit: '',
              // Unsigned envelopes are explicitly unverified; any other signature
              // was already checked by verifyEnvelopeSignature above.
              verified: envelope.signature !== 'unsigned_dev',
              hash: envelope.id,
              signature: envelope.signature.substring(0, 16),
            };
          }
        }
        await kv.set(`sensor:${linkedSensor.owner}:${linkedSensor.id}`, linkedSensor);
      }
    } catch (kvErr: any) {
      console.error('KV mirror error (non-fatal):', kvErr.message);
    }

    console.log(`📨 /reading accepted: type=${envelope.type} source=${envelope.source.substring(13, 29)}... id=${envelope.id}`);
    return c.json({ success: true, id: envelope.id });
  } catch (error: any) {
    console.error('POST /reading error:', error);
    return c.json({ error: error.message || 'Internal server error', code: 'internal_error' }, 500);
  }
});

// GET /server/public/readings-v2/:sensorId
// Returns raw envelopes for a device (public access for sensors with visibility='public').
// KV sensor `id` ≠ `devices.id`; resolve via claim_token before filtering the readings table.
app.get("/server/public/readings-v2/:sensorId", async (c) => {
  try {
    const sensorId = c.req.param('sensorId');
    const limit = parseInt(c.req.query('limit') || '100');
    const eventType = c.req.query('type');

    const allSensors = await kv.getByPrefix('sensor:');
    const sensor = allSensors.find((s: any) => s.id === sensorId);
    if (!sensor) return c.json({ error: 'Sensor not found' }, 404);
    if (sensor.visibility !== 'public') return c.json({ error: 'Sensor readings are not public' }, 403);

    // Translate KV sensor id → devices.id.
    // Real/mock sensors link via claim_token; unsigned_dev (ADR-012) links via
    // devicePublicKey (no claim_token is ever issued for that mode).
    let deviceId: string | null = null;
    if (sensor.claimToken) {
      const { data: dev } = await supabase
        .from('devices')
        .select('id')
        .eq('claim_token', sensor.claimToken)
        .maybeSingle();
      if (dev?.id) deviceId = dev.id as string;
    }
    if (!deviceId && sensor.devicePublicKey) {
      const { data: dev } = await supabase
        .from('devices')
        .select('id')
        .eq('public_key', sensor.devicePublicKey)
        .maybeSingle();
      if (dev?.id) deviceId = dev.id as string;
    }
    if (!deviceId) {
      // No linked real device (mock sensor or unclaimed); nothing in readings table to return
      return c.json({ readings: [] });
    }

    let query = supabase
      .from('readings')
      .select('*')
      .eq('device_id', deviceId)
      .order('time', { ascending: false })
      .limit(limit);

    if (eventType) query = query.eq('event_type', eventType);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    return c.json({ readings: data ?? [] });
  } catch (error: any) {
    console.error('GET /public/readings-v2 error:', error);
    return c.json({ error: error.message || 'Internal server error' }, 500);
  }
});

// GET /server/public/anchor-info — diagnostic: returns server wallet + cluster.
// Lazy-imports Solana libs only when the endpoint is hit.
app.get("/server/public/anchor-info", async (c) => {
  const enabled = !!Deno.env.get("SOLANA_SERVER_SECRET_KEY_BASE58");
  const rpcUrl = Deno.env.get("SOLANA_RPC_URL") ?? "https://api.devnet.solana.com";
  const cluster = rpcUrl.includes("mainnet") ? "mainnet-beta" : rpcUrl.includes("testnet") ? "testnet" : "devnet";

  if (!enabled) {
    return c.json({ enabled: false, publicKey: null, cluster, balanceSol: null, explorerAddressUrl: null });
  }

  let publicKey: string | null = null;
  try {
    const { getServerPublicKey } = await import("./lib/solana.ts");
    publicKey = getServerPublicKey();
  } catch (err) {
    console.error("solana module load failed:", err);
  }

  let lamports: number | null = null;
  if (publicKey) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [publicKey] }),
      });
      const data = await res.json();
      lamports = data?.result?.value ?? null;
    } catch (_e) {
      // non-fatal
    }
  }

  return c.json({
    enabled,
    publicKey,
    cluster,
    balanceSol: lamports != null ? lamports / 1_000_000_000 : null,
    explorerAddressUrl: publicKey ? `https://explorer.solana.com/address/${publicKey}?cluster=${cluster}` : null,
  });
});

// POST /server/device-location (no user JWT required)
// ESP sends WiFi AP scan results, backend resolves to lat/lng via Apple WiFi DB (Cloudflare Worker)
// See ADR-009 for architecture details
app.post("/server/device-location", async (c) => {
  try {
    const body = await c.req.json();
    const { nftAddress, wifiAccessPoints } = body;

    if (!nftAddress || !wifiAccessPoints || !Array.isArray(wifiAccessPoints) || wifiAccessPoints.length === 0) {
      return c.json({ error: 'Missing nftAddress or wifiAccessPoints array' }, 400);
    }

    // Fetch device by nft_address
    const { data: device, error: fetchError } = await supabase
      .from('devices')
      .select('*')
      .eq('nft_address', nftAddress)
      .single();

    if (fetchError || !device) {
      return c.json({ error: 'Device not found for nftAddress: ' + nftAddress }, 404);
    }

    // Skip if location was updated recently (< 24h ago)
    if (device.latitude && device.updated_at) {
      const lastUpdate = new Date(device.updated_at).getTime();
      const hoursSinceUpdate = (Date.now() - lastUpdate) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 24) {
        return c.json({
          success: true,
          cached: true,
          location: device.location,
          latitude: device.latitude,
          longitude: device.longitude,
        });
      }
    }

    // Query Apple WiFi DB via Cloudflare Worker (single batch request)
    const geoWorkerUrl = Deno.env.get('GEOLOCATE_WORKER_URL');
    if (!geoWorkerUrl) {
      console.error('GEOLOCATE_WORKER_URL not configured');
      return c.json({ error: 'Geolocation service not configured' }, 503);
    }

    const workerPayload = {
      accessPoints: wifiAccessPoints.map((ap: any) => ({
        bssid: ap.macAddress,
        signal: ap.signalStrength ?? null,
      })),
      all: false,
      reverseGeocode: true,
    };

    const workerRes = await fetch(geoWorkerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workerPayload),
    });

    if (!workerRes.ok) {
      const errBody = await workerRes.text();
      console.error('Geolocate worker error:', workerRes.status, errBody);
      return c.json({ error: 'Geolocation service error' }, 502);
    }

    const geoData = await workerRes.json();

    if (!geoData.found) {
      // Try IP-based fallback from worker response
      if (geoData.fallback) {
        const fb = geoData.fallback;
        const locationText = [fb.city, fb.region, fb.country].filter(Boolean).join(', ') ||
          `${fb.latitude.toFixed(4)}, ${fb.longitude.toFixed(4)}`;

        const { error: updateError } = await supabase
          .from('devices')
          .update({ location: locationText, latitude: fb.latitude, longitude: fb.longitude, location_accuracy: 10000 })
          .eq('nft_address', nftAddress);

        if (updateError) {
          console.error('Device location update error:', updateError);
          return c.json({ error: 'DB error: ' + updateError.message }, 500);
        }

        console.log(`📍 Location (IP fallback): ${nftAddress.substring(0, 16)}... → ${locationText}`);
        return c.json({ success: true, location: locationText, latitude: fb.latitude, longitude: fb.longitude, accuracy: 10000, source: 'ip-fallback' });
      }
      return c.json({ error: 'Could not determine location from WiFi data' }, 422);
    }

    // Extract location: prefer triangulated (weighted centroid), fall back to first result
    let latitude: number;
    let longitude: number;
    let locationText: string;

    const source = geoData.triangulated ?? geoData.results[0];
    latitude = source.latitude;
    longitude = source.longitude;
    locationText = buildLocationText(source.address, latitude, longitude);

    const accuracy = geoData.triangulated ? Math.round(50 / geoData.triangulated.pointsUsed) : 100;

    // Update device in database
    const { error: updateError } = await supabase
      .from('devices')
      .update({ location: locationText, latitude, longitude, location_accuracy: accuracy })
      .eq('nft_address', nftAddress);

    if (updateError) {
      console.error('Device location update error:', updateError);
      return c.json({ error: 'DB error: ' + updateError.message }, 500);
    }

    // Update KV sensor metadata (best-effort)
    try {
      const allSensors = await kv.getByPrefix('sensor:');
      const linkedSensor = allSensors.find((s: any) => s.claimToken === device.claim_token);
      if (linkedSensor) {
        linkedSensor.location = locationText;
        linkedSensor.latitude = latitude;
        linkedSensor.longitude = longitude;
        linkedSensor.locationAccuracy = accuracy;
        linkedSensor.updatedAt = new Date().toISOString();
        await kv.set(`sensor:${linkedSensor.owner}:${linkedSensor.id}`, linkedSensor);
      }
    } catch (kvErr: any) {
      console.error('KV location update error (non-fatal):', kvErr.message);
    }

    console.log(`📍 Location: ${nftAddress.substring(0, 16)}... → ${locationText} (±${accuracy}m)`);
    return c.json({ success: true, location: locationText, latitude, longitude, accuracy });

  } catch (err: any) {
    console.error('device-location error:', err);
    return c.json({ error: err.message || 'Internal server error' }, 500);
  }
});

// Serve with proper CORS handling
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, Cache-Control",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Handle actual request
  const response = await app.fetch(req);
  
  // Ensure CORS headers on response
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, x-client-info, Cache-Control");
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});