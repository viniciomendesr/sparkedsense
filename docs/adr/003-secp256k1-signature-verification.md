# ADR-003: secp256k1 signature verification without BIP-0062 normalization

**Date:** 2026-03-10 16:51
**Status:** Accepted

## Context

The ESP8266 firmware uses the micro-ecc (uECC) library to generate secp256k1 signatures for each sensor reading. The server-side verification uses `@noble/curves` (via esm.sh for Deno compatibility).

During end-to-end testing, signature verification was failing consistently. Investigation revealed that uECC produces **high-S signatures** — the S component of the ECDSA signature is in the upper half of the curve order. By default, `@noble/curves` enforces **BIP-0062 low-S normalization**, rejecting any signature where S > N/2 (where N is the curve order).

BIP-0062 low-S normalization was introduced in Bitcoin to prevent transaction malleability. It is not part of the secp256k1 standard itself — it's a Bitcoin-specific convention adopted by some libraries as default behavior.

## Decision

Disable low-S enforcement on the server by passing `{ lowS: false }` to the `secp256k1.verify()` function in `@noble/curves`. This accepts both high-S and low-S signatures.

```typescript
const isValid = secp256k1.verify(signatureBytes, messageHash, publicKeyBytes, { lowS: false });
```

Alternatives considered:
- **Normalize S on ESP8266** — Would require adding modular arithmetic to the firmware (uECC doesn't provide this). Increases firmware complexity and flash usage on an already constrained device (4MB flash).
- **Normalize S on server before verification** — Possible but adds complexity and obscures the actual signature produced by the device.

## Consequences

### Positive
- Direct compatibility with uECC signatures without firmware modifications
- Simpler firmware code — no post-processing of signatures needed
- Works with any ECDSA library that doesn't enforce low-S (which is most libraries outside Bitcoin ecosystem)

### Negative
- Signatures are technically malleable (an attacker could flip S to N-S and produce a valid alternative signature for the same message). This is acceptable because Sparked Sense uses signatures for **device authentication**, not for preventing transaction replay. The server validates the public key against a registered device, so a malleable signature cannot be used to impersonate a different device.
- If the project integrates with Bitcoin-ecosystem tooling in the future, signatures may need normalization at that point
