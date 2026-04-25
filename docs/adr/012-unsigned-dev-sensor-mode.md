# ADR-012: `unsigned_dev` sensor mode in dashboard for devices in ADR-011 transition

**Date:** 2026-04-23
**Status:** Accepted — demo-scope, will evolve after Node 2 signing pipeline is ported

## Context

The dashboard currently exposes two sensor modes at registration time, via the `ChooseSensorMode` dialog:

- **Real Data Sensor** — physical device with secp256k1 keypair, triggers challenge-response via `/server/register-device` Step 1 and 2, mints an NFT on Solana devnet for on-chain ownership, writes to `readings` via `/server/sensor-data` (legacy) or `/server/reading` (ADR-010 envelope) with cryptographically verified signatures.
- **Mock Data Sensor** — no physical device, backend generates synthetic readings on a periodic timer for visualization and testing.

ADR-011 introduced a third operational state for real devices whose signing pipeline has not been ported yet (currently Node 2, ESP32-S3). These devices:

- Publish **real** data from real sensors (not synthetic).
- Do **not** produce cryptographic signatures; they send the literal `"unsigned_dev"` marker in the envelope.
- Are **not** anchored on-chain (no NFT minted), because the challenge-response in `/server/register-device` Step 2 requires signing a challenge with a private key the device does not possess.

The existing two modes do not represent this state accurately:

- Using **Real Data Sensor** is infeasible: Step 2 of registration fails without a valid signature.
- Using **Mock Data Sensor** is semantically wrong and operationally dangerous. The backend would generate synthetic readings on a timer that would interleave with the real POSTs from the physical device under the same `sensor_id`, producing a mixed stream the dashboard renders without any way to tell apart. This violates the platform's trust contract (readings can no longer be reasoned about) and silently corrupts the demonstration data.

The demo on 2026-04-24 needs Node 2 on the dashboard as a first-class card, with truthful representation of its attestation status.

## Decision

Introduce a **third sensor mode**: `unsigned_dev`. This mode is applied to physical devices that publish real data via the ADR-010 envelope path with the `signature: "unsigned_dev"` marker, while the signing pipeline is being ported.

### Surface changes

**TypeScript type (`src/lib/types.ts`)**
```typescript
mode: 'mock' | 'real' | 'unsigned_dev';
```

**UI dialog (`src/components/choose-sensor-mode-dialog.tsx`)**
Add a third card adjacent to Real Data / Mock Data:

- Label: **"Unsigned Physical Sensor"**
- Description: "Physical device that publishes real readings but whose cryptographic signing pipeline is still being ported. Events are accepted under ADR-011 bypass; no NFT is minted until signing is complete."
- Icon: lock with slash (or similar) to signal the attested gap.

**Registration flow (`src/components/register-sensor-dialog.tsx` and backend)**
The `unsigned_dev` mode skips the Connect-to-Blockchain step entirely. Registration completes after filling Name/Description/Location/Type/MAC/Device Public Key. The backend row in `devices` is created via `/server/register-device` Step 1 only; no challenge-response, no `nft_address`, no `claim_token`.

**Sensor card badge (`src/components/sensor-card.tsx`)**
Three badge variants, color-coded:

- `Real Data` + `NFT Sensor` (current) — full trust chain
- `Mock` (current) — synthetic data
- **`Unsigned Dev`** (new) — real physical data, signature bypass active per ADR-011

The badge is explicit about what the card represents. Observers know, at a glance, which readings carry cryptographic attestation and which do not.

**Backend ingestion (`supabase/functions/server/index.ts`)**
No change to `/server/reading` handler — already accepts `unsigned_dev` signature per ADR-011. The `sensors` entity gains a `mode` field already present in the schema; new enum value `unsigned_dev` is valid.

**Audit and dataset tooling**
Any downstream aggregator or Merkle tree builder (ADR-007) must filter by `signature != 'unsigned_dev'` when producing anchored datasets, or explicitly tag the dataset as including unsigned events. Unsigned events are **not** eligible for on-chain anchoring until remediated.

### What is not changed

- ADR-003 contract for `/server/sensor-data` (legacy path, full signing) is untouched.
- ADR-010 envelope shape is unchanged; `unsigned_dev` is a valid value for `signature` per the regex in `validateEnvelopeShape`.
- Rate-limit, device-not-registered, device-revoked responses are the same as Real Data path.

## Consequences

### Positive

- **Truthful representation.** The dashboard renders what the sensor actually is, not a fiction that fits one of two categories.
- **No data corruption from Mock interference.** Real POSTs flow to `readings` without competing with synthetic timer-generated rows.
- **Reusable pattern.** Any future sensor that enters the platform during a signing-pipeline porting period uses this mode without needing an ADR per sensor.
- **Audit-friendly.** Filtering `readings` by `signature = 'unsigned_dev'` or joining with `sensors.mode = 'unsigned_dev'` yields the set of events that need reattestation after remediation.
- **Narrative strength for institutional demo.** The card with the `Unsigned Dev` badge is visible evidence that the platform represents its trust model accurately during evolution, not only at steady state.

### Negative

- **Three modes instead of two.** UI surface grows by one option; users must understand which applies. Mitigated by the description text in the dialog and by the fact that `unsigned_dev` should be a transitional state for each sensor, not permanent.
- **More code paths to maintain.** Each feature that depends on sensor mode (audit pages, dataset anchoring, notifications) must handle the new value. Mitigated by TypeScript exhaustive switches in all consumers.

### Risks

- **Risk of permanence by convenience.** `unsigned_dev` could become the default for new sensors because it is easier than doing the full Real Data registration with Solana. Mitigation: the `ChooseSensorMode` dialog copy for this option reads "while signing pipeline is still being ported", framing it as a transitional state; dashboard card badge is visually distinct and suggests incompleteness.
- **Risk of users confusing Mock and Unsigned Dev.** Both lack NFT; both look similar at a glance. Mitigation: distinct icon (lock with slash vs test tube), distinct badge color, distinct copy — Mock says "automatic fake readings", Unsigned Dev says "real readings, signature pending".

## Remediation path (sensor-level)

When Node 2's signing pipeline is ported (tracked by ADR-011 remediation trigger):

1. The device keeps its `public_key` and `mac_address` in `devices` table.
2. Firmware starts signing envelopes instead of sending `unsigned_dev`.
3. A UI action "Complete registration" (not yet designed) triggers Step 2 of `/server/register-device` — challenge + signature verification.
4. On success, device receives `nft_address` and `claim_token`; sensor `mode` transitions from `'unsigned_dev'` to `'real'`.
5. Historical unsigned readings remain in `readings` with their `signature = 'unsigned_dev'` marker; downstream tooling decides whether to exclude from datasets or tag as such.

This transition is reversible in the sense that the device identity (pubkey) is preserved throughout; no new keypair is issued. What changes is the attestation status of subsequent events.

## References

- [ADR-003](003-secp256k1-signature-verification.md) — signature contract this mode acknowledges as temporarily unfulfilled
- [ADR-010](010-sensor-agnostic-ingestion-envelope.md) — envelope shape that carries the `unsigned_dev` marker
- [ADR-011](011-unsigned-dev-bypass-for-unported-devices.md) — backend acceptance of the marker at `/server/reading`
- Demo plan: `IC_TF_off/MVPs/Demo-Claro/2026-04-22_plano_demo_claro_v3.md`
- Node 2 firmware: [`ESP/esp32s3/esp32s3.ino`](../../ESP/esp32s3/esp32s3.ino) — moved into the platform repo on 2026-04-25 (was previously `IC_TF_off/MVPs/Demo-Claro/node2_fase4_kws_publisher/`)
