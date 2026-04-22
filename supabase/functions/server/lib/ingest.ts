/**
 * ADR-010: Sensor-agnostic ingestion envelope.
 *
 * Validates CloudEvents 1.0 envelopes, verifies the secp256k1 signature over
 * a canonical-JSON serialization of the envelope minus the `signature` field,
 * and performs lightweight type-schema validation for platform-blessed event
 * types. Custom types pass through as opaque JSONB.
 */

import * as secp256k1 from "https://esm.sh/@noble/curves@1.4.0/secp256k1";

// ---------------------------------------------------------------------------
// Envelope type
// ---------------------------------------------------------------------------

export interface Envelope {
  specversion: string;
  id: string;
  source: string;
  type: string;
  time: string;
  datacontenttype: string;
  data: unknown;
  signature: string;
}

export interface ValidationError {
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Platform-blessed type registry
// ---------------------------------------------------------------------------

const PLATFORM_NAMESPACE = "io.sparkedsense.";

type Validator = (data: unknown) => ValidationError | null;

const ok = (): null => null;
const err = (code: string, message: string): ValidationError => ({ code, message });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

// SenML record array (RFC 8428)
const validateSenml: Validator = (data) => {
  if (!Array.isArray(data)) return err("senml_not_array", "SenML payload must be an array of records");
  if (data.length === 0) return err("senml_empty", "SenML payload must have at least one record");
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (!isPlainObject(r)) return err("senml_record_not_object", `Record ${i} must be an object`);
    if (typeof r.n !== "string" || r.n.length === 0) return err("senml_missing_n", `Record ${i} missing string 'n'`);
    if (typeof r.u !== "string") return err("senml_missing_u", `Record ${i} missing string 'u'`);
    const valueFields = ["v", "vs", "vb", "vd"].filter((k) => k in r);
    if (valueFields.length !== 1) return err("senml_value_cardinality", `Record ${i} must have exactly one of v/vs/vb/vd`);
    if ("v" in r && !isFiniteNumber(r.v)) return err("senml_v_not_number", `Record ${i}: v must be a finite number`);
  }
  return ok();
};

const validateClassification: Validator = (data) => {
  if (!isPlainObject(data)) return err("classification_not_object", "data must be an object");
  if (typeof data.class !== "string" || data.class.length === 0) return err("classification_missing_class", "class is required");
  if (!isFiniteNumber(data.confidence) || data.confidence < 0 || data.confidence > 1) return err("classification_bad_confidence", "confidence must be 0..1");
  if (typeof data.model_id !== "string" || data.model_id.length === 0) return err("classification_missing_model_id", "model_id is required");
  return ok();
};

const validateRegression: Validator = (data) => {
  if (!isPlainObject(data)) return err("regression_not_object", "data must be an object");
  if (!isFiniteNumber(data.value)) return err("regression_missing_value", "value must be a finite number");
  if (typeof data.model_id !== "string" || data.model_id.length === 0) return err("regression_missing_model_id", "model_id is required");
  return ok();
};

const validateDetection: Validator = (data) => {
  if (!isPlainObject(data)) return err("detection_not_object", "data must be an object");
  if (typeof data.detected !== "boolean") return err("detection_missing_detected", "detected must be boolean");
  if (typeof data.model_id !== "string" || data.model_id.length === 0) return err("detection_missing_model_id", "model_id is required");
  return ok();
};

const validateTranscription: Validator = (data) => {
  if (!isPlainObject(data)) return err("transcription_not_object", "data must be an object");
  if (typeof data.text !== "string") return err("transcription_missing_text", "text is required");
  if (typeof data.engine !== "string" || data.engine.length === 0) return err("transcription_missing_engine", "engine is required");
  return ok();
};

const validateSemanticSummary: Validator = (data) => {
  if (!isPlainObject(data)) return err("summary_not_object", "data must be an object");
  if (typeof data.summary !== "string" || data.summary.length === 0) return err("summary_missing_summary", "summary is required");
  if (typeof data.engine !== "string" || data.engine.length === 0) return err("summary_missing_engine", "engine is required");
  return ok();
};

const validateRawAudio: Validator = (data) => {
  if (!isPlainObject(data)) return err("raw_audio_not_object", "data must be an object");
  if (typeof data.audio_base64 !== "string" || data.audio_base64.length === 0) return err("raw_audio_missing_audio", "audio_base64 is required");
  if (!isFiniteNumber(data.sample_rate) || data.sample_rate <= 0) return err("raw_audio_bad_sample_rate", "sample_rate must be > 0");
  if (!isFiniteNumber(data.duration_ms) || data.duration_ms < 0) return err("raw_audio_bad_duration", "duration_ms must be >= 0");
  return ok();
};

const PLATFORM_VALIDATORS: Record<string, Validator> = {
  "io.sparkedsense.sensor.environmental": validateSenml,
  "io.sparkedsense.sensor.generic": validateSenml,
  "io.sparkedsense.inference.classification": validateClassification,
  "io.sparkedsense.inference.regression": validateRegression,
  "io.sparkedsense.inference.detection": validateDetection,
  "io.sparkedsense.inference.transcription": validateTranscription,
  "io.sparkedsense.inference.semantic_summary": validateSemanticSummary,
  "io.sparkedsense.raw.audio": validateRawAudio,
};

export const isPlatformType = (type: string): boolean => type.startsWith(PLATFORM_NAMESPACE);

// ---------------------------------------------------------------------------
// Envelope shape validation
// ---------------------------------------------------------------------------

const ISO_MS_Z_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const validateEnvelopeShape = (body: unknown): { envelope: Envelope | null; error: ValidationError | null } => {
  if (!isPlainObject(body)) return { envelope: null, error: err("envelope_not_object", "Envelope must be a JSON object") };

  const required = ["specversion", "id", "source", "type", "time", "datacontenttype", "data", "signature"];
  for (const k of required) {
    if (!(k in body)) return { envelope: null, error: err("envelope_missing_field", `Missing required envelope field: ${k}`) };
  }

  if (body.specversion !== "1.0") return { envelope: null, error: err("envelope_bad_specversion", "specversion must be '1.0'") };
  if (typeof body.id !== "string" || body.id.length === 0) return { envelope: null, error: err("envelope_bad_id", "id must be a non-empty string") };
  if (typeof body.source !== "string" || !body.source.startsWith("spark:device:")) {
    return { envelope: null, error: err("envelope_bad_source", "source must be 'spark:device:<pubkey_hex>'") };
  }
  if (typeof body.type !== "string" || body.type.length === 0) return { envelope: null, error: err("envelope_bad_type", "type must be a non-empty string") };
  if (typeof body.time !== "string" || !ISO_MS_Z_REGEX.test(body.time)) {
    return { envelope: null, error: err("envelope_bad_time", "time must be ISO-8601 with millisecond precision and Z suffix") };
  }
  if (typeof body.datacontenttype !== "string" || body.datacontenttype.length === 0) {
    return { envelope: null, error: err("envelope_bad_datacontenttype", "datacontenttype is required") };
  }
  // `unsigned_dev` is the ADR-011 bypass marker for Node 2 during the 2026-04-24
  // demo window. Shape check lets it through; the POST /reading handler decides
  // whether to actually skip signature verification. TODO(ADR-011).
  if (typeof body.signature !== "string" || (body.signature !== "unsigned_dev" && !/^[0-9a-fA-F]+$/.test(body.signature))) {
    return { envelope: null, error: err("envelope_bad_signature", "signature must be a hex-encoded string or the ADR-011 bypass marker") };
  }

  return { envelope: body as unknown as Envelope, error: null };
};

export const validateTypedPayload = (type: string, data: unknown): ValidationError | null => {
  const validator = PLATFORM_VALIDATORS[type];
  if (!validator) return ok(); // unregistered type — accept as opaque
  return validator(data);
};

// ---------------------------------------------------------------------------
// Canonical JSON — keys sorted recursively, no whitespace
// ---------------------------------------------------------------------------

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortObjectKeysDeep);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortObjectKeysDeep(value[k]);
    return out;
  }
  return value;
};

export const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.length % 2 === 0 ? hex : "0" + hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return bytes;
};

/**
 * Verify the envelope's signature against the device public key.
 *
 * - `signature` is a hex-encoded secp256k1 compact signature (64 bytes = 128 hex chars).
 * - Signed payload is canonical JSON of the envelope minus the `signature` field.
 * - Hash is SHA-256 of the canonical payload bytes.
 * - lowS is NOT enforced (uECC on ESP8266 doesn't normalize; consistent with ADR-003).
 */
export const verifyEnvelopeSignature = async (envelope: Envelope, devicePublicKeyHex: string): Promise<boolean> => {
  const { signature, ...rest } = envelope;
  const canonical = canonicalJson(rest);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const msgHash = new Uint8Array(digest);

  const sigBytes = hexToBytes(signature);
  if (sigBytes.length !== 64) return false;

  const pubKeyBytes = hexToBytes(devicePublicKeyHex);

  try {
    const sigObj = secp256k1.secp256k1.Signature.fromCompact(sigBytes);
    return secp256k1.secp256k1.verify(sigObj, msgHash, pubKeyBytes, { lowS: false });
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Source parsing
// ---------------------------------------------------------------------------

export const parseSource = (source: string): string | null => {
  const m = source.match(/^spark:device:([0-9a-fA-F]+)$/);
  return m ? m[1] : null;
};
