# ADR-016: User-paid NFT mint on mainnet (deferred from ADR-014)

**Date:** 2026-04-25
**Status:** Proposed — implementation triggered when mainnet deployment is on the table

## Context

ADR-014 introduced deferred NFT minting and chose **server wallet pays** as the mint flow for the current devnet deployment:

> For the current devnet deployment, the **server wallet** (`SOLANA_SERVER_SECRET_KEY_BASE58`) pays mint fees. This:
> - Removes any wallet-adapter dependency from the UI for now.
> - Makes onboarding trivial — user clicks one button.
> - Has no real economic cost on devnet.

This is fine for devnet. On mainnet it isn't:

- **Direct cost.** Every mint costs SOL the platform pays. Cost scales linearly with users, asymptotically to "platform pays for ever-growing fleet of speculative sensors that never produce useful data".
- **Trust model regression.** Server-paid mint says nothing about who *owns* the sensor on-chain. The NFT lands in the server's wallet (or transferred immediately to a user account, with extra ops), meaning the user doesn't directly hold the asset.
- **Open onboarding abuse.** Without economic gating, a single actor can spawn arbitrary sensors and mint them all for free, polluting any kind of indexed view ("show me trustworthy sensors near me").

The DePIN narrative requires that **users own their sensors on-chain**, paid for from their own wallet. The mint timing being deferred (the ADR-014 contribution) is independent of who pays — those are two separable design choices.

## Decision

When the platform deploys to Solana mainnet, the mint flow shifts to **user-paid via wallet adapter**:

1. **UI integrates Solana wallet adapter** (Phantom / Solflare / Backpack — the standard `@solana/wallet-adapter-react` ecosystem). The "Mint NFT" button on the sensor detail page changes its behavior:
   - On click, prompts the user's wallet to sign the mint transaction.
   - The transaction is built client-side, signed by the user, then submitted to the network.
   - Server backend receives a confirmation message ("here is the tx signature, please record it") rather than executing the transaction itself.

2. **NFT goes directly to the user's wallet.** The mint transaction sets `mintAuthority` to the user's pubkey. After confirmation, the user holds the NFT in their wallet — no transfer step, no custodial risk.

3. **Backend verifies the mint** by querying the chain (RPC `getAccountInfo` or similar) before flipping the sensor's `mode: 'unverified' → 'real'`. The user-supplied `txSignature` is the proof, but the platform doesn't take their word for it.

4. **The server wallet keeps a residual role** for two narrow operations:
   - **Dataset anchoring** (ADR-007 / ADR-012). Memo Program writes are platform-paid because they represent the platform's auditability claim, not user ownership.
   - **Optional sponsored-mint promotion**, e.g., "first 100 mints are free" or "verified-organisation mints are sponsored". This is a strict opt-in; default flow is user-paid.

### What changes in code at mainnet cutover

- Frontend: add `@solana/wallet-adapter-react` + relevant adapter packages; gate the existing Mint NFT button on a connected wallet; replace the `sensorAPI.mint()` call with a client-side build/sign/submit flow.
- Backend: replace the simulated mint logic in `POST /server/sensors/:id/mint` with a verification handler that takes `{ txSignature, nftAddress }` and confirms via RPC.
- Config: add `SOLANA_CLUSTER=mainnet-beta` env var, point `SOLANA_RPC_URL` to a paid mainnet RPC (Helius, Triton, etc.) — devnet free RPC won't carry production traffic.
- Wallet: provision a mainnet hot wallet for the platform with funded SOL for anchoring fees only (small ongoing cost, predictable).

### What does NOT change

- **ADR-014 deferred-mint UX.** Sensors still register in `unverified` mode and start publishing immediately. Mint is still optional.
- **Sensor identity.** The device pubkey (secp256k1) used for envelope signing is independent of the Solana mint flow. Same device, same identity.
- **Dataset trust model.** Mixed-signature composition metadata (ADR-014) continues to surface auditable provenance.

## Consequences

### Positive

- **DePIN narrative matures.** Users hold their sensor NFTs in their own wallets; ownership is verifiable on-chain by anyone, not implied by a database row.
- **Cost scales correctly.** Platform's mainnet SOL exposure is bounded by anchoring volume (low, predictable) rather than mint volume (potentially large and adversarial).
- **Spam-resistance.** Each mint costs the user real SOL, creating economic friction against arbitrary sensor creation.
- **Composability.** A mainnet-minted sensor NFT is a real on-chain asset — can be transferred, sold, used as collateral, or referenced from other Solana programs without platform mediation.

### Negative

- **Onboarding step.** Users need a mainnet wallet, some SOL, and the willingness to sign a mint transaction. Mitigated by the fact that mint is **optional** (ADR-014 — sensor works without mint); only users who want on-chain attestation cross this bar.
- **More client code.** Wallet adapter integration, network state, mainnet-vs-devnet UX. Not trivial but well-trodden in the Solana ecosystem.
- **Mint failure UX.** Users can lose SOL on a failed mint (network congestion, wrong RPC, etc.). Mitigated by retry logic and clear error surfaces. Standard practice on Solana dapps.

### Risks

- **RPC cost / reliability.** Public RPCs are unreliable for sustained traffic. Mainnet requires paying for RPC. Mitigation: Helius / Triton / QuickNode are commodity at this point.
- **Wallet UX fragmentation.** Phantom, Solflare, Backpack, hardware wallets — each have minor quirks. Mitigation: stick to wallet-adapter-react which abstracts most of this.
- **Cold cutover risk.** Switching mint flows + cluster + wallet stack at the same time is a multiple-failure-mode cutover. Mitigation: stage on a Solana testnet (or Helius mainnet-fork) first; soft-launch with a feature flag that limits mint to allowlisted users.

## Implementation triggers

This ADR converts from "Proposed" to "Implemented" when **all** of:

- A funded mainnet wallet exists for anchoring (~5 SOL initial).
- A paid RPC provider is configured.
- The user-base hits a threshold where free server-paid mints become economically painful (decided pragmatically; rough number: 50 active sensors).
- The product roadmap explicitly commits to mainnet.

Until those conditions are met, the devnet flow described in ADR-014 stays in effect.

## References

- [ADR-005](005-blockchain-identity-reset.md) — wallet ownership semantics (this ADR continues that direction at scale).
- [ADR-007](007-merkle-tree-before-blockchain.md) — dataset anchoring (server wallet keeps this role).
- [ADR-008](008-solana-devnet-over-testnet.md) — devnet rationale for development.
- [ADR-014](014-deferred-nft-minting.md) — deferred mint flow (this ADR specifies its mainnet payment dimension).
- Solana wallet adapter docs: https://github.com/solana-labs/wallet-adapter
