# Reference implementations

This directory contains **inactive code** from an earlier Next.js-based architecture. These files are not deployed or executed — the active backend is the Supabase Edge Function in `supabase/functions/server/`.

They are preserved as **implementation reference** for features being migrated to the Edge Function:

| File | Contains | Migration status |
|------|----------|-----------------|
| `api/register-device/` | NFT minting via Metaplex/UMI during device registration | Pending — needs Deno-compatible Solana SDK |
| `api/anchor/` | Merkle root anchoring to Solana via Memo Program | Pending |
| `api/datasets/` | Dataset export to Vercel Blob storage | Pending |
| `api/claim-device/` | NFT transfer to user wallet on device claim | Pending |
| `api/revoke-device/` | Device revocation and new claim token generation | Pending |
| `api/sensor-data/` | Rate limiting via Redis + batch data storage | Partially implemented in Edge Function |
| `api/get-proof/` | Proof retrieval with Redis cache fallback | Pending |
| `api/get-claim-token/` | Claim token retrieval for physical devices | Implemented in Edge Function |
| `api/mock-sensor/` | Mock sensor creation | Implemented in Edge Function |

See [ADR-002](../docs/adr/002-unified-backend-edge-functions.md) for the decision to unify the backend.
