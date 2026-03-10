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

## Current status

**Implemented:** End-to-end DePIN flow with secp256k1 cryptographic authentication, simulated digital identity (nftAddress), real-time dashboard with automatic polling for real sensors, binary Merkle tree with inclusion proofs for dataset integrity verification (client-side and server-side), dual-layer storage (PostgreSQL + KV store), Solana devnet wallet under project control, homepage with Featured Public Sensors. Structured documentation with ADR index and timeline in `docs/`.

**Next steps (from ADR-007):**
1. ~~Fix Merkle tree implementation~~ — done (Phase 8)
2. Define NFT metadata schema for device identity
3. Define anchoring transaction format (Memo Program vs metadata update vs PDA)
4. Implement real Solana devnet integration (NFT minting + dataset anchoring)

**Also pending:** Permanent sensing station setup (ESP8266 + DHT11 on continuous USB power), backend modularization, and open source documentation.
