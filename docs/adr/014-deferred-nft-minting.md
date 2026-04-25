# ADR-014: Deferred NFT minting (`unverified` as the default sensor state)

**Date:** 2026-04-25
**Status:** Accepted
**Supersedes (in part):** ADR-003 (mint-first registration is no longer mandatory), ADR-012 (`unsigned_dev` is renamed and generalised)

## Context

The original sensor registration flow (ADR-003) required a device to mint an NFT on Solana **before** it could publish data. Concretely:

1. Device shows MAC + secp256k1 public key.
2. User submits to `/server/register-device` Step 1, gets a challenge.
3. Firmware signs the challenge with its private key.
4. Backend verifies the signature in Step 2, mints the NFT, returns a `claim_token`.
5. Only then can the firmware POST readings, signed with the device key.

This works for a single curated device but is the wrong default for a DePIN platform that wants commodity hardware to "just connect":

- **Hardware variability**: not every off-the-shelf microcontroller has a working secp256k1 signing pipeline on day one (ADR-011 captured this for ESP32-S3 / Edge Impulse).
- **Onboarding friction**: a Solana wallet, gas, and a successful onchain mint are heavy preconditions for a user who just wants to see live data.
- **Operator economics**: minting every node before it has produced any useful data is wasteful when many nodes are evaluation/short-lived.

ADR-012 introduced `unsigned_dev` mode as a transitional patch for the Claro 2026-04-24 demo (Node 2). The remediation path described there — keep the device pubkey, swap the firmware to sign, complete Step 2 later — turned out to be the right shape for the **general** case, not just demo-scope.

## Decision

Make **deferred minting** the default registration flow:

1. Device registers with MAC + pubkey (Step 1 of `/server/register-device`).
2. Sensor is created in mode **`unverified`** (renamed from `unsigned_dev`).
3. Readings start flowing immediately. Envelopes that arrive without a verifiable signature use the `signature: "unsigned_dev"` wire marker (ADR-011 unchanged — the marker is a property of the *event*, not the sensor).
4. At any later point, the user clicks **"Mint NFT"** in the sensor detail UI. This triggers Step 2 of `/server/register-device` from the **server's** Solana wallet (devnet only, see "Open questions" for mainnet).
5. On successful mint: sensor flips `mode: 'unverified' → 'real'`, gets `nft_address`, `claim_token`, and a `minted_at` timestamp.
6. Old readings (those received before `minted_at`) keep their original signature/marker. Going forward, firmware that signs envelopes produces normally-verified events; firmware that doesn't continues to use the bypass marker (with the consequence that those events stay outside the verifiable window).

### Why "unverified"

`unsigned_dev` was named for its narrow demo origin. Now that it's the **default first state** for any real device, the name should describe the property neutrally: an `unverified` sensor is one whose physical identity is registered but not yet anchored on-chain. The name carries no connotation of "temporary" or "broken" — many sensors may live in this state indefinitely.

The wire-protocol marker `"unsigned_dev"` in the envelope `signature` field is **kept as-is**. It describes the event ("this event has no cryptographic signature"), which is a different concept from sensor attestation status. Renaming it would break deployed firmware (Node 2) until reflashed and adds zero clarity.

### Mint payer (devnet today)

For the current devnet deployment, the **server wallet** (`SOLANA_SERVER_SECRET_KEY_BASE58`) pays mint fees. This:

- Removes any wallet-adapter dependency from the UI for now.
- Makes onboarding trivial — user clicks one button.
- Has no real economic cost on devnet.

For a future mainnet deployment, this changes (see Open questions).

### Datasets and trust

Datasets (ADR-007) anchored on-chain may include readings of any signature status. The dataset metadata records:

- `verified_event_count`: rows with a real secp256k1 signature.
- `unsigned_event_count`: rows with `signature = "unsigned_dev"`.
- `mint_status`: whether the source sensor was `verified`/`unverified` at the moment of dataset creation.

Auditors choosing a dataset see this composition explicitly. They can refuse to consume datasets that cross the unsigned/signed boundary, or accept them with the caveat that part of the data is unattested. This is the same trust-model honesty principle ADR-012 introduced for the dashboard card badge: surface attestation gaps, don't hide them.

## Consequences

### Positive

- **Lower onboarding friction** for new sensors. A user with an ESP32 + DHT11 can plug it in, see data flowing, and decide later whether to mint.
- **DePIN economics align**: mint cost is paid for sensors that proved useful, not speculatively.
- **Single registration code path**: removes the "Real Data Sensor" vs "Unsigned Physical Sensor" dialog branching introduced in ADR-012. Everyone enters the same way.
- **Trust model preserved**: anchoring still requires signed events; the platform never claims attestation it doesn't have.

### Negative

- **Two-step UX for users who want full attestation immediately** — they have to register, then mint. Mitigated by the mint button being one click from the detail page.
- **Server wallet becomes a per-mint cost on mainnet** unless the flow is extended to also support user-paid mints via wallet adapter. Devnet today, planning required for mainnet.
- **More state in the sensor lifecycle**: `unverified → real` transition needs explicit handling in audit and dataset code paths.

### Risks

- **Users may never mint**, leaving most of the network in `unverified` perpetually. This is fine for the trust model (badges are honest) but weakens the "DePIN with on-chain identity" narrative. Mitigation: roadmap mainnet flow with user-paid mints + economic incentives (e.g., tokenization tied to verified data).
- **`minted_at` cutoff complexity** for datasets that span the transition. Solution: explicit per-row signature classification in dataset metadata (already designed above).

## Implementation

This ADR is realised across multiple PRs:

1. **Rename `unsigned_dev` → `unverified`** in TypeScript types, backend mode checks, KV records (with read-time normalisation for backwards compat), and UI labels. Envelope wire marker stays `"unsigned_dev"`.
2. **Mint endpoint**: `POST /server/sensors/:id/mint` (auth: sensor owner). Server wallet executes the existing Step 2 flow internally. Returns updated sensor.
3. **UI mint button**: surfaces in `sensor-detail.tsx` for `unverified` sensors, calls the endpoint, refreshes state.
4. **Dataset relaxation**: remove the implicit assumption that all dataset rows are signature-verified. Add the metadata fields above.
5. **Drop the "Unsigned Physical Sensor" card** in `register-sensor-dialog.tsx` — every physical sensor uses the new path. Mock Data card remains.

## Open questions

- **Mainnet mint payer**: when we leave devnet, the user's wallet (Phantom/Solflare via wallet adapter) should pay. ADR to be written when mainnet deployment is on the table.
- **Should historical `real` sensors (e.g., Nó #1 prod) be migrated to start their lifecycle at `unverified` and mint?** No — they're already minted; the migration is purely conceptual (rename in metadata). New ADR-015 covers the transport migration.

## References

- [ADR-003](003-secp256k1-signature-verification.md) — original mint-first signature contract (this ADR relaxes the timing).
- [ADR-007](007-merkle-tree-before-blockchain.md) — dataset Merkle anchoring (extended here with mixed-signature metadata).
- [ADR-010](010-sensor-agnostic-ingestion-envelope.md) — envelope shape carrying the `unsigned_dev` wire marker.
- [ADR-011](011-unsigned-dev-bypass-for-unported-devices.md) — bypass marker semantics (unchanged, generalised by this ADR).
- [ADR-012](012-unsigned-dev-sensor-mode.md) — predecessor sensor mode, now superseded by `unverified` naming.
