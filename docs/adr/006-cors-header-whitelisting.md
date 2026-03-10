# ADR-006: CORS header whitelisting strategy

**Date:** 2026-03-10 16:52
**Status:** Accepted

## Context

The frontend sends `Cache-Control: no-cache, no-store` on all API requests to prevent stale data from browser or CDN caches (added in Phase 5 to fix a reactivity issue with real sensor polling).

The Edge Function's CORS configuration only whitelisted `Content-Type`, `Authorization`, `apikey`, and `x-client-info` as allowed request headers. The `Cache-Control` header was not included.

This caused browsers to reject the preflight OPTIONS request, producing a `TypeError: Failed to fetch` on the client side. The frontend error handler interpreted this as "Edge Function not deployed", displaying a misleading error to users. The Edge Function itself was running correctly — direct curl requests returned HTTP 200 with valid data.

## Decision

Add `Cache-Control` to the CORS `Access-Control-Allow-Headers` whitelist on the server, rather than removing the header from client requests.

Rationale:
- `Cache-Control` on requests is a legitimate use for preventing stale responses
- Removing it from the client would reintroduce the caching issue it was added to solve
- Server-side whitelisting is the correct CORS fix — the server should declare which headers it accepts
- This approach is forward-compatible: future custom headers can be added to the whitelist without client-side changes

The fix was applied in 4 locations in the Edge Function: Hono `cors()` middleware, explicit OPTIONS handler, and `Deno.serve` wrapper (both preflight and response headers).

## Consequences

### Positive
- Frontend cache-busting continues to work as intended
- CORS preflight passes for all current request headers
- Pattern established for adding future custom headers

### Negative
- CORS configuration is duplicated in 4 places in the Edge Function — a single source of truth would be better (addressed when the backend is modularized)
