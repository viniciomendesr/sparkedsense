# ADR-001: Stack and infrastructure choices

**Date:** 2025-10-30 (documented 2026-03-10 16:51)
**Status:** Accepted

## Context

Sparked Sense is an IoT data validation platform that connects physical sensors to the Solana blockchain. The project started as an academic initiative (IC/TF at POLI-USP) with plans to become open source and support private commercial forks.

Requirements at project inception:
- Rapid prototyping capability for a small team (2-4 people)
- Real-time dashboard for sensor data visualization
- Serverless backend to avoid infrastructure costs during development
- Cryptographic verification of sensor readings
- Blockchain integration (Solana devnet initially)
- Hardware communication with ESP8266 microcontrollers
- Deployment without managing servers

## Decision

### Frontend
- **React 18 + Vite** — Fast build times, mature ecosystem, team familiarity. Vite chosen over Next.js because the application is a client-side SPA that doesn't need SSR or server-side rendering. Build output is a static bundle deployed to Vercel.
- **Tailwind CSS + Radix UI** — Utility-first styling with accessible component primitives. Avoids writing custom accessibility logic.
- **Recharts** — Lightweight charting library for sensor data visualization.
- **TypeScript (strict mode)** — Type safety across the entire frontend codebase.

### Backend
- **Supabase Edge Functions (Deno + Hono)** — Serverless functions with zero cold-start cost on the free tier. Hono provides Express-like routing on Deno runtime. Supabase provides integrated PostgreSQL, authentication, and real-time subscriptions.
- **KV store pattern** — JSONB-backed key-value table in Supabase PostgreSQL for flexible schema during rapid iteration. Avoids migration overhead while the data model is still evolving.

### Authentication
- **Supabase Auth** — Built-in email/password authentication with JWT tokens. Eliminates the need for a custom auth system. Frontend uses the Supabase JS client for session management.

### Infrastructure
- **Vercel** — Static SPA deployment with automatic builds from GitHub. Free tier sufficient for development.
- **Supabase (free tier)** — PostgreSQL database, Edge Functions, Auth, and Realtime subscriptions in a single platform. Eliminates multi-service coordination.

### Hardware
- **ESP8266 + DHT11** — Low-cost WiFi microcontroller (~$3) with temperature/humidity sensor (~$2). Sufficient for proof-of-concept. secp256k1 cryptographic signatures generated on-device using the micro-ecc (uECC) library.

### Blockchain
- **Solana devnet** — Low transaction costs, fast finality (~400ms), and strong developer tooling. Devnet for development; mainnet migration planned for production.

## Consequences

### Positive
- Zero infrastructure cost during development (all services on free tiers)
- Single deployment target (Vercel for frontend, Supabase for backend) simplifies CI/CD
- Team can iterate on data model without SQL migrations (KV store flexibility)
- Supabase Realtime provides WebSocket-like functionality without custom infrastructure

### Negative
- KV store prefix-scan queries (`LIKE 'sensor:%'`) don't scale beyond ~10K items without indexing — migration to relational schema will be needed
- Supabase Edge Functions have a 60-second execution limit — long-running tasks (batch anchoring) may need alternative execution environments
- Vite SPA means no server-side rendering — SEO is limited (acceptable for a dashboard application)
- Single monolithic Edge Function file will need modularization as endpoint count grows

### Risks
- Supabase free tier limits (500MB database, 500K Edge Function invocations/month) may be reached during sustained sensor operation
- Vendor lock-in to Supabase for auth + database + edge functions — mitigated by using standard PostgreSQL and portable auth patterns
