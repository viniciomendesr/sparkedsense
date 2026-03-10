# ADR-004: Dual-layer storage — PostgreSQL + KV store

**Date:** 2026-03-10 16:52
**Status:** Accepted

## Context

The system needs to store two categories of data with different access patterns:

1. **Device identity data** — Device public keys, MAC addresses, NFT addresses, challenge tokens. Accessed by exact key lookup. Schema is stable. Queried by the Edge Function during device registration and sensor-data ingestion.

2. **Sensor operational data** — Sensors, readings, datasets. Accessed by prefix scans (all sensors for a user, all readings for a sensor). Schema evolves frequently during development. Queried by the frontend dashboard via REST API.

Supabase provides PostgreSQL with full relational capabilities. The project also uses a JSONB-backed KV store table (`kv_store_4a89e1c9`) that provides Redis-like key-value operations.

## Decision

Use both storage layers for different purposes:

- **PostgreSQL tables** (`devices`, `sensor_readings`) — For device identity and raw sensor readings from physical hardware. Relational schema with proper columns, types, and constraints. Used by the `register-device` and `sensor-data` endpoints.

- **KV store** (`kv_store_4a89e1c9`) — For dashboard-facing data: sensor metadata, processed readings, datasets. Key patterns: `sensor:{userId}:{sensorId}`, `reading:{sensorId}:{readingId}`, `dataset:{sensorId}:{datasetId}`. Used by all CRUD endpoints and the real-time subscription layer.

The `sensor-data` endpoint bridges both layers: it writes the raw reading to PostgreSQL (`sensor_readings` table) and simultaneously updates the KV store with the processed reading for dashboard display.

## Consequences

### Positive
- KV store allows rapid schema iteration without migrations — critical during active development
- PostgreSQL provides proper indexing and relational queries for device identity data
- Supabase Realtime subscriptions work on the KV store table, enabling push-based dashboard updates
- Bridge pattern ensures data consistency between both layers

### Negative
- Data duplication between PostgreSQL and KV store increases storage usage
- `getByPrefix()` on the KV store uses SQL `LIKE` queries without dedicated indexes — O(n) scan that degrades with data volume
- Two storage paradigms increase cognitive complexity for contributors
- No transactional guarantee across both layers — a write to PostgreSQL could succeed while the KV store write fails (or vice versa)

### Known scaling limits
- KV prefix scans become problematic above ~10K items per prefix
- Featured sensors endpoint scans all public sensors on every request
- Migration to indexed relational tables is planned when the data model stabilizes
