# Timeline — Sparked Sense

Chronological record of the project's evolution. Architectural decisions are documented separately in [ADRs](adr/README.md).

Format inspired by [Keep a Changelog](https://keepachangelog.com/).

---

## Phase 1 — Foundation and UI (30-31 Oct 2025)

**Contributors:** Vinicio Mendes, Nicolas Gabriel, Figma Bot

### Added
- Initial commit with Figma Make import (93 files, ~19,500 lines): React + Vite frontend, Radix UI components, Tailwind styling, Recharts, Supabase Edge Function with KV store
- Supabase project setup (`djzexivvddzzduetmkel`): `kv_store` table, Edge Function `server` (Hono + Deno), Supabase Auth
- Vercel deployment as `sparkedsensemvpv1` at `sparkedsensemvp.vercel.app` (Vite SPA)
- Environment variables on Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

### Changed
- Nicolas Gabriel: Supabase integration fixes, build/deploy adjustments with pnpm (2 PRs merged from `nicolas` branch)
- Content adjustments, favicon, README cleanup

> Stack decisions documented in [ADR-001](adr/001-stack-and-infrastructure.md)

---

## Phase 2 — Refinement and documentation (Nov-Dec 2025)

**Contributors:** Vinicio Mendes, Pedro Goularte

### Added
- Pedro Goularte: mission statement in README
- Pedro Goularte: `sparked-three` Vercel project as Solana integration test environment (Token + Wallet Address page, `SERVER_SECRET_KEY_BASE58` for devnet NFT minting)
- Pitch video link in README

### Fixed
- Typography and heading capitalization on HomePage

---

## Phase 3 — Architecture refactoring (09 Mar 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Removed
- 2,186 lines of duplicated/unused code: `kv_store.tsx`, `deviceRegistry.ts`, `redis.ts`, `solanaService.ts`, `supabaseClient.ts`, and legacy SQL migration from `src/supabase/`

### Changed
- API route standardization: removed versioning from paths (`/server/v1/*` → `/server/*`)
- Updated `api.ts` (frontend) and `kv_store.ts` (backend) to match new routes
- Redeployed Edge Function `server`

> Backend unification documented in [ADR-002](adr/002-unified-backend-edge-functions.md)

---

## Phase 4 — IoT hardware integration + DePIN (09-10 Mar 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Discovered
- Next.js API routes in `app/api/` were dead code — project uses `vite build`, `next` is not a dependency
- `sparked-three.vercel.app` was a test page, not the application backend
- No functional backend existed for IoT device communication

### Added (database — 10 Mar)
- PostgreSQL table `devices`: `publicKey` PK, `macAddress`, `nftAddress` UNIQUE, `txSignature`, `lastTsSeen`, `revoked`, `challenge`, `ownerAddress`, `claimToken` UNIQUE, `is_mock`, `mock_sensor_type`, `mock_private_key`
- PostgreSQL table `sensor_readings`: `id` UUID PK, `nft_address`, `timestamp`, `data` JSONB
- RLS disabled on both tables; `GRANT ALL` to `anon`, `authenticated`, `service_role`

### Added (Edge Function — 10 Mar)
- `@noble/curves` via esm.sh for secp256k1 verification (replacing `npm:elliptic` which caused BOOT_ERROR on Deno)
- `POST /server/register-device`: two-step challenge-response with secp256k1 signature verification
- `POST /server/sensor-data`: reading ingestion with cryptographic verification, 55s rate limit via `lastTsSeen`, dual write to PostgreSQL + KV store
- Bridge between KV store and PostgreSQL: `sensor-data` route resolves sensor by `claimToken` and writes in dashboard-compatible format

### Added (ESP8266 firmware — 10 Mar)
- `ESP/ESP.ino`: DHT11 sensor on pin D2, secp256k1 key generation/persistence in EEPROM, challenge-response registration, cryptographic signing of canonical JSON payloads, 60s send interval
- Endpoints pointed to Supabase Edge Function with `Authorization: Bearer <anon_key>`
- WiFi networks tested: `firetheboxv2`, iPhone hotspot, `MVISIA_2.4GHz` (Inova USP). `eduroam` incompatible (WPA2-Enterprise not supported by ESP8266)

### Removed
- Legacy tables (`devices`, `sensor_readings`, `datasets`, `audit_logs`) with incompatible schema (snake_case vs camelCase)

### Verified
- End-to-end test successful: DHT11 → ESP8266 → WiFi → HTTPS → Edge Function → secp256k1 verification → PostgreSQL + KV store → dashboard with live chart. Sensor status changed from "Inactive" to "Active"

> Signature verification documented in [ADR-003](adr/003-secp256k1-signature-verification.md)
> Storage architecture documented in [ADR-004](adr/004-dual-layer-storage.md)

---

## Phase 5 — Blockchain identity reset (10 Mar 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Changed
- New Solana devnet wallet via Phantom Wallet: `6RuAxerE8GsMziM4c77ZzakfMAiebSfTE3LX4S1EyMNn` (10 SOL airdrop)
- Removed old Solana secret key (previously owned by Pedro Goularte)

### Removed
- Full database cleanup: `DELETE FROM` on `sensor_readings`, `devices`, `kv_store_4a89e1c9`, and Supabase Auth users

### Added
- Fresh device registration after ESP8266 EEPROM reset: new NFT address `b1f7dbeb...`, claim token `ed52b6ee...`
- First post-reset reading: 24.7C / 83% humidity — HTTP 200

### Fixed (frontend reactivity)
- `sensor-detail.tsx`: added 15s polling for real sensors via `readingAPI.list()` with immediate call on mount
- `dashboard.tsx`: sparkline differentiation between mock (local 2s) and real (API 15s) sensors; global polling at 30s as Realtime fallback
- `api.ts`: added `Cache-Control: no-cache, no-store` header to prevent stale responses

> Identity reset documented in [ADR-005](adr/005-blockchain-identity-reset.md)

---

## Phase 6 — CORS fix and Edge Function stability (10 Mar 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Fixed
- Homepage "Unable to Load Featured Sensors" error: `Cache-Control` header added in Phase 5 was not whitelisted in CORS `Access-Control-Allow-Headers`, causing browser preflight rejection
- Added `Cache-Control` to CORS whitelist in 4 locations in Edge Function
- Redeployed Edge Function `server` (v9)

### Changed
- `.gitignore`: added `.vscode`; removed `.claude/worktrees` and `.vscode` from git tracking

> CORS decision documented in [ADR-006](adr/006-cors-header-whitelisting.md)

---

## Phase 7 — Documentation restructure and blockchain planning (10 Mar 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Changed
- Project documentation restructured into `docs/` directory: `timeline.md` (Keep a Changelog format) and `docs/adr/` (Nygard ADR format) with index table
- Legacy Next.js routes (`app/`) moved to `_reference/` with migration status README — these were dead code (project uses Vite, not Next.js)
- Root `TIMELINE.md` replaced by `docs/timeline.md`
- Timestamps (HH:MM) added to all ADR decision dates and index

### Removed
- Dead frontend code: `src/lib/websocket.ts` (61 lines, never used), `src/lib/supabaseClient.ts` (3 lines, duplicate of Edge Function client)
- Dead backend stubs from `supabase/functions/server/lib/`: `deviceRegistry.ts` (204 lines), `redis.ts` (148 lines), `solanaService.ts` (168 lines), `supabaseClient.ts` (28 lines) — all unused legacy stubs with incompatible interfaces

### Added
- ADR-007: Fix Merkle tree and define on-chain schema before blockchain integration — establishes priority order: fix Merkle tree → define NFT metadata schema → define anchoring format → implement Solana integration. Defers MQTT migration and send interval reduction
- ADR-008: Solana devnet over testnet — standardizes on devnet for development and academic validation, skipping testnet entirely (devnet → mainnet path)

> Blockchain planning documented in [ADR-007](adr/007-merkle-tree-before-blockchain.md) and [ADR-008](adr/008-solana-devnet-over-testnet.md)

---

## Phase 8 — Binary Merkle tree with inclusion proofs (10 Mar 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Changed (backend — Edge Function)
- Replaced linear hash (`SHA-256(concat(all_hashes))`) with proper binary Merkle tree: pair-wise hashing, odd leaves duplicated, domain-separated leaf nodes (`SHA-256(readingHash)`)
- Empty tree root is now deterministic: `SHA-256('') = e3b0c44...` (was `crypto.randomUUID()`)
- Deterministic sort before tree construction: readings sorted by timestamp ascending, then by ID as tiebreaker
- New module `supabase/functions/server/lib/merkle.ts`: `buildTree()`, `generateProof()`, `verifyProof()`, `sha256Hex()`
- Replaced all 6 callsites of old `calculateMerkleRoot` in `index.ts`
- Enhanced `GET /sensors/:id/hourly-merkle` and public equivalent to return `leafCount` and `leaves[]`
- Enhanced `POST /verify/merkle` with inclusion proof mode (`leafHash + proof + merkleRoot`)
- New endpoint `GET /sensors/:id/merkle-proof/:leafIndex` (authenticated)
- New endpoint `GET /public/sensors/:sensorId/merkle-proof/:leafIndex` (public)

### Added (frontend)
- `src/lib/merkle.ts`: browser-side verification via Web Crypto API (`verifyMerkleProof()`, `verifyMerkleRoot()`)
- `src/lib/types.ts`: `MerkleProofStep`, `MerkleProofData` types
- `src/lib/api.ts`: `merkleAPI.getProof()`, `publicAPI.getPublicMerkleProof()` methods

### Changed (frontend)
- `sensor-detail.tsx`: replaced fake `handleVerifyMerkle` (setTimeout + toast) with real client-side tree reconstruction and root comparison
- `public-sensor-detail.tsx`: same real verification for public sensor view
- `audit.tsx`: replaced 3 fake verifications (Quick Verify, Merkle root input, single hash input) with real cryptographic verification; updated "How to Verify Independently" instructions to describe binary Merkle tree algorithm

### Fixed
- Removed Deno-only JSR packages (`@jsr/std__crypto`, `@jsr/supabase__supabase-js`) and `hono` from root `package.json` — these caused `yarn install` failure on Vercel (JSR registry unreachable from npm)

> Merkle tree decision documented in [ADR-007](adr/007-merkle-tree-before-blockchain.md)

---

## Phase 9 — Bug fixes and KV store pagination (16 Mar 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Fixed (frontend)
- SVG sparkline rendering error (`<polyline> attribute points: Expected number`): replaced percentage-based coordinates (`"0%,100%"`) with numeric values and `viewBox="0 0 100 100"`; added `vectorEffect="non-scaling-stroke"` for consistent stroke width
- Division-by-zero guard: sparkline now requires `liveData.length > 1` (was `> 0`), preventing `NaN` when only one data point exists

### Fixed (backend — Edge Function)
- `GET /sensors/:id` returning 500: Merkle tree computation and dataset aggregation wrapped in individual try-catch blocks so a failure in either no longer crashes the entire endpoint (returns `hourlyMerkleRoot: null` gracefully)
- Same defensive handling applied to `GET /public/sensors/featured`
- **KV store 1000-row ceiling:** `getByPrefix()` was hitting Supabase JS client's default 1000-row limit, silently truncating readings, stats, and Merkle trees. Replaced single query with paginated `.range()` loop in 1000-row pages until all rows are fetched

### Removed
- Stale git worktrees (`fervent-shamir`, `recursing-curran`) — cleaned up after verifying no pending changes

---

## Phase 10 — Schema normalization, readings migration to PostgreSQL, WiFi geolocation (17 Mar 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Fixed (database — schema normalization)
- **Production `devices` table renamed from camelCase to snake_case:** `publicKey` → `public_key`, `macAddress` → `mac_address`, `nftAddress` → `nft_address`, `txSignature` → `tx_signature`, `lastTsSeen` → `last_ts_seen`, `claimToken` → `claim_token`, `ownerAddress` → `owner_address`
- Added `id UUID` primary key to `devices` (was using `publicKey` as PK)
- Added missing columns to `devices` in production: `name`, `type`, `description`, `visibility`, `mode`, `status`, `owner_wallet`, `owner_user_id`, `thumbnail_url`, `created_at`, `updated_at`
- Local migration `002_fix_schema_gaps.sql`: creates `kv_store_4a89e1c9` table, adds IoT columns (`challenge`, `nft_address`, `tx_signature`, `last_ts_seen`, `revoked`), geolocation columns (`location`, `latitude`, `longitude`, `location_accuracy`), and composite index `idx_sensor_readings_nft_ts`
- All Edge Function queries updated to use snake_case column names (8 callsites in `register-device`, `sensor-data`, and `resolveNftAddress`)

### Changed (backend — readings migration from KV to PostgreSQL)
- **Eliminated O(n) KV store scans for readings:** all 15 `kv.getByPrefix('reading:...')` callsites replaced with `getSensorReadings()` helper that queries `sensor_readings` PostgreSQL table directly via index scan
- New `countSensorReadings()` helper uses `SELECT count` for stats/featured (avoids fetching all rows)
- Mock sensors continue reading from KV store (fallback path preserved)
- `POST /sensor-data` no longer writes readings to KV store — only sensor metadata updates remain
- **Cleaned 9,482 stale reading entries from `kv_store`** — freed ~39 MB of storage (95% of KV usage)
- Readings count in featured/stats now shows correct total (was capped at 1,000 by Supabase JS client default)

### Added (WiFi geolocation — ADR-009)
- `POST /server/device-location` endpoint: receives WiFi AP scan (BSSIDs + RSSI), queries Mylnikov API per BSSID, computes RSSI-weighted centroid, reverse geocodes via Nominatim, stores location in `devices` table + KV sensor metadata
- ESP8266 firmware: `scanAndReportLocation()` scans nearby WiFi networks on boot, sends top 5 APs (BSSID + RSSI) to backend — fire-and-forget, non-blocking
- Frontend: location display with MapPin icon in sensor-card, sensor-detail, and public-sensor-detail; coordinate display with accuracy when available
- Geolocation columns added to `devices`: `location` (text), `latitude`, `longitude`, `location_accuracy` (numeric)

### Known issue
- **Mylnikov API has poor coverage in Brazil** — the 5 BSSIDs scanned by the ESP8266 returned HTTP 422 (not found). Needs alternative provider (Apple WiFi DB via Cloudflare Worker is available in `wifi-geolocate-worker/` but not yet deployed)

### Verified
- 32/32 local test suite passing
- Production sensor (DHT11) continues receiving data normally (28.8°C @ 22:31 UTC)
- Readings count in production correctly shows 9,735 (was stuck at 1,000)

---

## Phase 11 — Frontend styling polish and sentence case (20 Mar 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Changed (frontend)
- **SensorCard:** centered Stored/Readings metrics in their boxes; added `formatDataSize` utility (`src/lib/format.ts`) for human-readable byte formatting
- **Home page featured sensors:** redesigned section with responsive grid layout (1-col mobile, 2-col tablet, 3-col desktop), ready for multiple sensors; replaced inline Tailwind v4 responsive classes with plain CSS `@media` queries to work around specificity issues
- **Public sensors page:** tightened header padding, added sensor count badge, adaptive grid layout based on sensor count (centered single sensor, 2-col for 2, 3-col for 3+), subtler info card styling
- **Sentence case:** converted ~30 UI strings across home, public sensors, and sensor card from Title Case to sentence case (e.g., "Featured Public Sensors" → "Featured public sensors", "View Details" → "View details")

### Fixed
- Tailwind CSS v4 specificity bug: `flex-col md:flex-row` and `grid-cols-3` responsive variants lost specificity in generated CSS — workaround uses `.featured-spotlight` and `.featured-metrics` CSS classes with `@media` queries

---

## Phase 12 — README rewrite to reflect current stack and features (22 Apr 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Changed
- `README.md` rewritten to match current state of the project after Phases 8–11:
  - Stack corrected from "Next.js + Tailwind" to Vite + React + TypeScript (Next.js code was moved to `_reference/` back in Phase 4)
  - Framing broadened from environmental-data product to hardware-agnostic DePIN infrastructure platform (aligned with `CLAUDE.md`), mentioning retail analytics / TinyML as an example application being built on top
  - Added sections for binary Merkle tree with client-side inclusion proofs (Phase 8) and WiFi-based geolocation via Apple WiFi DB / Cloudflare Worker (Phase 10)
  - Public API table rebuilt with the real endpoints exposed by the Edge Function today (including `/public/sensors/:sensorId/merkle-proof/:leafIndex`, `/server/device-location`, `/verify/merkle`)
  - Storage description corrected: "In-memory Redis-like layer" replaced by Supabase KV table (`kv_store_4a89e1c9`) used only for sensor metadata and datasets; readings live in PostgreSQL (Phase 10)
  - Added references to `docs/timeline.md`, `docs/adr/`, and `CLAUDE.md`

### Fixed
- Broken documentation links removed: `BACKEND_INTEGRATION_GUIDE.md` and `API_QUICK_REFERENCE.md` (did not exist)
- Placeholder URLs replaced: `github.com/your-username/SparkedSense.git` → `github.com/viniciomendesr/sparkedsense.git`

> PR [sparkedsense#10](https://github.com/viniciomendesr/sparkedsense/pull/10) — squash merged into `main` (`f0d60e6`)

---

## Phase 13 — Sensor-agnostic ingestion envelope (in progress, target 2026-04-24)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Scope
- Adopt CloudEvents-compatible envelope with SenML-compatible payloads for the ingestion layer, per [ADR-010](adr/010-sensor-agnostic-ingestion-envelope.md).
- Single endpoint `POST /reading` supersedes the shape implied by `POST /sensor-data`; legacy endpoint becomes an adapter that wraps DHT11 payloads into `io.sparkedsense.sensor.environmental` envelopes.
- New platform-blessed event types (`sensor.environmental`, `inference.classification`, `inference.transcription`, …) under reverse-DNS namespace `io.sparkedsense.*`.
- Frontend type-dispatched renderer framework; first three renderers needed for the 2026-04-24 demo (environmental SenML, acoustic classification from ESP32-S3, transcription from MacBook MEC gateway).

### Rationale for ordering vs. other pending work
- Hard demo deadline (2 days) imposes a freeze on refactors with wide blast radius. Items pending from [ADR-007](adr/007-merkle-tree-before-blockchain.md) (NFT metadata schema, anchoring transaction format, real Solana devnet integration) are orthogonal to the envelope shape and deferred.
- Backend modularization (`supabase/functions/server/index.ts` at 1900+ lines) is a soft prerequisite that was intentionally **not** done first: risk of regressions in working code outweighs the cleanup benefit at this horizon. Instead, ADR-010 code ships as new modules (`ingest.ts`, `schemas/`) alongside the monolith; extraction of legacy handlers follows post-demo.
- WiFi geolocation with Brazil coverage (pending in Phase 10) is already resolved: backend actively uses `GEOLOCATE_WORKER_URL` pointing at the Cloudflare Worker (Apple WiFi DB), not Mylnikov.

### Conscious bets
- The adapter preserves production DHT11 — no firmware change required for the existing sensor to keep reporting during and after the migration.
- `sensor_readings_compat` view projects SenML records back into the legacy shape so the current frontend keeps working while renderers for new modalities are added.
- The author's concurrent undergraduate research (heterogeneous Edge AI inference aggregation) composes on top of this layer without blurring platform vs. research boundaries.

### Status
- [x] ADR written and merged, status **Accepted** (this phase marks the transition from Proposed).
- [x] `docs/event-types/` with JSON Schemas for eight platform-blessed types (`sensor.environmental`, `sensor.generic`, `inference.classification`, `inference.regression`, `inference.detection`, `inference.transcription`, `inference.semantic_summary`, `raw.audio`).
- [x] Migration `003_readings_envelope.sql` creating `readings` table + `sensor_readings_compat` view.
- [x] Backend `POST /reading` with envelope shape validation, secp256k1 verification over canonical JSON (recursive key sort), and lightweight typed-payload validation.
- [x] Backend adapter: `POST /sensor-data` dual-writes SenML envelopes into `readings` so the live DHT11 enters the new feed without a firmware change.
- [x] Frontend type-dispatched renderer framework in `src/components/renderers/` (environmental SenML, classification, transcription, generic fallback).
- [x] Page `/demo-claro` consuming the new `/public/readings-v2/:sensorId` feed; verified end-to-end with real hardware (11 envelopes rendered live from the production DHT11).
- [ ] ESP32-S3 acoustic client emits envelopes directly (not wrapped); MacBook whisper gateway emits envelopes — pending firmware/client code for the demo.

> Implementation order and risks documented in [ADR-010](adr/010-sensor-agnostic-ingestion-envelope.md). This phase is intentionally open until the demo stabilizes, at which point items 8–9 of the ADR's implementation order (deprecation window, quickstart documentation) move to a future phase.

---

## Phase 14 — Pre-demo UX polish and security hardening (22 Apr 2026)

**Contributor:** Vinicio Mendes (with AI assistance — Claude)

### Added (sensor-agnostic envelope — ADR-010 continuation)
- [ADR-011](adr/011-unsigned-dev-bypass-for-unported-devices.md): `signature: "unsigned_dev"` bypass accepted in `POST /server/reading` for devices whose firmware has not yet ported the secp256k1 signing pipeline. Device identity still enforced via the `source` → registered `public_key` lookup. `TODO(ADR-011)` anchor in the code marks the removal trigger (Node 2 ESP32-S3 port landing with 100 consecutive valid signatures).

### Added (sensor UX)
- **Edit title/description from the owner view** ([src/components/edit-sensor-dialog.tsx](../src/components/edit-sensor-dialog.tsx)): pencil icon next to the header, dialog with validation, `sensorAPI.update` call. Backend allowlist restricts mutable fields to `['name', 'description', 'visibility']` — `location`/`latitude`/`longitude` explicitly rejected server-side because they are firmware-derived signals (preserves ADR-003 trust model).
- **Location label includes neighborhood** ([supabase/functions/server/index.ts](../supabase/functions/server/index.ts) `buildLocationText`): reverse-geocode prioritises `suburb → neighbourhood → quarter → city_district → residential` before the city. Existing sensor `36c1d3d2-...` self-updated from `São Paulo, São Paulo, Brasil` to `Pinheiros, São Paulo, São Paulo, Brasil` via the new `POST /sensors/:id/refresh-location` endpoint (owner-only, re-geocodes from stored lat/lng only — does not accept client-supplied coordinates).
- **Chart redesign in crypto style** ([src/components/sensor-chart.tsx](../src/components/sensor-chart.tsx)): shared `SensorChart` component with stats header (current value, absolute delta, percentage delta, trend-coloured), Min/Max/Avg/Points badges, gradient area fill, dashed reference line at the mean, and a brush for zooming the historical range. Modes: `live` (last 60 points, no range selector) and `historical` (1H/6H/1D/1W/All selector + brush). Replaces the previous plain `LineChart` in both owner and public sensor detail pages.
- **Historical Data Feed section** shown below Real-Time Data Feed on both pages; owner view flattened the tab layout so `Live Data` and `Historical Data` live side by side inside `Live Stream`, matching the public layout.
- **`Last Updated` syncs with the latest reading** on the public page (was tied to `sensor.updatedAt` which lags the ingestion stream).

### Changed (backend)
- `getSensorReadings` now paginates via `.range(offset, offset + 999)` up to the requested limit. Supabase PostgREST silently caps responses at 1000 rows per default config; the historical chart was hitting that cap and showing an incomplete `Max` value. Pagination lets the 50,000-point historical query return the real dataset.
- `POST /sensor-data` dual-writes each reading into the new `readings` table as an `io.sparkedsense.sensor.environmental` envelope. The live DHT11 now populates both the legacy `sensor_readings` path and the ADR-010 feed consumed by `/demo-claro`.
- `sensorAPI.update` allowlist added: `['name', 'description', 'visibility']`. Any other field in the request body is silently discarded server-side.

### Fixed (deployment)
- **Vercel SPA 404 on refresh**: added `vercel.json` with a catch-all rewrite to `/index.html`. Previously, refreshing on any client-side route (e.g. `/public-sensors`) bypassed React Router and hit Vercel's file-system 404.
- **`.DS_Store` untracked from git** and added to both the project `.gitignore` and the machine-global `~/.gitignore_global`.

### Security (migration `004_security_hardening.sql`)
Supabase advisor reported 5 ERROR + 4 WARN; migration 004 drove it to 0 ERROR + 1 WARN + 2 INFO.

- Enabled RLS on `devices`, `sensor_readings`, `sensor_metrics`.
- Added owner-only SELECT policy on `devices` — `mac_address` (PII) is no longer exposed to anon or to other owners via direct PostgREST.
- Recreated `sensor_readings_compat` view with `WITH (security_invoker = true)` so the view respects the caller's RLS instead of the creator's.
- Replaced the `USING (true)` policy on `kv_store_4a89e1c9` with `TO service_role` scope.
- Pinned `search_path = public, pg_catalog` on `update_updated_at_column` and `update_sensor_metrics` to prevent schema-shadowing attacks.
- Edge function keeps working because `SERVICE_ROLE` bypasses RLS. PostgREST calls from anon/authenticated now correctly return empty arrays for `devices` and `sensor_readings`.
- Remaining WARN (`auth_leaked_password_protection`) must be toggled in the Supabase Auth dashboard — not actionable via SQL.

---

## Current status

**Implemented:** End-to-end DePIN flow with secp256k1 cryptographic authentication, simulated digital identity (nftAddress), real-time dashboard with crypto-style live + historical charts (Min/Max/Avg/Points, gradient fill, timeframe selector, brush zoom), binary Merkle tree with inclusion proofs for dataset integrity verification (client-side and server-side), PostgreSQL as canonical storage for sensor readings (KV store retained only for sensor metadata and datasets), Solana devnet wallet under project control, homepage with Featured Public Sensors, WiFi-based geolocation with neighborhood label via Apple WiFi DB through Cloudflare Worker, owner-editable sensor name/description, RLS hardening across `devices`/`sensor_readings`/`sensor_metrics` and security_invoker view. Structured documentation with ADR index and timeline in `docs/`.

**In progress (Phase 13, target 2026-04-24):** Sensor-agnostic ingestion envelope per [ADR-010](adr/010-sensor-agnostic-ingestion-envelope.md) — CloudEvents + SenML adoption, `POST /reading` endpoint live with dual-write from legacy `/sensor-data`, renderer framework for heterogeneous modalities (environmental telemetry, ML classification, transcription). Remaining: ESP32-S3 acoustic client + MacBook whisper gateway emitting envelopes directly. During the demo window, Node 2 events use the [ADR-011](adr/011-unsigned-dev-bypass-for-unported-devices.md) `unsigned_dev` bypass until the signing pipeline is ported.

**Next steps (from ADR-007, deferred until post-demo):**
1. ~~Fix Merkle tree implementation~~ — done (Phase 8)
2. ~~Deploy WiFi geolocation provider with Brazil coverage~~ — done (Apple WiFi DB via Cloudflare Worker, env `GEOLOCATE_WORKER_URL` in use)
3. Define NFT metadata schema for device identity
4. Define anchoring transaction format (Memo Program vs metadata update vs PDA)
5. Implement real Solana devnet integration (NFT minting + dataset anchoring)

**Also pending (post-demo):** ESP32-S3 secp256k1 signing pipeline port (removes [ADR-011](adr/011-unsigned-dev-bypass-for-unported-devices.md) bypass), firmware resilience (WiFi reconnection, watchdog, HTTPS timeout — see audit), backend modularization (`index.ts` split), open source documentation, ESP8266 migration from legacy `POST /sensor-data` to native envelope emission (see ADR-010 item 8), server-side downsampling (LTTB) for charts as sensors grow past ~200k readings, Supabase Auth `leaked_password_protection` toggle via dashboard.
