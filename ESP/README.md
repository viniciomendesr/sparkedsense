# Firmware

This folder tracks the device-side code that runs on physical sensors and publishes telemetry to the Sparked Sense backend. Each subfolder is an Arduino sketch (folder name == sketch name, the IDE convention).

| Sketch | Board | Sensor | Endpoint | Status |
|---|---|---|---|---|
| [`esp8266/esp8266.ino`](esp8266/esp8266.ino) | ESP8266 (ESP-12E) | DHT11 (temperature, humidity) | `POST /server/reading` (ADR-010 envelope) | Live in production as **Nó #1**, publishing every 60s |
| [`esp32s3/esp32s3.ino`](esp32s3/esp32s3.ino) | ESP32-S3 (Waveshare MC N16R8) | Sipeed MEMS mic + Edge Impulse KWS model | `POST /server/reading` (ADR-010 envelope) | Live as **Nó #2** with `unsigned_dev` marker; signing version is in tree, awaiting reflash |

## Identity model

Both sketches use the same trust model anchored in [ADR-003](../docs/adr/003-secp256k1-signature-verification.md):

- A **secp256k1 keypair** lives on the device. The private key never leaves the chip; the public key is registered with the platform via [`/server/register-device`](../supabase/functions/server/index.ts) (Step 1).
- The device's identity on the platform is `spark:device:<pubkey_hex>`. The CloudEvents envelope uses this as the `source` field.
- Each envelope is signed: `signature = secp256k1_sign(SHA256(canonical_json(envelope_minus_signature)))` then hex-encoded into the `signature` field. Backend re-canonicalises and verifies via `verifyEnvelopeSignature` in [`lib/ingest.ts`](../supabase/functions/server/lib/ingest.ts).
- Once the platform mints an NFT for the device ([ADR-014](../docs/adr/014-deferred-nft-minting.md), [ADR-016](../docs/adr/016-user-paid-mint-on-mainnet.md)), the on-chain identity is permanent and tracks this same keypair.

## Canonical JSON discipline

The hash that the firmware signs **must** byte-equal the hash the backend computes from the received envelope. Drift here means every event is rejected with `bad_signature` (HTTP 401). To stay aligned without pulling a JSON library that does runtime sort:

- **Top-level fields are inserted in alphabetical order** so `serializeJson` / `snprintf` output is canonical without a sort pass. The `signature` field is appended last, but it is excluded from the canonical input.
- **SenML records inside `data`** use `n` / `u` / `v` ordering (already alphabetical).
- **Float serialization** relies on the receiver: backend re-parses the JSON it gets, so as long as ArduinoJson and `snprintf` emit the same shortest-decimal form (which they do for typical sensor ranges), the round-trip is stable.
- **UTF-8 in strings** (e.g., `Butantã`) goes through unchanged; both ArduinoJson and `JSON.stringify` keep raw UTF-8 bytes.

If you change the envelope shape, change both the firmware and the backend canonical computation in lockstep — and validate end-to-end before reflashing a production device.

## Development checklist (per sketch)

1. **Library dependencies** are documented in the top-of-file comment of each sketch. Install via Arduino IDE → Library Manager.
   - ESP8266: `ESP8266HTTPClient`, `ArduinoJson`, `uECC`, `NTPClient`, `DHT sensor library` (Adafruit), `bearssl` (built-in).
   - ESP32-S3: Edge Impulse SDK zip (board-specific), `uECC`, `mbedtls/sha256.h` (built-in to ESP32 core).
2. **Wi-Fi + endpoint constants** are inline at the top of each sketch. Update for your network/cluster before flashing.
3. **Identity keys** — the ESP8266 sketch generates the keypair on first boot and persists in EEPROM; the ESP32-S3 sketch hardcodes the keypair (devnet-only acceptable per ADR-014; for mainnet, port to NVS-encrypted storage).
4. **Verify and Upload** from the Arduino IDE. Watch the Serial Monitor (115200 baud) for the canonical envelope dump and `HTTP 200` confirmation.
5. **Rate-limit awareness** — the backend currently enforces a 1s minimum between POSTs per device (relaxed during the 2026-04-24 Claro demo from a stricter 55s default; see [`docs/timeline.md`](../docs/timeline.md) cleanup checklist). Both sketches have a `PUBLISH_COOLDOWN_MS` / `SEND_INTERVAL_MS` wider than that.

## Operational tips

- **Rotating keys** — if the firmware needs to change its keypair (hardware swap, key compromise, recovering from a placeholder), use the dashboard's **Rotate Key** action on the sensor detail page. The backend rebinds `devices.public_key` while preserving `nft_address`, `claim_token`, and `device_id` (so historical readings stay linked). Records `pubkeyRotatedAt` for audit.
- **Geolocation** — ESP8266 calls `/server/device-location` once at boot with WiFi AP scan results; backend does Mylnikov reverse-geocoding and stores the resulting `location` text on the sensor (ADR-009). ESP32-S3 hardcodes coordinates as CloudEvents extensions on each envelope; backend mirrors them to the sensor row only on first POST (when the sensor's location is empty), so manual edits in the UI are authoritative thereafter.
- **Legacy ingestion** — `POST /server/sensor-data` (ADR-003 path) is **deprecated** per [ADR-015](../docs/adr/015-unify-ingestion-on-adr-010.md). It still accepts writes for the rollback window, but the response carries `X-Sparked-Deprecation` and the backend logs a `console.warn` per call. Once the legacy fleet has stopped writing for ~7 days, the endpoint flips to HTTP 410 Gone.

## See also

- [ADR-010](../docs/adr/010-sensor-agnostic-ingestion-envelope.md) — envelope shape (CloudEvents + SenML).
- [ADR-011](../docs/adr/011-unsigned-dev-bypass-for-unported-devices.md) — `unsigned_dev` wire marker for events without valid signatures.
- [ADR-014](../docs/adr/014-deferred-nft-minting.md) — `unverified` sensor mode and the deferred-mint flow.
- [ADR-015](../docs/adr/015-unify-ingestion-on-adr-010.md) — unifying ingestion on `/server/reading`.
- [`docs/timeline.md`](../docs/timeline.md) — phase log and cleanup checklist.
