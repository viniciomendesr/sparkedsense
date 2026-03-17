# ADR-009: WiFi-based geolocation for physical sensors

**Date:** 2026-03-17 (updated 2026-03-17)
**Status:** Accepted

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

Implement WiFi-based geolocation using **Apple's WiFi Positioning Service** via a self-hosted Cloudflare Worker as the geolocation provider. The worker handles BSSID resolution, RSSI-weighted centroid calculation, and reverse geocoding in a single batch request.

### Geolocation provider selection

| Provider | Cost | Limit | Coverage | API key | Infrastructure | Stability |
|----------|------|-------|----------|---------|----------------|-----------|
| **Apple via Cloudflare Worker** | **Zero** | **Unlimited** | **Excellent (billions of APs)** | **None** | **Cloudflare free tier** | **Stable (API since ~2012)** |
| Mylnikov API | Zero | Unlimited | Weak (~34.5M APs) | None | None | Risky (single maintainer, Russia-hosted, no SLA) |
| Unwired Labs | Zero | 100/day | Good | Yes | None | Stable |
| Google Geolocation API | $5/1000 req | Billing required | Excellent | Yes | None | Stable |
| Combain | Zero | 1000/month | Good | Yes | None | Stable |
| Mozilla Location Service | — | Discontinued (2024) | — | — | — | — |

### Why Apple WiFi DB via Cloudflare Worker?

**Initially Mylnikov was chosen** for its zero-infrastructure simplicity, but re-evaluation revealed critical weaknesses:
- **Coverage gap**: ~34.5M APs is ~0.5% of Apple's database — poor coverage in rural Brazil
- **Single maintainer**: Alexander Mylnikov, no SLA, no support, Russia-hosted
- **Sequential requests**: 5 HTTP calls per device boot (one per BSSID) vs 1 batch call
- **No fallback**: if BSSIDs not found, device gets no location at all

**Apple WiFi via Cloudflare Worker** is superior because:
- **Massive coverage** — every iPhone/Mac contributes AP data (billions of records)
- **Excellent Brazil coverage** — iPhones are very popular in Brazil
- **Single batch request** — one POST resolves all BSSIDs at once (~50-100ms vs ~500ms)
- **Built-in fallback** — Cloudflare's `request.cf` provides IP-based geolocation when WiFi lookup fails
- **Self-contained** — the worker code is in our repo (`wifi-geolocate-worker/`), not an external dependency
- **Worker handles everything** — BSSID resolution, weighted centroid, reverse geocoding, auto-upgrade
- **Free** — Cloudflare Workers free tier allows 100K requests/day
- **Stable API** — Apple's `gs-loc.apple.com/clls/wloc` endpoint has existed since ~2012, used by Apple's own devices

The original concerns about using an "undocumented API from a 3-star repo" were addressed:
1. The worker code was rewritten/customized (671 lines) with robust error handling — it's our own code, not a dependency
2. Apple's WiFi Positioning Service is used by every Apple device — it's as stable as any Apple service
3. A Cloudflare Worker on the free tier is trivial infrastructure

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
    │       ├─ POST to Cloudflare Worker (single batch request)
    │       │     → Worker queries Apple WiFi DB (gs-loc.apple.com/clls/wloc)
    │       │     → Computes RSSI-weighted centroid
    │       │     → Reverse geocodes via Nominatim
    │       │     → Falls back to IP geolocation if no WiFi match
    │       │
    │       ├─ Extracts triangulated lat/lng + address from worker response
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
4. Sends a single POST to the Cloudflare Worker (`GEOLOCATE_WORKER_URL` env var):
   ```json
   POST https://geolocate.<account>.workers.dev/
   {
     "accessPoints": [
       { "bssid": "AA:BB:CC:DD:EE:FF", "signal": -45 },
       { "bssid": "11:22:33:44:55:66", "signal": -67 }
     ],
     "all": false,
     "reverseGeocode": true
   }
   ```
5. The worker handles all geolocation logic:
   - Queries Apple WiFi DB via protobuf (`gs-loc.apple.com/clls/wloc`)
   - Computes RSSI-weighted centroid from resolved APs
   - Reverse geocodes via Nominatim
   - Falls back to Cloudflare IP geolocation if no WiFi match
   - Auto-upgrades to `all=true` if exact BSSIDs not found
6. Backend extracts triangulated location (preferred) or first result from worker response
7. Updates the `devices` table:
   - `location` (TEXT): Human-readable address (e.g., "Campinas, SP, Brazil")
   - `latitude` (NUMERIC): Decimal latitude
   - `longitude` (NUMERIC): Decimal longitude
   - `location_accuracy` (NUMERIC): Accuracy in meters
8. Also updates the KV store cache for the corresponding sensor entry

**Authentication:** The endpoint uses the same `supabaseAnonKey` Bearer token as `/sensor-data` — no user JWT required. The device is identified by its `nftAddress`.

**Deduplication cache:** 24 hours. If the device reboots multiple times within 24 hours, the backend returns the cached location without querying the worker. This protects against reboot loops and ensures **stable location hashes on the blockchain** — RSSI-based centroid can vary slightly between scans even at the same physical location, and frequent recalculations would create unnecessary hash changes on-chain that don't represent real sensor movement.

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

### 6. Cloudflare Worker details

The worker source code lives in `wifi-geolocate-worker/` and is deployed to Cloudflare Workers (free tier).

**Deploy:**
```bash
cd wifi-geolocate-worker && npx wrangler deploy
```

**Environment variable:** Set `GEOLOCATE_WORKER_URL` in Supabase Edge Function secrets to the deployed worker URL (e.g., `https://geolocate.<account>.workers.dev/`).

**Worker features:**
- Queries Apple's WiFi Positioning Service (`gs-loc.apple.com/clls/wloc`) via Protocol Buffers
- RSSI-weighted centroid calculation (same `10^(dBm/10)` formula)
- Reverse geocoding via Nominatim (smart strategy: geocodes triangulated position when available)
- IP-based fallback via Cloudflare's `request.cf` geolocation
- Auto-upgrade: retries with `all=true` if exact BSSIDs not found
- Smart Placement enabled (Cloudflare routes to optimal datacenter)

**API:** See `wifi-geolocate-worker/readme.md` for full API reference.

## Consequences

### Positive
- Automatic location for all real sensors without user intervention
- Works indoors (greenhouses, labs) where GPS fails
- **Zero cost** — Cloudflare Workers free tier (100K requests/day)
- **Excellent coverage** — Apple's WiFi DB has billions of APs (every iPhone/Mac contributes)
- **Single batch request** — one POST resolves all BSSIDs (~50-100ms vs ~500ms with Mylnikov)
- **Built-in fallback** — IP-based geolocation via Cloudflare when WiFi lookup fails
- **Self-contained** — worker code is in our repo, not an external dependency
- Non-blocking and non-critical — device operates normally if geolocation fails
- Coordinates enable future map-based visualization
- One-time scan per boot minimizes resource usage
- Compatible with both ESP8266 and ESP32-S3
- Worker-computed weighted centroid improves accuracy with multiple APs
- 24-hour dedup cache ensures stable on-chain location hashes and protects against reboot loops

### Negative
- Apple's WiFi Positioning Service is **undocumented** — protocol could change (though it has been stable since ~2012)
- Requires deploying and maintaining a Cloudflare Worker (trivial, but still extra infrastructure)
- Reverse geocoding via Nominatim has a 1 request/second rate limit (handled by worker's smart geocoding strategy)
- Firmware update required on already-deployed devices (must re-flash `.ino`)

### Risks
- **Apple API change**: The `gs-loc.apple.com/clls/wloc` endpoint is undocumented. Mitigation: this API has been stable since ~2012 as Apple's own devices depend on it. If it changes, only the worker's protobuf encoding/decoding needs updating — the backend and firmware are unaffected.
- **Cloudflare Worker downtime**: Mitigation: Cloudflare Workers have 99.99% uptime SLA. The location call is fire-and-forget — if the worker is down, the device continues operating normally.
- **BSSID not found**: Mitigation: Apple's database is orders of magnitude larger than alternatives. The worker auto-upgrades to `all=true` to find nearby APs. If still nothing, Cloudflare's IP geolocation provides city-level fallback.
- **Nominatim rate limit**: 1 req/sec for reverse geocoding. Mitigation: the worker uses smart geocoding (only geocodes the triangulated position, not each AP). Backend caches results (24h dedup).
- **Privacy**: WiFi AP BSSIDs are sent to Apple via the worker. Mitigation: only BSSIDs are sent (no SSID, no device identity, no user data). The worker runs on our Cloudflare account — Apple sees requests from Cloudflare, not from our devices or users.

## Implementation order

1. Database migration (add `latitude`, `longitude`, `location_accuracy` columns) — done
2. Deploy Cloudflare Worker (`cd wifi-geolocate-worker && npx wrangler deploy`) — **pending**
3. Set `GEOLOCATE_WORKER_URL` env var in Supabase Edge Function secrets — **pending**
4. Backend endpoint `POST /server/device-location` with Apple WiFi via worker — done
5. Firmware `scanAndReportLocation()` function in `ESP.ino` — done (no changes needed, same payload format)
6. Update sensor code templates (`temperature.ts`, `humidity.ts`, `ph.ts`) — done
7. Frontend: display coordinates on sensor detail page — done
8. (Future) Map visualization on public sensors page

## References

- [Apple WiFi Positioning Service](https://fx.aguessy.fr/resources/pdf-articles/Rapport-PFE-interception-SSL-analyse-localisation-smatphones.pdf) — Academic research on the protocol
- [apple_bssid_locator](https://github.com/darkosancanin/apple_bssid_locator) — Original Python reference implementation
- [Nominatim reverse geocoding](https://nominatim.openstreetmap.org/) — OpenStreetMap address lookup
- `wifi-geolocate-worker/` — Our Cloudflare Worker implementation (adapted from gonzague/wifi-geolocate-worker)
