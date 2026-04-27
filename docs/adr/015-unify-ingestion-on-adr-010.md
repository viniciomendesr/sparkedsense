# ADR-015: Unify ingestion on `/server/reading` (ADR-010 envelope)

**Date:** 2026-04-25
**Status:** Accepted (read-side union implemented 2026-04-27)
**Supersedes (in part):** ADR-003 (`/server/sensor-data` is deprecated for new ingestion)

## Context

Historically, two ingestion endpoints have coexisted:

- **`/server/sensor-data`** (ADR-003, "legacy"): payload shape is `{ nftAddress, signature: {r, s}, payload: { temperature, humidity, timestamp } }`. The signature is secp256k1 over canonical JSON of the payload. Writes go to `sensor_readings` keyed by `nft_address`. The current ESP8266 + DHT11 sensor (Nó #1 prod) uses this path.
- **`/server/reading`** (ADR-010, "envelope"): payload is a CloudEvents 1.0 envelope with sensor-agnostic types and a top-level `signature` extension. Writes go to `readings` keyed by `device_id`. Node 2 (ESP32-S3) and any future device uses this path.

This duplication has costs:

- Two storage tables to query (`sensor_readings` vs `readings`) — `getSensorReadings` already has multiple branches.
- Two signature verification implementations.
- Two operational telemetry surfaces (rate limit, metrics).
- New ADR-014 deferred-mint flow only makes sense on the envelope path (the legacy path is keyed by `nft_address`, which doesn't exist until mint).

Continuing to support both encodes the legacy decision into every new feature.

## Decision

**All new ingestion goes through `/server/reading`. The legacy `/server/sensor-data` endpoint is deprecated.**

### Migration plan (hard cutover, history preserved)

1. **Update Nó #1 firmware** to publish ADR-010 envelopes:
   - Same secp256k1 keypair (no identity change — the existing NFT remains valid).
   - `source: "spark:device:<pubkey_hex>"` matches `devices.public_key`.
   - `type: "io.sparkedsense.sensor.environmental"`, `data` is a SenML record array `[{n: "temperature", v: 25.6, u: "Cel"}, {n: "humidity", v: 56, u: "%RH"}]`.
   - `signature` is hex secp256k1 over canonical JSON of the envelope minus the `signature` field (per ADR-010 spec).
   - Publish cadence and rate-limit behavior unchanged.
2. **Backend continues to read from `sensor_readings`** for any sensor that has historical rows there. The `getSensorReadings` real-mode branch already does this. The ADR-010 path writes to `readings`; the real-mode reader can union both tables for the same sensor during the transition window.
3. **`/server/sensor-data` returns HTTP 410 Gone** for new POSTs once the firmware migration confirms. Body explains the migration: `{ "error": "endpoint deprecated; migrate to /server/reading per ADR-015" }`. Reads via existing internal helpers continue to work.
4. **`sensor_readings` table is frozen** — no new inserts. Stays queryable forever for historical audit. Datasets created from this period reference rows in this table; their Merkle proofs remain valid.

### What is NOT changed

- The ESP8266 keypair and minted NFT — Nó #1 keeps its current identity (`nft_address`, `claim_token`). Only the transport changes.
- The `sensor_readings` table schema — no migration of historical rows. Reading old data continues to work.
- Dataset anchoring (ADR-007) — Merkle proofs of pre-cutover datasets remain valid because the underlying rows are immutable.
- Rate limit and revocation behavior — same semantics, just enforced on the envelope path.

### Backwards-compatibility shim

For at least one release after the firmware update, `/server/sensor-data` will keep accepting writes (to absorb any device that flashes late). After confirmation that no device is hitting the legacy endpoint for ≥ 7 days, it returns 410 Gone.

## Consequences

### Positive

- **Single ingestion code path** — easier to reason about, easier to add features (new sensor types, new validators, new trust models).
- **Single storage destination** for new data (`readings` table) — simpler queries, simpler aggregation.
- **ADR-014 deferred mint becomes uniformly available** — every device starts on the envelope path, registered in `devices`, regardless of mint status.
- **Reduced surface area** for security review (one signature verification implementation, one rate limiter).

### Negative

- **One-time firmware reflash** for Nó #1 (operational coordination).
- **`getSensorReadings` real-mode branch grows complexity** during the transition (must read both `sensor_readings` and `readings`). This goes away once we're confident no further legacy writes will happen.
- **Existing audit links** to `sensor_readings`-based datasets remain valid but reference a frozen table — confusing if someone reads the schema and sees old rows.

### Risks

- **Firmware deployment failure**: if the new envelope code has a bug we haven't caught, Nó #1 stops publishing. Mitigation: keep `/server/sensor-data` accepting writes during the firmware update window so a hot rollback is possible.
- **Hash/signature drift between old and new format**: the canonical JSON serialization rules must be implemented identically on the ESP8266 (no JSON library; sprintf-based) and the backend (`canonicalJson` in `lib/ingest.ts`). Test rigorously before flashing the device.

## Implementation

1. Implement firmware ADR-010 publisher for ESP8266 + DHT11 (mirror of [`ESP/esp32s3/esp32s3.ino`](../../ESP/esp32s3/esp32s3.ino) structure but with SenML environmental envelope). Keep current pubkey.
2. Local test: validate envelope shape + signature using the existing backend's `verifyEnvelopeSignature` against captured payloads.
3. Flash Nó #1, observe parallel publishes (legacy + envelope) for ~24h, compare row counts and timestamps.
4. Stop legacy publishes (firmware-side flag).
5. Wait 7 days for any straggler.
6. Flip `/server/sensor-data` to return 410 Gone for new POSTs.
7. Update this ADR's status to `Implemented`.

### Implementation notes

- **2026-04-27** — Migration plan step 2 (read-side union) implemented in
  `getSensorReadings` and `countSensorReadings`. The real-mode branch now
  resolves `nft_address` (legacy) and `device_id` (envelope) in parallel and
  unions both tables before sorting/slicing. This fixes a class of bugs where
  sensors created as `mode: "real"` whose firmware actually publishes ADR-010
  envelopes (e.g. Node #2 acoustic, which uses the `unsigned_dev` bypass)
  surfaced an empty readings list while their `lastReading` KV mirror was
  populated. The union path is correct under
  `top-N-DESC(A ∪ B) = top-N-DESC(top-N-DESC(A) ∪ top-N-DESC(B))`.
- The legacy side keeps the parallel `.range()` paging up to `limit`. The
  envelope side caps at PostgREST's default 1000 rows per request, matching
  the unverified branch — sufficient for current chart windows; bumping this
  is straightforward when ADR-007 datasets need deeper history.
- Dataset Merkle proofs (ADR-007) are not affected: existing datasets continue
  to reference `sensor_readings` rows that remain immutable.

## References

- [ADR-003](003-secp256k1-signature-verification.md) — original signature/transport contract (deprecated for new ingestion).
- [ADR-010](010-sensor-agnostic-ingestion-envelope.md) — envelope shape that becomes universal.
- [ADR-014](014-deferred-nft-minting.md) — deferred mint flow that depends on this unification.
- Node 2 reference firmware: [`ESP/esp32s3/esp32s3.ino`](../../ESP/esp32s3/esp32s3.ino).
