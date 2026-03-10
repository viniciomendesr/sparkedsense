# ADR-007: Fix Merkle tree and define on-chain schema before blockchain integration

**Date:** 2026-03-10 17:32
**Status:** Accepted

## Context

The system has three simulated blockchain touchpoints:

1. **Device identity (nftAddress)** — Generated as `crypto.getRandomValues(32)` hex string. Not a real Solana NFT.
2. **Dataset anchoring (transactionId)** — Generated as a random UUID. No on-chain transaction occurs. A `setTimeout(3s)` simulates the anchoring delay.
3. **Merkle root calculation** — Implemented as `SHA-256(concat(hash1, hash2, ..., hashN))`, a linear hash of all readings concatenated in order. This is not a Merkle tree — it's a single hash over concatenated data.

The question arose whether to implement real Solana minting immediately or first fix the cryptographic foundations. A separate question was whether to migrate from HTTPS to MQTT for device communication.

## Decision

**Priority order:**

1. **Fix the Merkle tree implementation** — Replace the linear hash with a proper binary Merkle tree that supports inclusion proofs. This is the cryptographic foundation for dataset integrity verification and is central to the academic thesis. The on-chain anchoring format depends on the Merkle root format, so this must be correct before anything is written to the blockchain.

2. **Define NFT metadata schema** — Decide what goes into the device identity NFT (public key, MAC address, sensor type, capabilities) before minting. Changing the schema after minting means re-minting all devices.

3. **Define anchoring transaction format** — Choose between Solana Memo Program, NFT metadata update, or PDA (Program Derived Address) for storing Merkle roots on-chain. This decision affects how third-party auditors verify data.

4. **Implement real Solana integration** — Mint NFTs and anchor datasets on devnet once the above are stable.

**Deferred:** MQTT migration. Current architecture (HTTPS at 60s intervals) is adequate for the MVP scope. MQTT would add broker infrastructure without meaningful benefit at current scale (1 device, 1 reading/minute). Revisit when scaling to 100+ devices or sub-10s intervals.

**Deferred:** Reducing the 60s send interval. DHT11 sensor precision (+-2C) doesn't justify higher frequency. 60s generates sufficient data volume for demonstrating Merkle trees and anchoring in the thesis.

## Consequences

### Positive
- Merkle tree fix ensures inclusion proofs work correctly before any data is anchored immutably
- Schema-first approach prevents re-minting devices after on-chain integration
- Devnet is designed for experimentation, but getting the data structures right first avoids churn
- MQTT deferral keeps infrastructure simple during academic validation phase

### Negative
- Blockchain integration is pushed further out — the system remains "simulated on-chain" for longer
- Merkle tree refactor may require changes to the frontend verification UI
- Existing readings stored with linear hashes won't be compatible with the new Merkle format (acceptable — current data is test data)

### Risks
- Solana SDK (Metaplex/UMI) may not work on Deno runtime — the reference implementation in `_reference/` targets Node.js. May need `@solana/web3.js` directly or an alternative approach.

## Implementation (10 Mar 2026)

Priority 1 (Merkle tree fix) was implemented in Phase 7:

- **Backend module:** `supabase/functions/server/lib/merkle.ts` — `buildTree()`, `generateProof()`, `verifyProof()`
- **Backend integration:** `index.ts` — replaced 6 callsites, added 2 proof endpoints
- **Frontend module:** `src/lib/merkle.ts` — client-side verification via Web Crypto API
- **Frontend pages:** `sensor-detail.tsx`, `public-sensor-detail.tsx`, `audit.tsx` — real cryptographic verification replacing simulated checks

Priorities 2-4 (NFT schema, anchoring format, Solana integration) remain pending.
