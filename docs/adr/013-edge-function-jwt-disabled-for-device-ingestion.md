# ADR-013: Disable Supabase JWT gateway on the `server` Edge Function

**Date:** 2026-04-24
**Status:** Accepted

## Context

The `server` Edge Function (`supabase/functions/server/index.ts`) is the public ingestion endpoint for every Sparked Sense device:

- Node 1 — ESP8266 on the legacy `/sensor-data` path (six weeks of continuous signed ingestion, see ADR-003).
- Node 2 — ESP32-S3 acoustic classifier on `/server/reading` via the ADR-011 `unsigned_dev` bypass.
- Node 3 — MacBook MEC gateway on `/server/reading`, signing natively via `@noble/curves`.

All three authenticate by proving possession of a device-specific secp256k1 key pair registered in the `devices` table — either by signing the canonical-JSON envelope (ADR-003 / ADR-010) or by carrying the explicit `unsigned_dev` marker (ADR-011). None of them hold a Supabase-issued JWT, and none of them can obtain one: the devices have no user account, no OAuth flow, and in the case of the ESP8266 no TLS stack capable of the Supabase `/auth/v1` handshake within its memory budget.

Supabase Edge Functions default to **gateway-level JWT verification**. With the default on, every request is rejected at the gateway with:

```
{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```

before the handler ever runs. The deploy that shipped the function originally was done with `--no-verify-jwt`, which worked, but a subsequent redeploy (to adjust the rate-limit window for the 2026-04-24 Claro demo) was done without the flag and immediately broke every device. The fix — redeploying with the flag — is not persistent: any future redeploy that forgets the flag will break ingestion again.

Three options were evaluated:

1. **Enable gateway JWT verification and issue JWTs to devices.** Rejected. It contradicts the platform's design intent (`CLAUDE.md` §4 — trust model is DePIN): devices are authenticated by cryptographic possession of a private key, not by a token minted by a centralized identity provider. Provisioning a per-device Supabase user would also require storing long-lived credentials on flash memory with no hardware secure element, which is strictly weaker than the existing secp256k1 model.

2. **Redeploy with `--no-verify-jwt` every time and hope nobody forgets.** Rejected. The failure mode is silent at deploy time and catastrophic at runtime (every device request returns 401 at the gateway, past any monitoring the handler itself might emit). Relying on deploy discipline for a production contract is a known anti-pattern.

3. **Persist `verify_jwt = false` in `supabase/config.toml`.** Accepted. The Supabase CLI reads per-function settings from `config.toml` on every deploy and applies them regardless of command-line flags. A future redeploy will respect the setting automatically.

## Decision

Create `supabase/config.toml` at the repository root with:

```toml
project_id = "djzexivvddzzduetmkel"

[functions.server]
verify_jwt = false
```

Authentication remains the handler's responsibility. The flow inside `supabase/functions/server/index.ts` is unchanged:

1. Envelope shape validation (CloudEvents + SenML, ADR-010).
2. `source` field → `devices` table lookup to resolve the registered `public_key` and the `revoked` flag.
3. Signature verification via `verifyEnvelopeSignature` in `lib/ingest.ts` (secp256k1 over canonical JSON, ADR-003), **or** the explicit `unsigned_dev` branch (ADR-011) for devices without a ported signing pipeline.
4. Rate limiting, payload validation, persistence.

Disabling the gateway JWT shifts zero trust assumptions: the handler already does all authentication work.

## Consequences

### Positive
- Any redeploy of the `server` function — whether via `supabase functions deploy server`, via CI, or via a future contributor who never sees this ADR — will keep the endpoint reachable by devices.
- The config is in git, auditable, and reviewable via PR. No hidden dashboard toggle.
- Preserves the DePIN trust model unchanged: authentication is cryptographic, not account-based.

### Negative
- Callers that expect Supabase's standard gateway-level authorization on this endpoint will not get it. This is explicit and intended; it must be documented for anyone onboarding to the backend.
- The `server` function is now a **public endpoint** from the gateway's perspective. Its handler is the sole line of defense. Any handler bug that skips signature verification is directly exploitable — there is no second check at the gateway.

### Risks
- **Risk of copy-paste propagation to future functions.** A contributor seeing this config may add `verify_jwt = false` to functions that do not implement their own authentication. Mitigation: the config block carries an inline comment pointing at this ADR; future functions must opt in explicitly and are reviewed as such.
- **Risk of drift with dashboard settings.** Supabase exposes the same toggle in the web dashboard. The CLI deploy is authoritative; manual dashboard edits will be overwritten on the next deploy. This is the intended direction but worth noting for operators.

## References

- [ADR-003](003-secp256k1-signature-verification.md) — secp256k1 signature verification contract.
- [ADR-010](010-sensor-agnostic-ingestion-envelope.md) — CloudEvents + SenML envelope carrying the `signature` field.
- [ADR-011](011-unsigned-dev-bypass-for-unported-devices.md) — `unsigned_dev` marker for devices without a ported signing pipeline.
- Supabase CLI config reference: `functions.<name>.verify_jwt` — https://supabase.com/docs/guides/cli/config
- Incident that triggered this ADR: redeploy of `server` on 2026-04-24 (rate-limit tuning for the Claro demo) silently re-enabled gateway JWT verification and broke ingestion for every device until `--no-verify-jwt` was reapplied.
