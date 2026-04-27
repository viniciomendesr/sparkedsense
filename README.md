# Sparked Sense

> **Open-source Physical AI infrastructure for commodity IoT hardware.**

Connect any microcontroller (ESP8266, ESP32, Arduino-compatible) to a verifiable data layer: cryptographic device identity, signed reading ingestion, ML-inference-aware event types, Merkle-anchored datasets on Solana, public audit pages — no proprietary devices required.

🔗 [Live MVP](https://sparkedsensemvp.vercel.app/) · 🐦 [@sparkedsense](https://x.com/sparkedsense)

---

## What it does

- **Device identity** — secp256k1 key pair generated on-device, persisted in EEPROM
- **Signed ingestion** — every event is a CloudEvents 1.0 envelope verified before storage ([ADR-010](docs/adr/010-sensor-agnostic-ingestion-envelope.md))
- **Inference-aware event types** — classification, regression, transcription, raw audio, plus SenML telemetry — first-class for any TinyML output
- **Verifiable datasets** — binary Merkle tree with inclusion proofs verified client-side via Web Crypto
- **On-chain anchoring** — dataset roots pinned to Solana via the Memo Program
- **Public audit** — anyone can verify integrity without trusting the operator
- **WiFi geolocation** — devices locate themselves via BSSID scan against Apple's WiFi DB
- **Real-time dashboards** — Postgres CDC pushes readings live to connected clients
- **Bilingual UI** — PT-BR / EN via [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) (compile-time, type-safe)

## Stack

Vite + React + TypeScript on the frontend. Hono + Deno on Supabase Edge Functions. PostgreSQL with RLS. Cloudflare Worker for Apple WiFi DB lookups. Solana devnet for anchoring.

## Run locally

```bash
pnpm install
cp .env.example .env.local   # fill SUPABASE + SOLANA vars
pnpm dev                     # localhost:3000
```

Requires Node 20+. Edge Function deploys via `supabase functions deploy server --project-ref <ref>`.

Required env vars:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_SERVER_SECRET_KEY_BASE58=...
```

## Public API

| Endpoint | Method | Description |
|---|---|---|
| `/public/sensors` | GET | List public sensors |
| `/public/sensors/:id` | GET | Sensor detail with reading counts |
| `/public/sensors/featured` | GET | Top-3 for the homepage |
| `/public/sensors/:sensorId/merkle-proof/:leafIndex` | GET | Inclusion proof for a leaf |
| `/public/readings/:sensorId` | GET | Readings feed (paginated via `?limit=N`, unions legacy and envelope tables per [ADR-015](docs/adr/015-unify-ingestion-on-adr-010.md)) |
| `/server/register-device` | POST | secp256k1 challenge-response registration |
| `/server/reading` | POST | CloudEvents envelope ingestion (canonical, ADR-010) |
| `/server/device-location` | POST | WiFi scan → geolocation |

## License

MIT © 2025 Sparked Sense Project

## Contributing

Fork, branch (`feat/...`, `fix/...`), commit, push, open a PR. See [`CLAUDE.md`](./CLAUDE.md) for branch naming and commit conventions.
