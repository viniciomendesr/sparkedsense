# ADR-008: Solana devnet over testnet for development and academic validation

**Date:** 2026-03-10 17:45
**Status:** Accepted

## Context

Before implementing real blockchain integration (NFT minting, dataset anchoring), the team needed to decide which Solana network to target. The three options are:

1. **Devnet** — Development network for application builders. Free SOL via airdrop (up to 2 SOL/request, no aggressive rate limiting). State persists for months but can be reset by the Solana team. Full tooling support (Phantom, Solscan, Metaplex, all explorers).

2. **Testnet** — Network for validator operators to stress-test consensus upgrades. Free SOL but rate-limited airdrops. Less stable than devnet for application development. Partial tooling support.

3. **Mainnet-beta** — Production network with real economic value.

Solana's official documentation recommends devnet for application development and testnet for validator/infrastructure testing. Most Solana dApps (including those referenced in academic publications) develop and demonstrate on devnet.

## Decision

Use **Solana devnet** for all development and academic validation. Skip testnet entirely — if the project moves to production, transition directly from devnet to mainnet-beta.

Rationale:
- Devnet is the standard environment for Solana application development
- Full tooling support simplifies integration and debugging
- Airdrop availability ensures uninterrupted development without token management overhead
- Academic validation requires demonstrating a working end-to-end flow, not network persistence — transaction hashes and screenshots serve as evidence even if devnet state is eventually reset
- Testnet adds no value for application-level testing and introduces instability risks from validator upgrade cycles

Mitigation for devnet resets: the system is designed to re-mint device NFTs and re-anchor datasets programmatically. A full re-initialization takes minutes with the automated infrastructure.

## Consequences

### Positive
- Simplest development environment with best tooling support
- No token scarcity or rate limiting during development sprints
- Standard choice — reviewers and contributors will expect devnet
- Direct path to mainnet when ready (devnet → mainnet, no intermediate step)

### Negative
- Devnet state is not permanent — transaction hashes may become unverifiable after a reset
- Devnet performance characteristics don't perfectly match mainnet (lower load, faster confirmation)
- No production-grade stress testing before mainnet (acceptable for current project phase)
