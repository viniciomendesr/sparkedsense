# ADR-002: Unified backend in Supabase Edge Functions

**Date:** 2026-03-09
**Status:** Accepted

## Context

The project had accumulated two parallel backend implementations:

1. **Next.js API routes** (`app/api/`) — 9 route handlers for device registration, sensor data, anchoring, datasets, etc. These routes imported `src/lib/solanaService.ts`, `src/lib/redis.ts`, and `src/lib/deviceRegistry.ts`.
2. **Supabase Edge Function** (`supabase/functions/server/`) — A Hono-based server handling auth, sensors, readings, datasets, and public APIs.

Investigation revealed that the Next.js routes were **never deployed**: the project uses `vite build` (not `next build`), `next` is not a dependency in `package.json`, and Vercel deploys the project as a Vite SPA. The `app/api/` routes existed from an earlier architectural iteration but were effectively dead code.

However, these files contained **unique logic not replicated elsewhere**: real Solana NFT minting (Metaplex/UMI), Merkle root anchoring via Solana Memo Program, device claim/revoke flows, and Vercel Blob dataset export.

## Decision

Adopt the Supabase Edge Function as the **single backend** for all API endpoints. The Next.js `app/` directory is moved to `_reference/` as implementation reference for features to be migrated to the Edge Function (Solana mint, anchoring, claim/revoke).

Files that are genuinely dead (no unique logic) are deleted:
- `src/lib/websocket.ts` — replaced by HTTP polling
- `src/lib/supabaseClient.ts` — redundant wrapper of `src/utils/supabase/client.ts`
- `supabase/functions/server/lib/solanaService.ts` — placeholder mocks
- `supabase/functions/server/lib/redis.ts` — in-memory cache replaced by KV store
- `supabase/functions/server/lib/deviceRegistry.ts` — unused stubs

Files with unique future-feature logic are preserved:
- `src/lib/solanaService.ts` — real Metaplex/UMI NFT minting
- `src/lib/deviceRegistry.ts` — claim/revoke device logic
- `src/lib/redis.ts` — Upstash configuration (reference for rate limiting patterns)

## Consequences

### Positive
- Single backend entry point simplifies debugging and deployment
- Eliminates confusion about which backend is active
- Reference code preserved for future feature migration
- Reduces repository noise for contributors

### Negative
- Edge Function will grow as migrated features are added — modularization (ADR pending) will be needed
- Solana integration must be re-implemented for Deno runtime (Metaplex/UMI currently targets Node.js)
