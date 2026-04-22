# ADR-011: `unsigned_dev` signature bypass for devices without ported signing pipeline

**Date:** 2026-04-22
**Status:** Accepted — technical debt with open remediation date

## Context

ADR-003 established that all sensor readings arriving at the Sparked Sense ingestion path must carry a valid secp256k1 signature over canonical JSON, verified server-side before persistence. That contract was implemented for the ESP8266 firmware (`ESP/ESP.ino`) and extended to the new sensor-agnostic envelope in ADR-010 (`lib/ingest.ts` → `verifyEnvelopeSignature`).

The demo Claro of 2026-04-24 introduces two new nodes that publish to `POST /server/reading`:
- **Node 2** — ESP32-S3 MC N16R8 + Sipeed I²S microphone, acoustic classifier (Edge Impulse MFCC + CNN-1D INT8)
- **Node 3** — MacBook as MEC gateway, faster-whisper transcription

Node 3 can sign natively via `@noble/curves`. Node 2 cannot, not because of hardware limitation but because of timeline: porting the existing ESP8266 signing pipeline (uECC + SHA-256 canonicalization over the full envelope + UUID v4 generation from `esp_random`) to ESP-IDF on the ESP32-S3 is estimated at 4–6 hours of focused work plus 2 hours of end-to-end validation. The demo is 48 hours away, with the rest of Bloco 5 already carrying VAD hysteresis implementation, LAN audio transport, INMP441 fallback decision, integrated 3-run regression, and fallback video recording. A failed port would consume the entire night and cascade into missed dependencies downstream.

Three options were evaluated:

1. **Port the signing pipeline before the demo.** Rejected — asymmetric risk. If the port fails, we lose not just Node 2 signing but also VAD, LAN transport, and Node 3 integration that depend on Node 2's firmware being stable. Failure is destructive, not just incomplete.

2. **Skip Node 2 entirely and demo only with Node 1 + Node 3.** Rejected — Node 2 is the centerpiece of the CPA Edge AI pillar (Beat 3 of the demo narrative). Cutting it collapses a third of the argument.

3. **Accept a marked-unsigned path in the server for devices with unported signing, remove after the port lands.** Accepted — reversible, auditable, time-limited by the port deadline.

## Decision

Add a single branch to the `POST /server/reading` handler (`supabase/functions/server/index.ts`) that treats the literal string `"unsigned_dev"` in the `signature` field of the CloudEvents envelope as an explicit marker of an unsigned event:

```typescript
if (envelope.signature === "unsigned_dev") {
  // TODO(ADR-011): remove after ESP32-S3 signing pipeline is ported.
  // Accepts events from devices whose firmware has not yet implemented
  // secp256k1 canonical-JSON signing over the envelope. Device identity
  // is still checked via the `source` field resolving to a registered
  // public key in the `devices` table.
  console.warn(`⚠️  Accepting unsigned event from ${envelope.source} (ADR-011 bypass)`);
} else {
  const validSig = await verifyEnvelopeSignature(envelope, device.public_key);
  if (!validSig) {
    return c.json({ error: 'Invalid signature', code: 'bad_signature' }, 401);
  }
}
```

The bypass preserves all other validation (envelope shape, device registration lookup, rate limiting, platform-type payload validation). It drops **only** the cryptographic signature verification.

Events ingested via the bypass are stored in the `readings` table with `signature = "unsigned_dev"` as a persistent marker. A downstream auditor can filter unsigned events with `WHERE signature = 'unsigned_dev'`.

## Consequences

### Positive
- Node 2 (ESP32-S3) can publish to the new ingestion endpoint during the 2026-04-24 demo without firmware changes.
- The bypass is auditable at query time via the stored `signature` value — unsigned events are not disguised as signed.
- The bypass is reversible: removing the `if` branch restores ADR-003 invariant without touching any other code.
- Node 1 (ESP8266) remains fully signed on the legacy `/sensor-data` path, preserving six weeks of uninterrupted signed-ingestion history.

### Negative
- Any device that knows the pattern can publish as any registered device by setting `source: spark:device:<target_pubkey>` and `signature: "unsigned_dev"`. **This is a real trust regression relative to ADR-003** and must be remediated. For the demo context (controlled hotspot, no adversarial traffic), the risk is zero. For persistent production deployment, the risk is material.
- The platform's Design Intent (`CLAUDE.md` §4 — "Trust model = DePIN") is weakened for the duration of the bypass. The `/reading` path cannot claim trustless verification while this branch exists.
- Mixed-trust data: the `readings` table now contains rows that are and are not cryptographically attested. Downstream consumers (aggregators, Merkle tree builder from ADR-007) must handle or exclude unsigned rows explicitly.

### Risks
- **Risk of permanence by inertia.** Technical debt without a hard deadline tends to become permanent. Mitigation: `TODO(ADR-011)` anchor in the code + a remediation trigger documented below, so the removal is indexed by a concrete engineering event rather than a calendar date.
- **Risk of copy-paste propagation.** A future contributor may see the bypass and replicate it elsewhere. Mitigation: the bypass is confined to the `/server/reading` handler, and the `// TODO(ADR-011)` comment plus this ADR make its scope explicit.

## Remediation trigger

This bypass is removed when **both** of the following are true:

1. The ESP32-S3 firmware for Node 2 has a working signing pipeline (uECC or equivalent + SHA-256 over canonical envelope JSON + `esp_random`-backed UUID v4) producing valid signatures accepted by `verifyEnvelopeSignature` in at least 100 consecutive events without verification failure.
2. A pull request removes the `if (envelope.signature === "unsigned_dev")` branch, updates this ADR to `Superseded by [port commit SHA]`, and the `signature = 'unsigned_dev'` rows in the `readings` table are either backfilled (if possible) or retained as a historical marker.

No calendar deadline is set — the trigger is the port landing in the main branch. The author commits to not adding any new caller of the bypass beyond Node 2 during the demo window.

## References

- [ADR-003](003-secp256k1-signature-verification.md) — signature verification contract that this ADR temporarily relaxes
- [ADR-010](010-sensor-agnostic-ingestion-envelope.md) — envelope format that carries the `signature` field
- ESP8266 reference implementation: `ESP/ESP.ino` lines 80–91 (key storage), 177–198 (challenge signing), 455–467 (reading signing)
- Server verifier: `supabase/functions/server/lib/ingest.ts` lines 196–213 (`verifyEnvelopeSignature`)
- Demo plan: `IC_TF_off/MVPs/2026-04-22_plano_demo_claro_v3.md` §9 (alternativas descartadas — "Criptografia secp256k1 no Nó 2")
