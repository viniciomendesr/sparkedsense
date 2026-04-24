# Architecture Decision Records

Format: [ADR by Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — the most widely adopted ADR template in open source projects.

Each ADR documents a single architectural decision with its context, rationale, and consequences.

## Status definitions

- **Accepted** — Decision is in effect
- **Superseded by [ADR-XXX]** — Replaced by a newer decision
- **Deprecated** — No longer relevant but kept for historical reference

## Index

| ADR | Title | Status | Decision date | Documented |
|-----|-------|--------|---------------|------------|
| [001](001-stack-and-infrastructure.md) | Stack and infrastructure choices | Accepted | 2025-10-30 | 2026-03-10 16:51 |
| [002](002-unified-backend-edge-functions.md) | Unified backend in Supabase Edge Functions | Accepted | 2026-03-09 | 2026-03-10 16:51 |
| [003](003-secp256k1-signature-verification.md) | secp256k1 signature verification without BIP-0062 | Accepted | 2026-03-10 | 2026-03-10 16:51 |
| [004](004-dual-layer-storage.md) | Dual-layer storage: PostgreSQL + KV store | Partially superseded | 2026-03-10 | 2026-03-10 16:52 |
| [005](005-blockchain-identity-reset.md) | Blockchain identity reset and wallet ownership | Accepted | 2026-03-10 | 2026-03-10 16:52 |
| [006](006-cors-header-whitelisting.md) | CORS header whitelisting strategy | Accepted | 2026-03-10 | 2026-03-10 16:52 |
| [007](007-merkle-tree-before-blockchain.md) | Fix Merkle tree and define on-chain schema before blockchain integration | Accepted | 2026-03-10 | 2026-03-10 17:32 |
| [008](008-solana-devnet-over-testnet.md) | Solana devnet over testnet for development and academic validation | Accepted | 2026-03-10 | 2026-03-10 17:45 |
| [009](009-wifi-geolocation-for-sensors.md) | WiFi-based geolocation for physical sensors (Mylnikov API) | Accepted | 2026-03-17 | 2026-03-17 |
| [010](010-sensor-agnostic-ingestion-envelope.md) | Sensor-agnostic ingestion envelope via CloudEvents + SenML | Accepted | 2026-04-22 | 2026-04-22 |
| [011](011-unsigned-dev-bypass-for-unported-devices.md) | `unsigned_dev` signature bypass for devices without ported signing pipeline | Accepted | 2026-04-22 | 2026-04-22 |
| [012](012-solana-memo-anchoring.md) | Solana Memo Program anchoring for dataset Merkle roots (ADR-007 partial) | Accepted | 2026-04-22 | 2026-04-22 |
| [013](013-edge-function-jwt-disabled-for-device-ingestion.md) | Disable Supabase JWT gateway on the `server` Edge Function | Accepted | 2026-04-24 | 2026-04-24 |
