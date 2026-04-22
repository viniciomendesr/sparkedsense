# Platform-blessed event types

This directory registers the event types recognized by the Sparked Sense ingestion endpoint (`POST /reading`), per [ADR-010](../adr/010-sensor-agnostic-ingestion-envelope.md).

Each event type has a JSON Schema describing the shape of the `data` field in the CloudEvents envelope. Types live under the reverse-DNS namespace `io.sparkedsense.*`. Third parties MAY publish to the platform using their own reverse-DNS namespace (`com.example.myproject.*`); unregistered types are accepted as opaque JSONB and rendered with the generic fallback.

## Registered types

| Type | Schema | Datacontenttype | Use case |
|------|--------|------------------|----------|
| `io.sparkedsense.sensor.environmental` | [schema](io.sparkedsense.sensor.environmental.schema.json) | `application/senml+json` | Numeric-scalar environmental telemetry (temperature, humidity, pH, air quality). |
| `io.sparkedsense.sensor.generic` | [schema](io.sparkedsense.sensor.generic.schema.json) | `application/senml+json` | Catch-all SenML-compatible telemetry. |
| `io.sparkedsense.inference.classification` | [schema](io.sparkedsense.inference.classification.schema.json) | `application/json` | Discrete-class ML output (audio/image/vibration classifier). |
| `io.sparkedsense.inference.regression` | [schema](io.sparkedsense.inference.regression.schema.json) | `application/json` | Continuous-value ML output (estimated occupancy, predicted temperature). |
| `io.sparkedsense.inference.detection` | [schema](io.sparkedsense.inference.detection.schema.json) | `application/json` | Binary event detection with metadata. |
| `io.sparkedsense.inference.transcription` | [schema](io.sparkedsense.inference.transcription.schema.json) | `application/json` | Speech-to-text outputs. |
| `io.sparkedsense.inference.semantic_summary` | [schema](io.sparkedsense.inference.semantic_summary.schema.json) | `application/json` | LLM-derived metadata from prior inferences. |
| `io.sparkedsense.raw.audio` | [schema](io.sparkedsense.raw.audio.schema.json) | `audio/wav;base64` | Short raw audio windows for local consumption by MEC nodes. |

## Envelope

All types share the CloudEvents 1.0 envelope with a `signature` extension. See [ADR-010 §Envelope schema](../adr/010-sensor-agnostic-ingestion-envelope.md#envelope-schema).

## Adding a new platform-blessed type

1. Open a PR adding `io.sparkedsense.<domain>.<subdomain>.schema.json` to this directory.
2. Add a row to the table above.
3. Add a renderer to the frontend (or accept the generic fallback).
4. Update the backend's validator registry (`supabase/functions/server/lib/event-types.ts`).

Custom types from third parties do **not** require a PR. They get the generic renderer and pass through validation as opaque JSONB.
