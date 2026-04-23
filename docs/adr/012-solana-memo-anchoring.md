# ADR-012: Solana Memo Program anchoring for dataset Merkle roots

**Date:** 2026-04-22
**Status:** Accepted — partial implementation of [ADR-007](007-merkle-tree-before-blockchain.md)

## Context

ADR-007 committed the platform to anchoring dataset Merkle roots on Solana. At the time of writing it deferred three sub-decisions:

1. NFT metadata schema for device identity
2. Anchoring transaction format (Memo Program vs metadata update vs PDA)
3. Real Solana devnet integration (today it is simulated as `devnet_sim_<hex>`)

The 2026-04-24 demo Claro shifts the priority: a third-party watching the demo needs to click a link and land on a real Solana Explorer page proving the dataset was anchored. Simulated transaction signatures break that story.

### Constraints discovered during implementation

- **`@solana/web3.js` is too heavy for Supabase Edge Runtime.** Both eager and lazy imports of `@solana/web3.js@1.91.0` (with full dependency graph resolved through `esm.sh`) triggered `WORKER_RESOURCE_LIMIT` (HTTP 546) on every endpoint of the function. Observed with and without Metaplex UMI.
- **Metaplex is out of scope for the demo window.** NFT minting with full token metadata requires an image/JSON hosted somewhere, a metadata standard choice (Token Metadata vs Fungible Asset), and eight hours of integration we do not have before the demo.
- **The memo itself must be self-describing.** A bare Merkle root onchain with no context means a third party loading the tx page cannot tell which dataset it refers to.

## Decision

Implement **only the anchoring sub-decision** now, narrowly scoped:

1. **Transaction format**: **Solana Memo Program** (program ID `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`). Each anchored dataset emits one transaction carrying a self-describing URI memo.
2. **Memo payload shape** (≤566 bytes, UTF-8):
   ```
   sparked-sense://dataset/<id>?root=<merkleRoot>&n=<readingsCount>&from=<startISO>&to=<endISO>
   ```
   The URI is intentionally valid — a third party can paste it back into the platform for re-verification, and it self-documents on Solana Explorer's memo log.
3. **Transaction construction**: manual bytecode build using only `@noble/curves/ed25519` (for signing) and `bs58` (for address/signature encoding). No dependency on `@solana/web3.js`. This bypasses the edge-runtime resource limit that blocks the official SDK.
4. **Cluster**: Solana devnet (`SOLANA_RPC_URL=https://api.devnet.solana.com`). Aligned with [ADR-008](008-solana-devnet-over-testnet.md).
5. **Server keypair**: dedicated wallet `36QSgfod6aZQTn57dshDdhAxfNaVtpvQzHUQWJUaVUYy` — isolated from personal wallets; secret key stored exclusively in Supabase secret `SOLANA_SERVER_SECRET_KEY_BASE58`. Funded with 6 SOL from the devnet faucet.
6. **Trust model preservation**: the Merkle root written onchain is the same root that was computed locally from the dataset's readings per [ADR-007](007-merkle-tree-before-blockchain.md). A verifier reads the memo, reconstructs the tree client-side (`src/lib/merkle.ts`), and compares. The platform does not re-sign or transform the root between computation and anchoring.

**Explicitly deferred** (still pending from ADR-007):

- **NFT minting for device identity** — continues as simulated `nftAddress = devnet_sim_<hex>` until Metaplex integration is feasible on a more permissive runtime (likely a dedicated Cloudflare Worker or a Node-based serverless function).
- **Anchoring via on-chain program (PDA)** — Memo Program is sufficient for integrity proof; a custom program would only add value if we need onchain queryability of anchored roots (e.g., "list all datasets anchored by sensor X") without going through the platform's off-chain index.

### Why manual transaction construction (not `@solana/web3.js`)

Three iterations were attempted:

1. Eager `import` of `@solana/web3.js` at module top → `WORKER_RESOURCE_LIMIT` on **every** endpoint (even `/health`).
2. Lazy `await import()` inside the anchor handler → still `WORKER_RESOURCE_LIMIT` when the handler was hit, but other endpoints worked.
3. **Manual legacy-transaction build + ed25519 sign + raw RPC fetch** → works reliably, no resource issues. Total runtime cost: one `getLatestBlockhash` RPC call + one ed25519 signature + one `sendTransaction` RPC call. Confirmation is polled via `getSignatureStatuses`.

The manual approach is ~200 lines in `supabase/functions/server/lib/solana.ts` and has zero dependencies beyond `@noble/curves@1.4.0/ed25519` and `bs58@5.0.0`. Both libraries are already known-good in the Deno edge runtime.

## Consequences

### Positive

- **Demo story is now verifiable.** "Click this link → Solana Explorer shows you the Merkle root we just anchored — no need to trust us." Verified with test tx `2HNdwW5qLZNszUmVq43uXfwbLtXqQS3VPbVTjSiVu1bfCzWFanXXSMXwkdgVqueVsuWV8tBrbfz5pzjCobb4Dx7W` (slot 457407445).
- **Public API exposes the server wallet**: `GET /server/public/anchor-info` returns pubkey, cluster, and balance. Third parties can audit how the platform signs.
- **The broken "Verify Data Integrity" UX (paste-your-own-hash) is removed** and replaced by a "View onchain anchor" button per dataset linking directly to Solana Explorer. The client-side Merkle proof verification infrastructure (`src/lib/merkle.ts`) is retained and still reachable from the audit page for technically-minded users.
- **Graceful fallback**: if `SOLANA_SERVER_SECRET_KEY_BASE58` is not configured (dev environment, fresh fork), the `/datasets/:id/anchor` endpoint falls back to the legacy simulated flow. The platform does not become unusable when a funded wallet is absent.
- **Cost is negligible**: 5000 lamports per anchor on devnet (zero real cost). Even at mainnet prices, a sensor emitting one dataset per day costs ~$0.0003/year in fees.

### Negative

- **Not every ADR-007 item is closed.** Device identity is still simulated. A reviewer reading the code sees `devnet_sim_` prefixed `nftAddress` values and must consult this ADR + ADR-007 to understand why.
- **Transaction confirmation is synchronous.** The `/datasets/:id/anchor` handler blocks for up to 20 seconds polling `getSignatureStatuses`. For the demo and typical dataset cadence this is fine; if anchoring frequency increases (e.g., hourly anchors), consider moving confirmation to a background job.
- **Memo Program caps at 566 bytes.** Current payload is ~180 bytes, so we have headroom. If future metadata additions push it past, the URI must be split or an off-chain resolver used.
- **Manual tx building is additional code to maintain.** Solana's legacy tx format is stable but unfamiliar to most contributors. Mitigated by tight focus (`solana.ts` only handles the Memo case) and inline comments on the bytecode layout.

### Risks

- **Devnet resets.** Solana devnet is periodically wiped. Anchored tx signatures in the `datasets` table may become dangling links after a reset. Mitigation: document this in the audit page UI and consider mirroring the memo to a secondary store (Arweave, IPFS) for post-demo permanence.
- **Wallet exhaustion.** The server wallet funds run dry after ~200,000 anchors at 5000 lamports each. At demo scale, 6 SOL lasts effectively forever. Monitoring via `GET /server/public/anchor-info` returns current balance.
- **Private key compromise.** The secret key lives in Supabase secrets. If that store is compromised, an attacker can drain the wallet and, more importantly, sign memos impersonating the platform. Mitigation: the wallet is isolated (not the author's personal Phantom), devnet-only, easily rotated by issuing a new keypair.

## Implementation pointers

- Anchoring module: [`supabase/functions/server/lib/solana.ts`](../../supabase/functions/server/lib/solana.ts)
- Handler integration: [`supabase/functions/server/index.ts`](../../supabase/functions/server/index.ts) — search for `ADR-007 partial`
- Envelope metadata on dataset: [`src/lib/types.ts`](../../src/lib/types.ts) — `anchorExplorerUrl`, `anchorTxSignature`, `anchorCluster`, `anchorMemo`, `anchoredAt`
- UI integration: "View onchain anchor" button in [`src/pages/public-sensor-detail.tsx`](../../src/pages/public-sensor-detail.tsx) and [`src/pages/sensor-detail.tsx`](../../src/pages/sensor-detail.tsx)
- Diagnostic endpoint: `GET /server/public/anchor-info`

## References

- [ADR-007](007-merkle-tree-before-blockchain.md) — original decision this ADR partially satisfies
- [ADR-008](008-solana-devnet-over-testnet.md) — devnet-only development policy
- Memo Program v2: [`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`](https://explorer.solana.com/address/MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr)
- Server wallet: [`36QSgfod6aZQTn57dshDdhAxfNaVtpvQzHUQWJUaVUYy`](https://explorer.solana.com/address/36QSgfod6aZQTn57dshDdhAxfNaVtpvQzHUQWJUaVUYy?cluster=devnet)
- Verified test tx: [`2HNdwW5qLZNszUmVq43uXfwbLtXqQS3VPbVTjSiVu1bfCzWFanXXSMXwkdgVqueVsuWV8tBrbfz5pzjCobb4Dx7W`](https://explorer.solana.com/tx/2HNdwW5qLZNszUmVq43uXfwbLtXqQS3VPbVTjSiVu1bfCzWFanXXSMXwkdgVqueVsuWV8tBrbfz5pzjCobb4Dx7W?cluster=devnet)
