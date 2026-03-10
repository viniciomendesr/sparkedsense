# ADR-005: Blockchain identity reset and wallet ownership

**Date:** 2026-03-10 16:52
**Status:** Accepted

## Context

The project's Solana devnet wallet was originally created by a team member (Pedro Goularte) who set up the `sparked-three` test environment on Vercel. The private key (`SERVER_SECRET_KEY_BASE58`) was stored as a Vercel environment variable and used for test NFT minting on devnet.

Pedro's involvement shifted, and the project needed a clean blockchain identity under the control of the active maintainer (Vinicio Mendes). Additionally, the database contained accumulated test data from months of development — mock sensors, test users, and readings tied to the old wallet identity.

## Decision

Perform a complete identity reset:

1. **New Solana wallet** — Created via Phantom Wallet, under exclusive control of Vinicio Mendes. Public key: `6RuAxerE8GsMziM4c77ZzakfMAiebSfTE3LX4S1EyMNn`. Funded with 10 SOL airdrop on devnet.

2. **Database reset** — Full cleanup of all 4 tables: `sensor_readings`, `devices`, `kv_store_4a89e1c9`, and Supabase Auth users. Removes all references to the old wallet and stale test data.

3. **Device re-registration** — ESP8266 EEPROM reset via Serial Monitor `RESET` command, followed by fresh challenge-response registration against the new infrastructure.

The old wallet's private key was removed from all environment variables and configuration.

## Consequences

### Positive
- Clear ownership of blockchain identity — single maintainer controls the wallet
- Clean database state eliminates confusion from stale test data
- Fresh device registration validates the end-to-end flow works from scratch

### Negative
- All historical test data lost (acceptable — it was test data, not production)
- Any future NFTs minted on devnet with the old wallet are orphaned
- Requires manual re-registration of all physical devices
