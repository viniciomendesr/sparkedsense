# ADR-010: Sensor-agnostic ingestion envelope via CloudEvents + SenML

**Date:** 2026-04-22
**Status:** Accepted

## Context

Sparked Sense declares itself in [CLAUDE.md](../../CLAUDE.md) as **"hardware-agnostic, sensor-agnostic DePIN infrastructure"**, with the explicit design intent: *"The ingestion pipeline accepts arbitrary signed JSON payloads. Never hardcode assumptions about what fields a reading contains beyond the cryptographic envelope."*

The codebase as of 2026-04-22 does not yet honor this intent in full:

- The live `POST /sensor-data` endpoint and the `sensor_readings` PostgreSQL schema are shaped around environmental telemetry (temperature, humidity, pH). Fields like `value`, `unit`, and `device_id` are first-class; anything outside that numeric-scalar model has no canonical place to land.
- Adding a sensor of a new modality today requires either (a) reinterpreting the `payload` JSON ad-hoc in the frontend on a per-device basis, or (b) extending the backend schema. Neither is sensor-agnostic at the platform level.
- A demo planned for 2026-04-24 will add two new node types that are not numeric-scalar:
  - **ESP32-S3 running an acoustic classifier** (Edge Impulse MFCC + CNN-1D INT8) publishing `{class, confidence, model_id}` — an **ML inference**, not a raw reading.
  - **A MacBook acting as MEC gateway** running `faster-whisper` and publishing `{text, duration_ms}` — a **transcription**, a different modality still.
- A separate research project (the author's undergraduate research, *Arquitetura para Coordenação e Compartilhamento de Inferências entre Nós Edge AI Heterogêneos Independentes*) will demand that inference outputs from heterogeneous models be publishable and semantically interoperable. The cleanest alignment for Sparked Sense is to let that research layer (aggregation of heterogeneous inferences) compose on top of a platform whose ingestion layer is already agnostic.

Three options were considered for making the platform genuinely sensor-agnostic.

### Options evaluated

| Option | Shape | Agnostic? | Frontend cost | Third-party friction | Standards-aligned |
|--------|-------|-----------|---------------|----------------------|-------------------|
| 1. One endpoint per sensor type (`/temperature`, `/audio-inference`, …) | Typed routes | No — platform hardcodes types | Low per route, high combinatorial | High — new modality requires PR | No |
| 2. Generic `POST /reading` with fully opaque `payload` | Untyped | Yes in theory | High — frontend has no hints to render | Low | Partial (Particle Cloud model) |
| 3. Generic `POST /reading` with **self-describing envelope** (discriminator + payload schema) | Envelope + typed payload | Yes | Moderate — renderers dispatch on `type` | Low — new modality just picks a `type` | Yes (WoT TD, SenML, CloudEvents) |

### Why not option 1 (per-sensor endpoints)

Violates the design intent documented in `CLAUDE.md`. Creates a platform where every new modality requires a PR, a migration, and a deploy — the opposite of a permissionless DePIN infrastructure. No mainstream IoT platform (Home Assistant, AWS IoT Core, Azure IoT Hub, Particle Cloud, DePHY, IoTeX W3bstream) uses per-type endpoints at the ingestion layer; they all converge on a single ingestion path with a discriminator inside the payload.

### Why not option 2 (fully opaque payload)

Particle Cloud demonstrates this model works technically, but its documented trade-off is that the frontend cannot provide modality-specific visualization without out-of-band knowledge of the event name. Every consumer must carry its own lookup table of "event X means temperature in °C, event Y means motion boolean". This pushes the semantic interoperability problem entirely onto consumers. It is also the gap that W3C Web of Things, SenML (RFC 8428), and IoTO++ explicitly address as a known deficiency in naïve IoT platforms.

### Why option 3 is the industry consensus

Mature IoT and event-driven systems converge on a layered envelope:

- **W3C Web of Things Thing Description 2.0** uses JSON Schema as its Data Schema Vocabulary; Things self-describe their interaction affordances and payload schemas. Platform is agnostic; discovery is mediated by Thing Descriptions.
- **SenML (RFC 8428, IETF Standards Track, 2018)** defines a compact, self-describing format for sensor measurements: arrays of records with `n` (name), `u` (unit), `v`/`vs`/`vb`/`vd` (typed value), with units drawn from an IANA registry. Designed to run in ~1 KB of flash on 8-bit MCUs.
- **CloudEvents (CNCF graduated, 2024)** standardizes event envelopes: `specversion`, `id`, `source`, `type`, `time`, `datacontenttype`, `data`. `type` uses reverse-DNS convention (e.g. `com.github.pull.create`) for hierarchical, extensible event taxonomies. Adopted by AWS EventBridge, Azure Event Grid, Knative, Dapr, Kafka.
- **Home Assistant MQTT Discovery** uses a topic pattern `<prefix>/<component>/<object_id>/config` with `device_class` in the payload as the semantic discriminator. Supports ~50 official device classes plus arbitrary custom ones without code changes.
- **DePHY** (DePIN framework closest in positioning to Sparked Sense) accepts arbitrary messages through a single RPC port, verified by DID, without the platform interpreting payload semantics.

The pattern is settled: **one ingestion endpoint, envelope with discriminator, payload conforming to a type-indicated schema, rendering driven by the discriminator.**

## Decision

Adopt a **CloudEvents-compatible envelope** with **SenML-compatible payloads** for numeric/scalar telemetry, and arbitrary typed JSON for non-scalar modalities (inferences, transcriptions, custom extensions). Expose ingestion through a single endpoint, `POST /reading`, which supersedes the sensor-type-specific shape currently implied by `POST /sensor-data`.

### Envelope schema

Minimum valid envelope:

```json
{
  "specversion": "1.0",
  "id": "<uuid>",
  "source": "spark:device:<device_public_key_hex>",
  "type": "<reverse_dns_event_type>",
  "time": "2026-04-24T16:15:00.000Z",
  "datacontenttype": "application/senml+json" | "application/json" | "audio/wav;base64" | "text/plain",
  "data": <payload_conforming_to_type>,
  "signature": "<secp256k1_hex_signature_over_canonical_json>"
}
```

Required attributes follow CloudEvents 1.0 core. `signature` is a Sparked Sense extension that covers the canonical-JSON serialization of the envelope minus the `signature` field itself. This preserves the existing secp256k1 trust model from [ADR-003](003-secp256k1-signature-verification.md) without modification.

### Event type taxonomy (reverse DNS, hierarchical)

Platform-blessed types (registered in this repo under `docs/event-types/`):

| Type | Data shape | Datacontenttype | Use case |
|------|-----------|-----------------|----------|
| `io.sparkedsense.sensor.environmental` | SenML array | `application/senml+json` | Temperature, humidity, pH, air quality, any numeric scalar with unit |
| `io.sparkedsense.sensor.generic` | SenML array | `application/senml+json` | Catch-all for SenML-compatible telemetry |
| `io.sparkedsense.inference.classification` | `{ class, confidence, class_vocabulary, model_id, model_version }` | `application/json` | Discrete-class ML output (audio, image, vibration regime, etc.) |
| `io.sparkedsense.inference.regression` | `{ value, unit, model_id, model_version }` | `application/json` | Continuous-value ML output (estimated occupancy, predicted temperature, etc.) |
| `io.sparkedsense.inference.detection` | `{ detected: bool, event_duration_ms, peak_intensity, model_id }` | `application/json` | Binary event detection with metadata |
| `io.sparkedsense.inference.transcription` | `{ text, language, source_event_id, engine, duration_processed_ms }` | `application/json` | Speech-to-text outputs |
| `io.sparkedsense.inference.semantic_summary` | `{ summary, keywords[], topics[], source_event_id, engine }` | `application/json` | LLM-derived metadata from prior inferences |
| `io.sparkedsense.raw.audio` | Base64-encoded PCM or WAV | `audio/wav;base64` | Short raw audio windows — intended for local consumption by a MEC node, generally not for public audit pages |

Third parties MAY register custom types using their own reverse-DNS namespace (`com.example.myproject.*`). The platform does not gatekeep new types; it routes them generically (see renderer fallback below).

### Canonical JSON rules for signing

Unchanged from ADR-003: keys sorted lexicographically at every nesting level, no whitespace, UTF-8 encoding, numeric values without leading zeros or trailing `.0` on integers. The `signature` field itself is excluded from canonicalization. The `time` field MUST be ISO-8601 with millisecond precision and `Z` suffix (UTC), not numeric epoch, to maintain stable canonicalization across client clocks.

### Storage

A single table `readings` receives all envelopes. Migration plan:

```sql
-- New canonical table
CREATE TABLE readings (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,                    -- spark:device:<pubkey_hex>
  device_id UUID NOT NULL REFERENCES devices(id),
  time TIMESTAMPTZ NOT NULL,
  datacontenttype TEXT NOT NULL,
  data JSONB NOT NULL,
  signature TEXT NOT NULL,
  spec_version TEXT NOT NULL DEFAULT '1.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_readings_device_time ON readings (device_id, time DESC);
CREATE INDEX idx_readings_type_time ON readings (event_type, time DESC);
```

The existing `sensor_readings` table is preserved for backward compatibility. A view `sensor_readings_compat` projects numeric-scalar SenML records out of `readings` (type `io.sparkedsense.sensor.environmental`, extracting `n`, `u`, `v` per SenML record) so that existing consumers and the current DHT11 sensor in production continue to work unchanged.

Existing ESP8266 firmware emitting legacy payloads continues posting to `POST /sensor-data`, which is now a thin adapter that wraps the legacy body into an `io.sparkedsense.sensor.environmental` envelope, signs-through the existing signature, and writes to `readings`. Deprecation timeline for the legacy endpoint is out of scope for this ADR.

### Rendering strategy (frontend)

The frontend dispatches on the prefix of `event_type`:

- `io.sparkedsense.sensor.*` → numeric sparkline with unit from SenML `u`.
- `io.sparkedsense.inference.classification` → label with confidence bar and class-vocabulary hover.
- `io.sparkedsense.inference.transcription` → text block with source event link.
- `io.sparkedsense.inference.detection` → event timeline strip.
- `io.sparkedsense.inference.semantic_summary` → collapsible summary with keywords chips.
- Unknown types → generic JSON viewer with event metadata header (graceful fallback).

New platform-blessed renderers ship as frontend PRs. Third parties with custom `type` namespaces either (a) submit a renderer PR, (b) accept the generic fallback, or (c) build their own frontend consuming `GET /public/readings` filtered by their namespace.

### Endpoint behavior

`POST /reading` accepts the envelope described above. Validation order:

1. Envelope shape (required CloudEvents attributes + `signature`) present.
2. `source` parses as `spark:device:<hex>`; device exists in `devices` table.
3. Canonical-JSON reconstruction of envelope minus `signature`, secp256k1 verification against device public key.
4. `datacontenttype` is one of the platform-recognized types, or `application/json` with a registered custom `type`, or explicitly `application/octet-stream` (advisory only, no payload validation).
5. For platform-blessed `type` values, `data` validated against the JSON Schema at `docs/event-types/<type>.schema.json`. For custom types, `data` accepted as opaque JSONB.
6. Row inserted in `readings`. Event emitted via Postgres CDC for real-time consumers.

Rejection returns HTTP 400 with a CloudEvents-style error body. Authentication: Bearer `SUPABASE_ANON_KEY`, unchanged.

## Consequences

### Positive

- Platform stops contradicting its own `CLAUDE.md` design intent.
- Third parties can publish new sensor modalities without coordinating with Sparked Sense maintainers — choose a reverse-DNS type, sign, POST. This is a prerequisite for the infrastructure being genuinely open-source DePIN rather than a single-operator SaaS.
- Legacy DHT11 sensor in production keeps working (backward-compatible adapter + view).
- Alignment with standards — CloudEvents (CNCF graduated), SenML (IETF RFC), WoT TD (W3C) — means the platform composes with existing IoT/event ecosystems. Example downstream: a consumer that already speaks CloudEvents (Knative, AWS EventBridge, Dapr) can subscribe to Sparked Sense output with no adapter.
- Demo narrative strengthens: "the platform accepts any modality via open standards" backed by RFC 8428 and CNCF CloudEvents 1.0 is a materially stronger claim than a vendor-specific schema.
- The author's concurrent research project (*Coordenação e Compartilhamento de Inferências entre Nós Edge AI Heterogêneos*) gains a concrete Layer 1 (semantic envelope) and Layer 2 (signed protocol) to compose its Layer 3 (aggregation) on top of, without blurring the conceptual boundary between platform and research contribution.

### Negative

- One more schema to maintain in `docs/event-types/` for each platform-blessed type.
- Backend validation complexity grows (JSON Schema validation per type vs today's ad-hoc field checks).
- Frontend must be refactored from a DHT-centric sparkline view to a type-dispatched renderer framework. Estimated effort: 4–6 h for the first three renderers (environmental, classification, transcription); further renderers ship incrementally.
- The CloudEvents envelope is more verbose than the current payload (~200 bytes vs ~120 bytes for a single DHT reading). For constrained MCUs, SenML batching (arrays of records in a single envelope) mitigates this.
- Event-type governance: if adoption scales, there will be pressure to bless many community-proposed types. Initial stance: three platform-blessed `sensor.*` + six `inference.*` types; community types welcome under their own namespaces with no platform guarantee beyond authenticity.

### Risks

- **Migration bug breaks live DHT11.** Mitigation: adapter for `POST /sensor-data` is a thin wrap over the new `POST /reading`, deployed behind a canary. The `sensor_readings_compat` view preserves read-path for frontend until the frontend is migrated.
- **CloudEvents spec interpretation drift.** Mitigation: pin to spec v1.0 explicitly in the envelope (`specversion: "1.0"`); version this ADR if CloudEvents 2.0 is adopted.
- **SenML unit registry churn.** Mitigation: use the IANA SenML Units registry snapshot; new units added to the platform-blessed list per-PR with minimal friction.
- **Canonical-JSON ambiguity across stacks.** Mitigation: adopt RFC 8785 JSON Canonicalization Scheme (JCS) explicitly for the signing canonicalization; add test vectors in `test-flow.js`.
- **Firmware flash size for ESP8266.** Mitigation: ESP8266 firmware keeps posting the legacy shape to `POST /sensor-data`; adapter handles envelope wrapping server-side. ESP8266 is not required to implement CloudEvents locally.

## Implementation order

1. Write ADR (this document) and merge to `docs/adr/` — **this PR**.
2. Create `docs/event-types/` folder with JSON Schemas for the nine platform-blessed types.
3. Database migration: `readings` table, indexes, `sensor_readings_compat` view.
4. Backend endpoint `POST /reading` with envelope validation, signature verification, type-schema validation, row insert.
5. Backend adapter: `POST /sensor-data` wraps legacy payload into `io.sparkedsense.sensor.environmental` envelope and delegates to `POST /reading`. Live DHT11 keeps working.
6. Real-time CDC published from `readings` alongside existing `sensor_readings` feed (dual-write period).
7. Frontend: type-dispatched renderer framework; implement the three renderers needed for the 2026-04-24 demo (environmental SenML, inference.classification, inference.transcription). Page `/demo-claro` consumes them.
8. After demo stabilization: deprecation window for `POST /sensor-data`, firmware migration plan for ESP8266 to emit envelopes natively.
9. Documentation: update README to cite the new ingestion contract; add a "Publishing to Sparked Sense" quickstart referencing CloudEvents + SenML.

Items 1–7 are the critical path for the 2026-04-24 demo. Items 8–9 are post-demo maintenance.

## References

- [CloudEvents Specification 1.0 (CNCF)](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md) — event envelope standard.
- [RFC 8428: Sensor Measurement Lists (SenML)](https://www.rfc-editor.org/rfc/rfc8428.html) — self-describing sensor measurement format.
- [W3C Web of Things Thing Description 2.0](https://www.w3.org/TR/wot-thing-description-2.0/) — data schema vocabulary based on JSON Schema.
- [RFC 8785: JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785) — deterministic JSON serialization for signing.
- [Home Assistant MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery) — `device_class` payload discriminator pattern.
- [DePHY messaging architecture](https://blog.ju.com/dephy-network-phy-infrastructure-analysis/) — DePIN ingestion via single RPC port with DID-verified payloads.
- [ADR-003: secp256k1 signature verification](003-secp256k1-signature-verification.md) — existing trust model preserved.
- [ADR-004: Dual-layer storage](004-dual-layer-storage.md) — storage model this ADR evolves.
- [ADR-007: Merkle tree before blockchain](007-merkle-tree-before-blockchain.md) — aggregation layer consuming the new `readings` table.
