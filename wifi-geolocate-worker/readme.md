# 📍 WiFi Geolocate Worker

![Geolocation Demo](https://img.shields.io/badge/Geolocate-WiFi%20Positioning-blue?style=for-the-badge&logo=wifi&logoColor=white)

> Cloudflare Worker that proxies Apple's Wi-Fi positioning service. Provide one or more Wi-Fi access point BSSIDs (MAC addresses) and the worker returns the latitude/longitude Apple has on record. When you include signal strength readings, the worker also performs a weighted centroid to approximate the device position.

## ✨ Features
- 🌐 Accepts single or batched BSSID lookups over HTTP (GET or POST JSON)
- ✅ Normalises and validates BSSIDs/signals before querying Apple
- 📊 Summarises per-BSSID signal samples when provided
- 🎯 Computes a weighted-centroid estimate when multiple signals are supplied
- 🔄 Falls back to Cloudflare's IP-based geolocation when Apple returns nothing
- 🗺️ Reverse geocoding - converts coordinates to human-readable addresses (optional)
- 🔄 Smart auto-upgrade - automatically retries with `all=true` if no results found

## 📋 Prerequisites
- **Node.js 18+** - Required to run Wrangler CLI. Install from [nodejs.org](https://nodejs.org/) or use a version manager like [Volta](https://volta.sh/) or [nvm](https://github.com/nvm-sh/nvm)
- **Wrangler CLI** - Cloudflare's command-line tool for Workers development. See [installation guide](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- **Cloudflare account** - With Workers enabled (works with free plans at [cloudflare.com](https://cloudflare.com))

## 🛠️ Wrangler Installation
Install Wrangler locally in your project (recommended) or globally:

**Local installation (recommended):**
```bash
npm install -D wrangler@latest
```

**Global installation:**
```bash
npm install -g wrangler@latest
```

**Check installation:**
```bash
npx wrangler --version
```

## ⚙️ Setup
1. 📦 Install project dependencies:
   ```bash
   npm install
   ```

2. 🔐 Authenticate Wrangler with your Cloudflare account (one-time setup):
   ```bash
   npx wrangler login
   ```
   This will open your browser to authenticate with Cloudflare. After authentication, you can close the browser tab and return to your terminal.

3. ⚙️ Verify your Wrangler configuration:
   ```bash
   npx wrangler whoami
   ```
   This should display your Cloudflare account email if authentication was successful.

## 🛠️ Local Development
Run the worker locally with Wrangler's dev server:
```bash
npx wrangler dev
```

Requests sent to the printed local endpoint (default `http://127.0.0.1:8787`) will be formatted & forwarded to Apple's service and return the worker's JSON payload.

## 🚀 Deployment
Publish the worker to Cloudflare:
```bash
npx wrangler deploy
```
The deployment uses `wrangler.toml`, which points to `worker/index.js` and enables Smart Placement plus log streaming.

## 📡 API Reference

### 🌐 GET `/`
Lookup a single access point by query string:
```
GET https://<your-worker>.workers.dev/?bssid=34:DB:FD:43:E3:A1&all=true&reverseGeocode=true
```
- `bssid` (required): 12 hexadecimal characters with or without separators.
- `all` (optional): Return every access point Apple responds with (`true`/`1`/`yes`). Defaults to `false`, which limits results to the requested BSSID(s).
- `reverseGeocode` (optional): Convert coordinates to human-readable addresses (`true`/`1`/`yes`). Defaults to `false`.

### 📮 POST `/`
Submit JSON to query multiple access points and optionally include received signal strength indicator (RSSI) values in dBm.
```json
{
  "accessPoints": [
    { "bssid": "34:DB:FD:43:E3:A1", "signal": -52 },
    { "bssid": "34:DB:FD:43:E3:B2", "signal": -60 },
    { "bssid": "34:DB:FD:40:01:10", "signal": -70 }
  ],
  "all": false,
  "reverseGeocode": true
}
```
- `accessPoints` (required): Array of objects with `bssid` (string) and optional `signal` (number).
- `all` (optional): Same behaviour as the query parameter.
- `reverseGeocode` (optional): Convert coordinates to human-readable addresses (`true`/`1`/`yes`). Defaults to `false`.

### 📄 Response Shape
A successful lookup returns JSON similar to:
```json
{
  "query": {
    "accessPoints": [
      { "bssid": "34:db:fd:43:e3:a1", "signal": -52 }
    ],
    "all": false
  },
  "found": true,
  "results": [
    {
      "bssid": "34:db:fd:43:e3:a1",
      "latitude": 48.856613,
      "longitude": 2.352222,
      "mapUrl": "https://www.google.com/maps/place/48.856613,2.352222",
      "signal": -52,
      "signalCount": 1,
      "signalMin": -52,
      "signalMax": -52,
      "address": {
        "displayName": "Champs-Élysées, Paris, Île-de-France, France",
        "address": {
          "road": "Champs-Élysées",
          "city": "Paris",
          "state": "Île-de-France",
          "country": "France"
        }
      }
    }
  ],
  "triangulated": {
    "latitude": 48.8571,
    "longitude": 2.3519,
    "pointsUsed": 3,
    "weightSum": 6.84,
    "method": "weighted-centroid",
    "signalWeightModel": "10^(dBm/10)"
  }
}
```

When Apple returns no usable coordinates, `found` is `false` and the response includes `fallback` with Cloudflare's IP-based location metadata:
```json
{
  "query": {
    "accessPoints": [
      { "bssid": "12:34:56:78:90:ab", "signal": -65 }
    ],
    "all": false
  },
  "found": false,
  "fallback": {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "accuracyRadius": 1000,
    "country": "US",
    "region": "NY",
    "city": "New York",
    "postalCode": "10001",
    "timezone": "America/New_York",
    "isp": "Cloudflare",
    "asOrganization": "Cloudflare, Inc."
  }
}
```

- Validation failures return HTTP 400 with an `error` message.
- Upstream problems with Apple result in HTTP 502 and an explanatory `error` payload.
- `address` field is only included in results when `reverseGeocode=true` is specified.
- When `all=false` returns no results, the system automatically retries with `all=true` and sets `autoUpgraded: true` in the response.

## 🔄 Smart Auto-Upgrade

When you query with `all=false` (or omit the parameter), the worker first attempts to find the exact BSSID you requested. If Apple doesn't have that specific BSSID in their database, the worker automatically retries with `all=true` to find nearby access points.

**How it works:**
1. Initial query with your `all` preference (default: `false`)
2. If no results found and `all=false`, automatically retry with `all=true`
3. If results found after retry, response includes `autoUpgraded: true`

**Example:**
```bash
# Query for a BSSID not in Apple's database
GET /?bssid=f8:ab:05:03:e9:40&all=false

# Response includes nearby access points and indicates auto-upgrade
{
  "query": {
    "accessPoints": [{"bssid": "f8:ab:05:03:e9:40", "signal": null}],
    "all": true  // ← Upgraded from false
  },
  "found": true,
  "autoUpgraded": true,  // ← Indicates automatic retry occurred
  "results": [ /* nearby access points */ ]
}
```

This feature improves the user experience by automatically providing useful results even when the exact BSSID isn't available.

## 🗺️ Reverse Geocoding Behavior

When `reverseGeocode=true` is specified, the worker intelligently decides which coordinates to geocode:

**Smart Geocoding Strategy:**

1. **Triangulated location exists** (multiple BSSIDs with signal strengths):
   - ✅ Only the **triangulated position** gets geocoded
   - ❌ Individual access points do NOT get geocoded
   - 🎯 Most accurate: The weighted centroid represents your actual location

2. **No triangulation** (single BSSID or no signals):
   - **Exact matches**: If your requested BSSID(s) are found, only those get geocoded
   - **No exact matches**: Only the first result gets geocoded
   - **Multiple requests**: All exact matches get geocoded

**Why this matters:**
- ✅ Geocodes the **most relevant location** (triangulated position when available)
- ✅ Respects Nominatim's 1 request/second rate limit
- ✅ Fast responses (~1 second instead of ~10+ seconds)
- ✅ Avoids redundant API calls (nearby APs often share the same address)
- ✅ Provides meaningful location context

**Examples:**
```bash
# With triangulation: Only triangulated location gets address
POST / {
  "accessPoints": [
    {"bssid": "aa:bb:cc:dd:ee:f1", "signal": -52},
    {"bssid": "aa:bb:cc:dd:ee:f2", "signal": -60},
    {"bssid": "aa:bb:cc:dd:ee:f3", "signal": -45}
  ],
  "reverseGeocode": true
}
# → 3 results (no addresses), triangulated object has address ✅

# Without triangulation: Exact match gets address
GET /?bssid=34:49:5b:af:62:f5&reverseGeocode=true
# → 1 result with address data

# No exact match (auto-upgraded): First result gets address
GET /?bssid=unknown:bssid&all=false&reverseGeocode=true
# → 6 nearby results, only first has address data
```

## 📝 Data Notes
- BSSIDs are normalised to lowercase colon-separated hex (e.g., `aa:bb:cc:dd:ee:ff`).
- Signal values are interpreted as RSSI in dBm and clamped between -120 and -5 when computing weights.
- Reverse geocoding uses OpenStreetMap's Nominatim API (free, no API keys required, 1 request/second rate limit).

## ⚠️ Caveats
Apple's Wi-Fi positioning service is undocumented and may change without notice. Use this worker responsibly and respect local laws and Apple terms of service.

## 🙏 Credits
This project builds upon foundational research and implementations in Wi-Fi geolocation:

**Academic Research:**
- **[François-Xavier AGUESSY](https://fx.aguessy.fr/resources/pdf-articles/Rapport-PFE-interception-SSL-analyse-localisation-smatphones.pdf)** - Comprehensive academic study on SSL interception and smartphone geolocation data analysis
- **[Côme DEMOUSTIER](https://www.linkedin.com/in/c%C3%B4me-demoustier-54943a45/)** - Co-author of the groundbreaking research on Apple's geolocation protocols

**Open Source Implementation:**
- **[Darko Sancanin](https://github.com/darkosancanin)** - Creator of **[Apple BSSID Locator](https://github.com/darkosancanin/apple_bssid_locator)**, the original Python tool for Wi-Fi access point geolocation

This Cloudflare Worker version adapts these concepts for serverless HTTP API deployment while maintaining compatibility with Apple's Location Services API and protocol buffer structures documented in the original research. However we didn't implement the cell towers part.

---

## 🔗 Useful Links

- **💻 Coded with the help of Cursor** - [Cursor IDE](https://go.gonzague.me/cursor) - The AI-powered code editor that helped build this project
- **🏠 For hosting, check out Hetzner** - [Hetzner Cloud](https://go.gonzague.me/hetzner) - Reliable cloud hosting with excellent performance
- **🛡️ For great DNS protection, use NextDNS** - [NextDNS](https://go.gonzague.me/nextdns) - Advanced DNS security and privacy protection
