# Sparked Sense

> **Open-source DePIN infrastructure for commodity IoT hardware — connecting off-the-shelf microcontrollers to off-chain storage and on-chain verification.**

## Overview

**Sparked Sense** is a hardware-agnostic platform that lets anyone participate in a decentralized physical infrastructure network using generic microcontrollers (ESP8266, ESP32, Arduino-compatible boards) — no proprietary devices required.

The platform handles device identity (secp256k1 key pairs), data ingestion, cryptographic verification, dataset aggregation, Merkle proofs, and blockchain anchoring. It is **sensor-agnostic** (temperature, humidity, audio, image, foot traffic, or any future data source) and **vertical-agnostic** (smart cities, retail analytics, agriculture, environmental monitoring, logistics).

Applications being built on top of Sparked Sense include **retail/customer analytics** (edge devices in malls and stores for foot traffic inference via TinyML) and **environmental sensing** (the live MVP below). The platform layer remains the same.

🔗 **Live MVP:** [sparkedsensemvp.vercel.app](https://sparkedsensemvp.vercel.app/)
🐦 **Follow updates:** [@sparkedsense](https://x.com/sparkedsense)

---

## Key Features

- **Commodity hardware first** — ~R$15 ESP8266 is the baseline; any microcontroller with WiFi and a crypto library works
- **Cryptographic device identity** — secp256k1 key pairs generated on-device, persisted in EEPROM
- **Signed data ingestion** — every reading carries a signature verified on the backend before storage
- **Sensor-agnostic envelope** — CloudEvents 1.0 + SenML ingestion ([ADR-010](docs/adr/010-sensor-agnostic-ingestion-envelope.md)): one `POST /reading` endpoint accepts environmental telemetry, ML inferences, transcriptions, and custom modalities under reverse-DNS type namespaces
- **Binary Merkle tree with inclusion proofs** — client-side and server-side verification via Web Crypto API
- **Real-time streaming** — Supabase Postgres CDC pushes readings to connected dashboards
- **Crypto-style charts** — Live Data + Historical Data feeds with stats header (current, Δ, %Δ), gradient area fill, timeframe selector (1H/6H/1D/1W/All), and brush zoom
- **WiFi geolocation with neighborhood** — devices locate themselves via nearby AP scan (Apple WiFi DB via Cloudflare Worker), reverse-geocoded label includes `suburb → city → state → country`
- **On-chain anchoring** — dataset Merkle roots anchored to Solana devnet
- **Public audit pages** — anyone can verify dataset integrity without trusting the operator
- **Hardened Postgres** — RLS enforced on `devices`/`sensor_readings`/`sensor_metrics`; service-role-only write path; sensitive columns (MAC address, owner-scoped metadata) not exposed via direct PostgREST
- **Fully open source** — firmware, backend, frontend, and infrastructure decisions documented in ADRs

---

## System Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│                       SPARKED SENSE PLATFORM                  │
├───────────────────────────────────────────────────────────────┤
│  FRONTEND: Vite + React + TypeScript + Tailwind               │
│     • Dashboard / Sensor detail / Public audit pages          │
│     • Client-side Merkle proof verification                   │
│                                                               │
│  BACKEND: Supabase Edge Functions (Hono + Deno)               │
│     • Device registration (secp256k1 challenge-response)      │
│     • Reading ingestion / signature verification              │
│     • Merkle tree generation and inclusion proofs             │
│                                                               │
│  WIFI GEOLOCATION: Cloudflare Worker                          │
│     • Apple WiFi DB reverse lookup from BSSID scan            │
│                                                               │
│  DATABASE: Supabase PostgreSQL (RLS enforced)                 │
│     • devices / sensor_readings (legacy)                      │
│     • readings (CloudEvents envelopes, ADR-010)               │
│     • kv_store (sensor metadata + datasets)                   │
│                                                               │
│  BLOCKCHAIN: Solana Devnet                                    │
│     • Merkle root anchoring                                   │
│                                                               │
│  DEVICES: ESP8266 / ESP32 / Arduino-compatible                │
│     • secp256k1 signing, canonical JSON, HTTPS to Edge Fn     │
└───────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-------------|----------|
| **Frontend** | Vite + React + TypeScript + Tailwind | Dashboard, audit pages, client-side verification |
| **Backend** | Supabase Edge Functions (Hono + Deno) | API, signature verification, Merkle tree |
| **Database** | Supabase PostgreSQL | Canonical storage for devices and readings |
| **Metadata store** | Supabase KV table (`kv_store_4a89e1c9`) | Sensor metadata, datasets, aggregations |
| **WiFi geolocation** | Cloudflare Worker + Apple WiFi DB | BSSID → coordinates |
| **Blockchain** | Solana Devnet | Dataset Merkle root anchoring |
| **IoT devices** | ESP8266 / ESP32 / Arduino-compatible | Signed reading transmission |
| **Auth** | Supabase Auth + Solana Wallet Adapter | User identity and device ownership |

---

## Core Concepts

### Device identity
Each physical device generates a secp256k1 key pair at first boot and stores it in EEPROM. Registration uses a challenge-response protocol: the backend issues a challenge, the device signs it, the backend verifies the signature and binds the public key to a claim token.

### Signed readings
Every reading is a canonical JSON payload signed with the device's private key. The backend rejects any payload whose signature does not verify against the registered public key.

### Binary Merkle tree
Readings are aggregated into datasets. The backend builds a binary Merkle tree (pairwise SHA-256 hashing, odd leaves duplicated, domain-separated leaf nodes) and exposes inclusion proofs. The root is anchored on Solana. Clients reconstruct and verify proofs in-browser via Web Crypto API — no trust in the server required.

### Real vs mock sensors
- **Real sensors** transmit signed payloads from physical devices.
- **Mock sensors** generate synthetic readings for frontend testing and integration validation.

### Public auditing
Public audit pages let anyone fetch a dataset's Merkle root, pull any leaf's inclusion proof, and verify integrity locally. This is the core DePIN trust model: multiple parties trust the data without trusting whoever collected it.

---

## Installation

### 1. Clone the repository
```bash
git clone https://github.com/viniciomendesr/sparkedsense.git
cd sparkedsense
```

### 2. Install dependencies
```bash
pnpm install
```

### 3. Configure environment variables
Create a `.env.local` file in the project root:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PRIVATE_KEY=...
```

### 4. Initialize the Supabase database
Run the migrations from [`supabase/migrations/`](./supabase/migrations/):
- `001_initial_schema.sql`
- `002_fix_schema_gaps.sql`

### 5. Run locally
```bash
pnpm dev
```
Dev server listens on port 3000.

---

## Documentation

- [`docs/timeline.md`](./docs/timeline.md) — chronological project history (Keep a Changelog format)
- [`docs/adr/`](./docs/adr/) — Architecture Decision Records (Michael Nygard format)
- [`CLAUDE.md`](./CLAUDE.md) — design intent and agent guidance

---

## Public API

Endpoints are exposed through Supabase Edge Functions.

| Endpoint | Method | Description |
|-----------|--------|-------------|
| `/public/sensors` | GET | List public sensors |
| `/public/sensors/:id` | GET | Sensor detail (enriched with `totalReadingsCount`, `totalDataBytes`) |
| `/public/sensors/featured` | GET | Featured sensors for homepage |
| `/public/sensors/:id/hourly-merkle` | GET | Merkle root + leaves for the last hour |
| `/public/sensors/:sensorId/merkle-proof/:leafIndex` | GET | Inclusion proof for a specific leaf |
| `/public/readings/:sensorId` | GET | Public readings feed; unions legacy `sensor_readings` with the ADR-010 `readings` table per ADR-015. Paginated server-side via `?limit=N` |
| `/server/register-device` | POST | Two-step secp256k1 challenge-response registration |
| `/server/reading` | POST | CloudEvents envelope ingestion (ADR-010, canonical) |
| `/server/sensors/:id` | PUT | Owner-only: update `name`, `description`, or `visibility` (allowlist) |
| `/server/sensors/:id/refresh-location` | POST | Owner-only: re-derive location label from stored lat/lng |
| `/server/device-location` | POST | WiFi scan → geolocation lookup |
| `/verify/merkle` | POST | Server-side Merkle proof verification |

---

## Real-time data flow

### Legacy path (`POST /server/sensor-data`)

1. Device signs JSON payload with its secp256k1 private key
2. Edge Function verifies the signature and writes to `sensor_readings` (PostgreSQL)
3. Edge Function dual-writes the payload as an `io.sparkedsense.sensor.environmental` envelope into the ADR-010 `readings` table
4. Supabase emits a Postgres CDC event
5. Frontend dashboards update automatically

### Envelope path (`POST /server/reading`, ADR-010)

1. Device (or MEC gateway) signs a CloudEvents 1.0 envelope over canonical JSON with `{specversion, id, source, type, time, datacontenttype, data}`
2. Edge Function validates envelope shape, resolves device identity via `source: spark:device:<pubkey>`, verifies signature, and validates the typed payload (SenML for telemetry, typed JSON for inferences/transcriptions)
3. Writes to the `readings` table with the full envelope + device FK
4. Frontend dispatches on `event_type` to the appropriate renderer (`src/components/renderers/`)

```typescript
supabase
  .channel('sensor-updates')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'sensor_readings' },
    (payload) => console.log('New reading:', payload)
  )
  .subscribe();
```

---

## Team

### Advisors
- **Prof. Marcos Zancul** — Scientific Advisor, Manufacturing Systems & Product Development (Poli-USP)
- **Otávio Vacari** — Technical Advisor, Computer Engineer (Poli-USP), M.Sc. in Applied Cryptography and Distributed Systems

### Core team
| Member | Role | Background |
|---------|------|-------------|
| **Vinício Mendes** | Project Creator & Product Lead | Production Engineering student (Poli-USP); Founder of FireTheBox; Researcher in DePIN and Smart Infrastructure |
| **Nicolas Gabriel** | Project Creator & Lead Developer | Full-Stack Developer specialized in Web3, Supabase, and Frontend Integration |
| **Pedro Goularte** | Project Creator & Infrastructure Lead | Systems Engineer experienced in distributed systems and backend architecture |
| **Paulo Ricardo** | Project Creator & Communication Lead | Production Engineer (UFJF), specialized in project management and institutional communication |

---

## License

MIT License © 2025 Sparked Sense Project

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Commit your changes
4. Push (`git push origin feat/your-feature`)
5. Open a Pull Request

---

## Contact

🌐 **Website:** [sparkedsensemvp.vercel.app](https://sparkedsensemvp.vercel.app/)
🐦 **Twitter/X:** [@sparkedsense](https://x.com/sparkedsense)
📧 **Issues & Feedback:** [GitHub Issues](https://github.com/viniciomendesr/sparkedsense/issues)

---

> _Sparked Sense is open infrastructure for trustworthy physical-world data — a foundation for DePIN applications across any domain that needs verifiable sensor data without trusting the operator._
