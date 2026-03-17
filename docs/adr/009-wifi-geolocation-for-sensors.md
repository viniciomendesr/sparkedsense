# ADR-009: WiFi-based geolocation for physical sensors

**Date:** 2026-03-17
**Status:** Proposed

## Context

Sparked Sense registers physical sensors (ESP8266 / ESP32-S3) that collect environmental data (temperature, humidity, pH) and send signed readings to the backend. Currently, there is no mechanism to determine or display the physical location of a sensor. The platform added a manual `location` text field (ADR pending merge), but it depends on the user typing a location during frontend registration — it is not automatic and has no geographic coordinates.

For a sensor data platform, knowing **where** the data was collected is as important as knowing **what** was collected. Location enables:
- Map-based dashboards and public sensor discovery
- Geographic filtering and clustering of sensors
- Data provenance (proof of where a reading originated)
- Cross-referencing sensor data with regional events (weather, pollution)

### Options evaluated

| Option | Precision | Extra hardware | Cost | Indoor | Firmware change |
|--------|-----------|----------------|------|--------|-----------------|
| 1. Manual input (frontend) | User-dependent | None | Zero | Yes | None |
| 2. WiFi AP scan (BSSIDs) | 20–100 m | None | Zero | Yes | ~30 lines |
| 3. GPS module (NEO-6M) | 2–5 m | ~R$ 15–30 | Zero | **No** | ~40 lines + lib |
| 4. IP geolocation | 1–50 km | None | Zero | Yes | None |
| 5. Hybrid (Manual + WiFi) | Variable | None | Zero | Yes | ~30 lines |

### Why not GPS?

Most Sparked Sense sensors operate indoors (greenhouses, labs, water treatment plants). GPS modules require clear sky view, add hardware cost, consume extra power, and occupy UART pins that may conflict with Serial debug on ESP8266 (single hardware UART). GPS is better suited for outdoor-only deployments.

### Why not IP geolocation?

Supabase Edge Functions run on Cloudflare Workers — the client IP seen by the function is the Supabase infrastructure IP, not the ESP device IP. Even with direct IP access, ISP-level NAT and CGNAT make IP geolocation unreliable (city-level at best, often pointing to the ISP data center). Precision of 1–50 km is insufficient for meaningful sensor mapping.

### Why WiFi scan?

The ESP8266 and ESP32-S3 are **WiFi devices by definition** — they are already connected to a wireless network. The `WiFi.scanNetworks()` function is built into both platforms and returns the BSSID (MAC address) and RSSI (signal strength) of all nearby access points at zero hardware cost. These BSSIDs can be sent to a geolocation service that resolves the device position based on a global database of WiFi access points.

Key advantages:
- **No extra hardware** — uses the existing WiFi radio
- **Works indoors** — greenhouses, labs, basements (where GPS fails)
- **One-time operation** — runs once during `setup()`, does not affect the sensor reading loop
- **DHT11 unaffected** — WiFi scan operates on the network layer, completely independent of GPIO sensor reads
- **Both ESP8266 and ESP32-S3 support it** natively

## Decision

Implement WiFi-based geolocation using the **Mylnikov Geo-Location API** as the geolocation provider, with backend-side RSSI-weighted centroid calculation for multi-AP triangulation.

### Geolocation provider selection

| Provider | Cost | Limit | Coverage | API key | Infrastructure | Stability |
|----------|------|-------|----------|---------|----------------|-----------|
| **Mylnikov API** | **Zero** | **Unlimited** | **Good (~34.5M APs)** | **None** | **None (hosted API)** | **Stable (since ~2014)** |
| Apple via Cloudflare Worker | Zero | Unlimited | Excellent | None | Cloudflare account + Worker deploy | Risky (undocumented API, repo has 3 stars) |
| Unwired Labs | Zero | 100/day | Good | Yes | None | Stable |
| Google Geolocation API | $5/1000 req | Billing required | Excellent | Yes | None | Stable |
| Combain | Zero | 1000/month | Good | Yes | None | Stable |
| Mozilla Location Service | — | Discontinued (2024) | — | — | — | — |

### Why Mylnikov?

The Apple WiFi DB via Cloudflare Worker was initially considered for its superior coverage, but was rejected for production use due to:
- The [`gonzague/wifi-geolocate-worker`](https://github.com/gonzague/wifi-geolocate-worker) repo has only 3 stars, 0 forks, no license, and a single contributor — not reliable as a production dependency
- Apple's WiFi Positioning Service is **undocumented** and uses Protocol Buffers — could break without notice
- Requires deploying and maintaining a separate Cloudflare Worker (extra infrastructure)

**Mylnikov API** is the better choice for an MVP because:
- **Zero setup** — single HTTP GET per BSSID, no API key, no account, no infrastructure
- **MIT License** — open data, legally clear
- **Stable** — running publicly since ~2014 with ~34.5 million AP records worldwide
- **Simple JSON response** — no protobuf, no complex parsing
- **No rate limit documented** — suitable for reasonable IoT usage
- Coverage is sufficient for urban/suburban areas in Brazil where most sensors are deployed

The backend performs **RSSI-weighted centroid calculation** across multiple BSSIDs to compensate for Mylnikov's per-BSSID lookup (no native multi-AP triangulation). This achieves comparable accuracy to providers with built-in triangulation.

### Architecture

```
ESP8266 boot
    │
    ├─ WiFi.scanNetworks() → collects up to 5 BSSIDs + RSSI
    │
    ├─ POST /server/device-location (Supabase Edge Function)
    │       │
    │       ├─ Validates device exists (by nftAddress)
    │       ├─ Deduplication check (skip if location updated < 24h ago)
    │       │
    │       ├─ For each BSSID:
    │       │     GET https://api.mylnikov.org/geolocation/wifi?bssid=XX:XX&v=1.2
    │       │     → { lat, lon, range }
    │       │
    │       ├─ Computes RSSI-weighted centroid from all resolved APs
    │       │     weight = 10^(RSSI/10), stronger signal = more influence
    │       │
    │       ├─ Reverse geocodes via Nominatim → "Campinas, SP, Brazil"
    │       ├─ Saves location + coordinates to devices table
    │       └─ Updates KV store cache
    │
    └─ Continues to loop() → DHT11 readings every 60s (unaffected)
```

### 1. Firmware changes (ESP `.ino`)

Add a `scanAndReportLocation()` function called **once** in `setup()`, after WiFi connection and device registration. The function:

1. Calls `WiFi.scanNetworks()` to discover nearby access points
2. Collects up to **5 strongest APs** (by RSSI), capturing `BSSID` and `RSSI` for each
3. Sends a POST request to the backend endpoint `/server/device-location` with:

```json
{
  "nftAddress": "stored_hex",
  "wifiAccessPoints": [
    { "macAddress": "AA:BB:CC:DD:EE:FF", "signalStrength": -45 },
    { "macAddress": "11:22:33:44:55:66", "signalStrength": -67 }
  ]
}
```

4. The function is **fire-and-forget** — if it fails, the device continues operating normally. Location is non-critical data.
5. The scan runs only **once per boot**, not on every loop iteration. No impact on the 60-second reading cycle.

**EEPROM impact:** None. Location is stored server-side, not on device.

**ESP8266 memory:** `WiFi.scanNetworks()` is synchronous and uses ~2 KB of heap for up to 20 APs. The ESP8266 has ~40 KB free heap after WiFi connection — no risk of OOM.

### 2. Backend changes (Edge Function)

Add a new endpoint `POST /server/device-location`:

1. Receives the `nftAddress` + `wifiAccessPoints` array
2. Validates that the device exists in the `devices` table
3. Deduplication: skips if `latitude` already exists and was updated less than **24 hours** ago
4. For each BSSID in the array, queries Mylnikov:
   ```
   GET https://api.mylnikov.org/geolocation/wifi?v=1.2&bssid=AA:BB:CC:DD:EE:FF
   → { "result": 200, "data": { "lat": -22.9064, "lon": -47.0616, "range": 100 } }
   ```
5. Computes RSSI-weighted centroid from all resolved APs:
   - Weight formula: `10^(RSSI_dBm / 10)` — stronger signals have more influence
   - `lat_final = Σ(lat_i × weight_i) / Σ(weight_i)`
   - `lon_final = Σ(lon_i × weight_i) / Σ(weight_i)`
   - `accuracy = average of all AP ranges`
6. Reverse geocodes coordinates via OpenStreetMap Nominatim to get human-readable address
7. Updates the `devices` table:
   - `location` (TEXT): Human-readable address (e.g., "Campinas, SP, Brazil")
   - `latitude` (NUMERIC): Decimal latitude
   - `longitude` (NUMERIC): Decimal longitude
   - `location_accuracy` (NUMERIC): Accuracy in meters
8. Also updates the KV store cache for the corresponding sensor entry

**Authentication:** The endpoint uses the same `supabaseAnonKey` Bearer token as `/sensor-data` — no user JWT required. The device is identified by its `nftAddress`.

**Deduplication cache:** 24 hours. If the device reboots multiple times within 24 hours, the backend returns the cached location without calling Mylnikov. This protects against reboot loops and ensures **stable location hashes on the blockchain** — RSSI-based centroid can vary slightly between scans even at the same physical location, and frequent recalculations would create unnecessary hash changes on-chain that don't represent real sensor movement.

### 3. Database migration

```sql
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC,
  ADD COLUMN IF NOT EXISTS location_accuracy NUMERIC;
```

The `location` TEXT column already exists (migration 002). The new columns add coordinate data for map rendering.

Update the `public_sensors_with_metrics` view to include `latitude`, `longitude`.

### 4. Frontend changes

- **Sensor Card:** Already displays `location` text (implemented). No change needed.
- **Sensor Detail Page:** Show coordinates and accuracy below location text when available.
- **Public Sensors Page:** Future enhancement — add a map view using coordinates. Out of scope for this ADR.

### 5. Sensor code templates

Update the three templates in `/src/sensor-code/` (temperature.ts, humidity.ts, ph.ts) to include the `scanAndReportLocation()` function, so users who copy firmware code from the activation wizard get location support automatically.

### 6. Mylnikov API details

**Endpoint:**
```
GET https://api.mylnikov.org/geolocation/wifi?v=1.2&bssid=<MAC_ADDRESS>
```

**Response (success):**
```json
{
  "result": 200,
  "data": {
    "lat": -22.9064,
    "lon": -47.0616,
    "range": 100
  }
}
```

**Response (not found):**
```json
{
  "result": 404
}
```

- No authentication required
- No rate limit documented
- MIT licensed open data
- ~34.5 million AP records
- Database: [mylnikov.org](https://www.mylnikov.org/archives/1170)

## Consequences

### Positive
- Automatic location for all real sensors without user intervention
- Works indoors (greenhouses, labs) where GPS fails
- **Zero cost** — no API keys, no billing, no rate limits
- **Zero infrastructure** — no Cloudflare Worker, no extra accounts, no deploy steps
- **Simple integration** — single HTTP GET per BSSID, plain JSON response
- **Stable API** — running publicly since ~2014
- Non-blocking and non-critical — device operates normally if geolocation fails
- Coordinates enable future map-based visualization
- One-time scan per boot minimizes resource usage
- Compatible with both ESP8266 and ESP32-S3
- Backend-computed weighted centroid improves accuracy with multiple APs
- 24-hour dedup cache ensures stable on-chain location hashes and protects against reboot loops

### Negative
- Mylnikov has **fewer APs** than Apple/Google (~34.5M vs billions) — may not resolve all BSSIDs, especially in rural areas
- Maintained by a **single person** (Alexander Mylnikov) — no SLA, no support
- Per-BSSID lookup means the backend makes up to 5 sequential HTTP requests (vs 1 batch request with other providers) — adds ~200-500ms total latency
- Reverse geocoding via Nominatim has a 1 request/second rate limit
- Firmware update required on already-deployed devices (must re-flash `.ino`)

### Risks
- **Mylnikov API downtime**: The API has no SLA and could go offline. Mitigation: the location call is fire-and-forget — if Mylnikov is down, the device continues operating normally with no location data. Existing location data in the database is preserved. If Mylnikov is permanently discontinued, switching to another provider (Unwired Labs, Google) requires changing only the backend function, not the firmware or frontend.
- **BSSID not found**: Some APs may not exist in Mylnikov's 34.5M record database. Mitigation: the weighted centroid is computed from whichever BSSIDs resolve successfully — even 1 out of 5 is enough to get a location. If zero resolve, the endpoint returns a 422 error and the device continues without location.
- **Nominatim rate limit**: 1 req/sec for reverse geocoding could bottleneck if many devices boot simultaneously. Mitigation: the backend caches results (24h dedup); coordinates are still available even if reverse geocoding fails (falls back to "lat, lon" text format).
- **Privacy**: WiFi AP BSSIDs are sent to Mylnikov's API. Mitigation: only BSSID is sent (no SSID, no device identity, no user data). Mylnikov cannot correlate BSSIDs to Sparked Sense users or devices.

## Implementation order

1. Database migration (add `latitude`, `longitude`, `location_accuracy` columns) — already done
2. Backend endpoint `POST /server/device-location` with Mylnikov API + weighted centroid + 1h dedup cache
3. Firmware `scanAndReportLocation()` function in `ESP.ino` — already done
4. Update sensor code templates (`temperature.ts`, `humidity.ts`, `ph.ts`) — already done
5. Frontend: display coordinates on sensor detail page — already done
6. (Future) Map visualization on public sensors page

## References

- [Mylnikov Geo-Location API](https://www.mylnikov.org/archives/1170) — Free open WiFi geolocation database (~34.5M APs, MIT license)
- [Nominatim reverse geocoding](https://nominatim.openstreetmap.org/) — OpenStreetMap address lookup
- [gonzague/wifi-geolocate-worker](https://github.com/gonzague/wifi-geolocate-worker) — Cloudflare Worker for Apple WiFi (evaluated but rejected for stability concerns)
