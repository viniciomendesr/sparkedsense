const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const USER_AGENT = 'locationd/1753.17 CFNetwork/889.9 Darwin/17.2.0';

class AppleServiceError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.name = 'AppleServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export default {
  async fetch(request) {
    try {
      const { accessPoints: rawAccessPoints, includeAll, reverseGeocode } = await extractParams(request);
      const accessPoints = rawAccessPoints.map((point) => ({
        bssid: normalizeBssid(point.bssid),
        signal: normalizeSignal(point.signal),
      }));
      const uniqueAccessPoints = Array.from(new Map(accessPoints.map((point) => [point.bssid, point])).values());
      
      // First attempt with the user's includeAll preference
      let parsedDevices = await collectAppleDevices(uniqueAccessPoints, includeAll);
      let formatted = await formatResults(parsedDevices, accessPoints, includeAll, reverseGeocode);
      
      // Auto-upgrade: If not found and user specified all=false, retry with all=true
      if (!formatted.found && !includeAll) {
        parsedDevices = await collectAppleDevices(uniqueAccessPoints, true);
        formatted = await formatResults(parsedDevices, accessPoints, true, reverseGeocode);
        
        // Mark that we auto-upgraded
        if (formatted.found) {
          formatted.autoUpgraded = true;
          formatted.query.all = true;
        }
      }
      
      const fallback = extractIpFallback(request.cf);
      if (!formatted.found && fallback) {
        formatted.fallback = fallback;
      }

      return jsonResponse(formatted);
    } catch (error) {
      const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 400;
      const payload = { error: error?.message ?? 'Unexpected error.' };
      if (error?.details && typeof error.details === 'object') {
        Object.assign(payload, error.details);
      }
      return jsonResponse(payload, statusCode);
    }
  },
};

async function collectAppleDevices(accessPoints, includeAll) {
  const seen = new Set();
  const aggregated = [];
  for (const point of accessPoints) {
    const devices = await requestAppleDevices([point], includeAll);
    for (const device of devices) {
      if (!device || typeof device.bssid !== 'string' || !device.location) {
        continue;
      }
      const normalized = tryNormalizeBssid(device.bssid);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      aggregated.push(device);
    }
  }
  return aggregated;
}

async function requestAppleDevices(accessPoints, includeAll) {
  const protobufRequest = encodeAppleWLocRequest(accessPoints, includeAll);
  const payload = buildEnvelope(protobufRequest);

  const response = await fetch('https://gs-loc.apple.com/clls/wloc', {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT },
    body: payload,
  });

  if (!response.ok) {
    throw new AppleServiceError('Apple location service returned a non-success status.', 502, {
      status: response.status,
    });
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.length <= 10) {
    throw new AppleServiceError('Apple location service returned an unexpected payload.', 502);
  }

  return parseAppleWLoc(body.subarray(10));
}

async function extractParams(request) {
  const url = new URL(request.url);
  const includeAllQuery = parseBoolean(url.searchParams.get('all'));
  const reverseGeocodeQuery = parseBoolean(url.searchParams.get('reverseGeocode'));
  const method = request.method.toUpperCase();

  if (method !== 'POST') {
    const bssid = url.searchParams.get('bssid');
    if (!bssid) {
      throw new Error('Provide `bssid` as a query string parameter or use POST JSON with `accessPoints`.');
    }
    return {
      accessPoints: [{ bssid, signal: null }],
      includeAll: includeAllQuery,
      reverseGeocode: reverseGeocodeQuery,
    };
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('POST requests must use JSON (`application/json`).');
  }

  const body = await request.json();
  const includeAllBody = typeof body.all !== 'undefined' ? parseBoolean(String(body.all)) : includeAllQuery;
  const reverseGeocodeBody = typeof body.reverseGeocode !== 'undefined'
    ? parseBoolean(String(body.reverseGeocode))
    : reverseGeocodeQuery;

  if (Array.isArray(body.accessPoints) && body.accessPoints.length > 0) {
    const accessPoints = body.accessPoints.map((point, index) => {
      if (!point || typeof point.bssid !== 'string') {
        throw new Error(`accessPoints[${index}].bssid must be a string.`);
      }
      return {
        bssid: point.bssid,
        signal: point.signal ?? null,
      };
    });
    return {
      accessPoints,
      includeAll: includeAllBody,
      reverseGeocode: reverseGeocodeBody,
    };
  }

  if (typeof body.bssid === 'string') {
    return {
      accessPoints: [{ bssid: body.bssid, signal: body.signal ?? null }],
      includeAll: includeAllBody,
      reverseGeocode: reverseGeocodeBody,
    };
  }

  throw new Error('POST JSON payload must include `accessPoints` array with `bssid` values.');
}

function parseBoolean(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '' || normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeSignal(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return numeric;
    }
  }
  throw new Error('Signal strength must be a finite number.');
}

function normalizeBssid(input) {
  const hex = input.replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (hex.length !== 12) {
    throw new Error('Each BSSID must contain 12 hexadecimal characters.');
  }
  const parts = [];
  for (let i = 0; i < hex.length; i += 2) {
    parts.push(hex.slice(i, i + 2));
  }
  return parts.join(':');
}

function tryNormalizeBssid(input) {
  try {
    return normalizeBssid(input);
  } catch (_) {
    return null;
  }
}

function encodeAppleWLocRequest(accessPoints, includeAll) {
  if (!Array.isArray(accessPoints) || accessPoints.length === 0) {
    throw new Error('At least one access point is required.');
  }

  const message = [];
  for (const point of accessPoints) {
    const bssidBytes = TEXT_ENCODER.encode(point.bssid);
    const wifiDevice = [
      0x0a,
      ...encodeVarint(bssidBytes.length),
      ...bssidBytes,
    ];
    message.push(
      0x12,
      ...encodeVarint(wifiDevice.length),
      ...wifiDevice,
    );
  }

  message.push(0x18, ...encodeVarint(0));
  const returnSingle = !includeAll && accessPoints.length === 1 ? 1 : 0;
  message.push(0x20, ...encodeVarint(returnSingle));

  return Uint8Array.from(message);
}

function buildEnvelope(message) {
  const segments = [
    Uint8Array.from([0x00, 0x01, 0x00, 0x05]),
    TEXT_ENCODER.encode('en_US'),
    Uint8Array.from([0x00, 0x13]),
    TEXT_ENCODER.encode('com.apple.locationd'),
    Uint8Array.from([0x00, 0x0a]),
    TEXT_ENCODER.encode('8.1.12B411'),
    Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]),
    Uint8Array.from([message.length]),
    message,
  ];

  const totalLength = segments.reduce((sum, arr) => sum + arr.length, 0);
  const envelope = new Uint8Array(totalLength);
  let offset = 0;
  for (const segment of segments) {
    envelope.set(segment, offset);
    offset += segment.length;
  }
  return envelope;
}

function parseAppleWLoc(buffer) {
  const devices = [];
  let offset = 0;
  while (offset < buffer.length) {
    const [tag, newOffset] = readVarint(buffer, offset);
    offset = newOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x07n);

    if (fieldNumber === 2 && wireType === 2) {
      const [length, lengthOffset] = readVarint(buffer, offset);
      offset = lengthOffset;
      const end = offset + Number(length);
      devices.push(parseWifiDevice(buffer.subarray(offset, end)));
      offset = end;
    } else {
      offset = skipField(buffer, offset, wireType);
    }
  }
  return devices;
}

function parseWifiDevice(buffer) {
  let offset = 0;
  let bssid = null;
  let location = null;

  while (offset < buffer.length) {
    const [tag, newOffset] = readVarint(buffer, offset);
    offset = newOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x07n);

    if (fieldNumber === 1 && wireType === 2) {
      const [length, lengthOffset] = readVarint(buffer, offset);
      offset = lengthOffset;
      const end = offset + Number(length);
      bssid = TEXT_DECODER.decode(buffer.subarray(offset, end));
      offset = end;
    } else if (fieldNumber === 2 && wireType === 2) {
      const [length, lengthOffset] = readVarint(buffer, offset);
      offset = lengthOffset;
      const end = offset + Number(length);
      location = parseLocation(buffer.subarray(offset, end));
      offset = end;
    } else {
      offset = skipField(buffer, offset, wireType);
    }
  }

  return { bssid, location };
}

function parseLocation(buffer) {
  let offset = 0;
  let latitude = null;
  let longitude = null;

  while (offset < buffer.length) {
    const [tag, newOffset] = readVarint(buffer, offset);
    offset = newOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x07n);

    if (wireType === 0) {
      const [value, nextOffset] = decodeInt64(buffer, offset);
      offset = nextOffset;
      if (fieldNumber === 1) {
        latitude = value;
      } else if (fieldNumber === 2) {
        longitude = value;
      }
    } else {
      offset = skipField(buffer, offset, wireType);
    }
  }

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitudeE8: Number(latitude), longitudeE8: Number(longitude) };
}

function decodeInt64(buffer, offset) {
  const [value, nextOffset] = readVarint(buffer, offset);
  const signed = value > 0x7fffffffffffffffn ? value - 0x10000000000000000n : value;
  return [signed, nextOffset];
}

function skipField(buffer, offset, wireType) {
  switch (wireType) {
    case 0: {
      const [, nextOffset] = readVarint(buffer, offset);
      return nextOffset;
    }
    case 1:
      return offset + 8;
    case 2: {
      const [length, nextOffset] = readVarint(buffer, offset);
      return nextOffset + Number(length);
    }
    case 5:
      return offset + 4;
    default:
      throw new Error(`Unsupported wire type: ${wireType}`);
  }
}

function readVarint(buffer, offset) {
  let result = 0n;
  let shift = 0n;
  let position = offset;
  while (position < buffer.length) {
    const byte = buffer[position++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [result, position];
    }
    shift += 7n;
  }
  throw new Error('Encountered truncated varint.');
}

function encodeVarint(value) {
  let n = BigInt(value);
  const bytes = [];
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return bytes;
}

async function reverseGeocode(latitude, longitude) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'geolocate-worker/1.0',
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data && data.display_name) {
      return {
        displayName: data.display_name,
        address: data.address || {},
      };
    }
  } catch (error) {
    // Silently fail for reverse geocoding errors
    console.warn('Reverse geocoding failed:', error.message);
  }
  return null;
}

async function formatResults(devices, requestedAccessPoints, includeAll, shouldReverseGeocode = false) {
  const requestedMap = new Map();
  for (const point of requestedAccessPoints) {
    const existing = requestedMap.get(point.bssid) ?? { signals: [] };
    if (point.signal !== null && Number.isFinite(point.signal)) {
      existing.signals.push(point.signal);
    }
    requestedMap.set(point.bssid, existing);
  }
  const requestedKeys = new Set(requestedMap.keys());

  const aggregatedResults = [];
  const triangulationCandidates = [];

  for (const device of devices) {
    if (!device || !device.bssid || !device.location) {
      continue;
    }
    const normalized = tryNormalizeBssid(device.bssid);
    if (!normalized) {
      continue;
    }

    const latitude = device.location.latitudeE8 / 1e8;
    const longitude = device.location.longitudeE8 / 1e8;
    if (latitude === -180 && longitude === -180) {
      continue;
    }

    const requestEntry = requestedMap.get(normalized);
    const signals = requestEntry?.signals ?? [];
    const summary = summarizeSignals(signals);

    const result = {
      bssid: normalized,
      latitude,
      longitude,
      mapUrl: `https://www.google.com/maps/place/${latitude},${longitude}`,
      ...(summary ? summary : {}),
    };

    aggregatedResults.push(result);

    const weight = signals.reduce((total, signal) => total + weightFromSignal(signal), 0);
    if (weight > 0) {
      triangulationCandidates.push({ latitude, longitude, weight });
    }
  }

  const results = includeAll
    ? aggregatedResults
    : aggregatedResults.filter((entry) => requestedKeys.has(entry.bssid));

  const triangulated = computeTriangulatedLocation(triangulationCandidates);
  const response = {
    query: {
      accessPoints: requestedAccessPoints,
      all: includeAll,
    },
    found: results.length > 0,
    results,
  };

  if (triangulated) {
    response.triangulated = {
      latitude: triangulated.latitude,
      longitude: triangulated.longitude,
      pointsUsed: triangulated.pointsUsed,
      weightSum: triangulated.weightSum,
      method: 'weighted-centroid',
      signalWeightModel: '10^(dBm/10)',
    };
  }

  // Smart reverse geocoding strategy
  if (shouldReverseGeocode && results.length > 0) {
    if (triangulated) {
      // When we have a triangulated location, geocode that (most accurate position)
      const address = await reverseGeocode(triangulated.latitude, triangulated.longitude);
      if (address) {
        response.triangulated.address = address;
      }
    } else {
      // No triangulation: use the old strategy (geocode requested BSSIDs or first result)
      const requestedBssids = new Set(requestedAccessPoints.map(ap => ap.bssid));
      let hasExactMatch = false;
      
      // First pass: Check if we have any exact matches
      for (const result of results) {
        if (requestedBssids.has(result.bssid)) {
          hasExactMatch = true;
          break;
        }
      }
      
      // Second pass: Geocode appropriately
      for (const result of results) {
        const isExactMatch = requestedBssids.has(result.bssid);
        
        if (hasExactMatch) {
          // If we have exact matches, only geocode those
          if (isExactMatch) {
            const address = await reverseGeocode(result.latitude, result.longitude);
            if (address) {
              result.address = address;
            }
          }
        } else {
          // No exact matches: geocode only the first result
          const address = await reverseGeocode(result.latitude, result.longitude);
          if (address) {
            result.address = address;
          }
          break; // Only geocode the first one
        }
      }
    }
  }

  return response;
}

function summarizeSignals(signals) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return null;
  }
  let min = signals[0];
  let max = signals[0];
  let total = 0;
  for (const value of signals) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    total += value;
  }
  const average = total / signals.length;
  return {
    signal: Number(average.toFixed(2)),
    signalCount: signals.length,
    signalMin: min,
    signalMax: max,
  };
}

function weightFromSignal(signal) {
  if (!Number.isFinite(signal)) {
    return 0;
  }
  const clamped = Math.max(Math.min(signal, -5), -120);
  return Math.pow(10, clamped / 10);
}

function computeTriangulatedLocation(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  let totalWeight = 0;
  let x = 0;
  let y = 0;
  let z = 0;

  for (const point of points) {
    const weight = point.weight;
    if (!(weight > 0)) {
      continue;
    }
    const latRad = toRadians(point.latitude);
    const lonRad = toRadians(point.longitude);
    const cosLat = Math.cos(latRad);

    x += cosLat * Math.cos(lonRad) * weight;
    y += cosLat * Math.sin(lonRad) * weight;
    z += Math.sin(latRad) * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  x /= totalWeight;
  y /= totalWeight;
  z /= totalWeight;

  const hyp = Math.sqrt(x * x + y * y);
  const latitude = Math.atan2(z, hyp);
  const longitude = Math.atan2(y, x);

  return {
    latitude: Number(toDegrees(latitude).toFixed(7)),
    longitude: Number(toDegrees(longitude).toFixed(7)),
    pointsUsed: points.length,
    weightSum: totalWeight,
  };
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function extractIpFallback(cf) {
  if (!cf) {
    return null;
  }

  const latitude = cf.latitude !== undefined ? Number(cf.latitude) : null;
  const longitude = cf.longitude !== undefined ? Number(cf.longitude) : null;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const response = {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    precision: cf.metroCode ? 'metro' : 'city',
    source: 'cloudflare-geoip',
  };

  if (cf.metroCode) {
    response.metroCode = cf.metroCode;
  }
  if (cf.country) {
    response.country = cf.country;
  }
  if (cf.region) {
    response.region = cf.region;
  }
  if (cf.city) {
    response.city = cf.city;
  }
  if (cf.postalCode) {
    response.postalCode = cf.postalCode;
  }

  return response;
}
