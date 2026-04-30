/*
 * Node 2 — Fase 4: KWS + Sparked Sense publisher
 * Demo Claro 2026-04-24
 *
 * Fluxo:
 *   I²S (Sipeed MEMS) -> MFE -> CNN-INT8 -> softmax -> LED + HTTPS POST
 *
 * Publicação:
 *   Classes "claro" e "unknown" com prob >= 0.50 disparam POST em
 *   /server/reading com envelope CloudEvents 1.0 (ADR-010), tipo
 *   io.sparkedsense.inference.classification, signature "unsigned_dev" (ADR-011).
 *   "noise" nunca publica (silêncio/fundo não é evento). Cooldown compartilhado
 *   de 6s entre classes evita bater em 429 do rate limit backend (5s).
 *
 * Stack:
 *   - Arduino IDE 2.x, esp32 core v3.x
 *   - Tools: USB CDC On Boot DISABLED, Port wchusbserial (UART via CH343)
 *   - Board: ESP32S3 Dev Module (Waveshare MC N16R8)
 *
 * Patches de biblioteca aplicadas (reaplicar se reinstalar .zip):
 *   - tflite_learn_972566_32.h: arena_size 524288 (vs 209478 default)
 *   - ei_classifier_porting.cpp: ei_malloc/ei_calloc roteados pra PSRAM (>=2KB)
 */

#include <ESP_I2S.h>
#include <Audio_Classification_-_Keyword_Spotting_-_Demov1_inferencing.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
// ADR-014/ADR-016: real secp256k1 signing on Node 2. uECC for the curve math
// (Arduino Library Manager → "uECC"); mbedtls for SHA-256 (built into ESP32
// Arduino core, no extra install).
#include <uECC.h>
#include <mbedtls/sha256.h>

// ============================================================================
// Config
// ============================================================================

// Wi-Fi
static const char* WIFI_SSID     = "MVISIA_2.4GHz";
static const char* WIFI_PASSWORD = "mvisia2020";

// Endpoint do Sparked Sense (Supabase Edge Function direta, sem Bearer token)
static const char* INGEST_URL    = "https://djzexivvddzzduetmkel.supabase.co/functions/v1/server/reading";

// Identidade real do Nó 2 — ADR-014/ADR-016 path B.
// O par foi gerado off-device (openssl genkey on secp256k1) e hardcoded aqui;
// a pubkey antiga `021d5e...` era placeholder e nunca teve private key
// correspondente. Após re-flash, registra esta nova pubkey via UI "Rotate Key"
// no sensor detail (server atualiza devices.public_key + sensor.devicePublicKey).
//
// SECURITY NOTE: hardcoding chave privada é OK pra devnet/demo — ESP32-S3 sem
// secure boot armazena flash em texto claro de qualquer forma. Pra mainnet,
// migrar pra geração on-device + NVS criptografada (Preferences com encryption).
static const uint8_t DEVICE_PRIVATE_KEY[32] = {
  0x1b, 0x92, 0xc2, 0x7a, 0x78, 0x7c, 0x81, 0xf2,
  0xd1, 0x54, 0x0b, 0xae, 0xf9, 0xdb, 0x3d, 0x3d,
  0x18, 0xa7, 0x57, 0x78, 0xf8, 0x2a, 0xaf, 0x76,
  0x57, 0xa0, 0x47, 0x11, 0x29, 0x3f, 0xb7, 0xc5,
};
// Public key (X||Y, 64 bytes — uECC's native format, no 04 prefix).
// Derived offline: openssl ec -in priv.pem -pubout -text → strip leading 04.
static const uint8_t DEVICE_PUBLIC_KEY[64] = {
  0x22, 0xa8, 0xcf, 0x0c, 0xec, 0xa6, 0x57, 0x33,
  0x2c, 0x31, 0x4f, 0xf6, 0x2d, 0xf6, 0x71, 0xd6,
  0x8d, 0xe9, 0xb4, 0xa1, 0xcc, 0x20, 0x13, 0xd3,
  0x52, 0x38, 0x3a, 0x9d, 0xb1, 0xbd, 0x7d, 0xd7,
  0x5c, 0x5b, 0x2e, 0x9b, 0x80, 0x50, 0xab, 0xa8,
  0x42, 0x2f, 0xc9, 0x98, 0x9e, 0x31, 0xbc, 0x43,
  0x6a, 0x7d, 0x71, 0x78, 0xd7, 0x54, 0x59, 0x74,
  0x74, 0xaa, 0xca, 0x6d, 0x97, 0x75, 0x63, 0x56,
};
// Source string for the envelope, in uncompressed form (04 + X||Y = 130 hex chars).
// Built as a literal to avoid runtime concat. Must match what's stored on the
// backend `devices.public_key` after the rotate-pubkey call.
static const char* DEVICE_SOURCE =
  "spark:device:0422a8cf0ceca657332c314ff62df671d68de9b4a1cc2013d352383a9db1bd7dd75c5b2e9b8050aba8422fc9989e31bc436a7d7178d754597474aaca6d97756356";
static const char* MODEL_ID      = "ei-claro-kws-v84";

// ADR-011 temporary bypass.
// snprintf("%.3f"/"%.6f") emite zeros à direita (e.g. "confidence":0.970), mas
// o server canonicaliza com JSON.stringify (shortest round-trip → "0.97"). Os
// dois SHA-256 divergem e a verificação retorna 401 bad_signature. Enquanto a
// canonicalização não é portada pra ArduinoJson (igual ESP8266), enviamos
// signature="unsigned_dev" — o handler em /server/reading aceita o marcador e
// continua exigindo identidade via `source` → public_key. Voltar pra 0 depois
// que o builder canonical estiver ok.
#define UNSIGNED_DEV_BYPASS 1

// Localização física do nó (hardcoded — ESP32-S3 não tem GPS).
// Enviada como extensões CloudEvents top-level (`latitude`, `longitude`, `location`).
// Backend mirrora no registro do sensor apenas na PRIMEIRA vez (se sensor.latitude
// estiver vazio); edits manuais pela UI são autoritativos depois disso. Pra
// sobrescrever, basta zerar o campo na UI e publicar um evento de novo.
// Editar aqui conforme o local real da demo Claro (dia 24/04/2026).
static const float  DEVICE_LATITUDE  = -23.5573950f;  // Centro de Inovação da USP — INOVA USP
static const float  DEVICE_LONGITUDE = -46.7270685f;
static const char*  DEVICE_LOCATION  = "Butantã, São Paulo, São Paulo";

// I²S pinos (Sipeed MEMS -> ESP32-S3)
#define I2S_SCK_PIN 4   // BCLK
#define I2S_WS_PIN  5   // WS / LRCLK
#define I2S_SD_PIN  6   // DOUT do mic
#define LED_PIN     48  // WS2812 RGB onboard

#define SLICE_SIZE EI_CLASSIFIER_SLICE_SIZE

// Thresholds por classe.
// "claro" é a keyword alvo da demo — tem prioridade sobre o argmax: se a
// probabilidade da classe claro cruzar o threshold, publicamos claro mesmo que
// unknown/noise estejam maiores naquele frame. Isso dá mais chance de disparar
// durante a apresentação ao vivo, ao custo de tolerar falso-positivo ocasional.
// "unknown" precisa ser argmax + alta confiança + estável em 2 frames seguidos
// pra evitar inundar o dashboard com som ambiente mal classificado.
static const float PUBLISH_THRESHOLD_CLARO   = 0.30f;
static const float PUBLISH_THRESHOLD_UNKNOWN = 0.92f;

// Quantos frames consecutivos com unknown ≥ threshold são necessários pra
// disparar um POST. Claro publica imediatamente — "claro" é evento curto que
// não sobrevive a um gate de 2 frames. Unknown representa ruído sustentado ou
// palavra fora do vocabulário, que dura mais de um frame; exigir estabilidade
// filtra picos isolados como "unknown=0.67" em meio a frames de noise.
static const int UNKNOWN_STABILITY_FRAMES = 2;

// Cooldown compartilhado. Backend limita a ≥1s por device; ficamos em 1.2s pra
// ter margem contra drift de clock e evitar 429 ocasional.
static const unsigned long PUBLISH_COOLDOWN_MS = 1200;

// Índices das classes do modelo (ordem fixa pelo treino no Edge Impulse)
#define CLASS_IDX_CLARO   0
#define CLASS_IDX_NOISE   1
#define CLASS_IDX_UNKNOWN 2

// ============================================================================
// Estado global
// ============================================================================

I2SClass i2s;
static int16_t  audio_slice[SLICE_SIZE];
static int32_t  raw_i2s[SLICE_SIZE];
static signal_t audio_signal;
static unsigned long last_publish_ms = 0;
static int unknown_streak = 0;  // ADR-012 stability gate: unknown consecutive frames
static bool ntp_synced = false;

// ============================================================================
// Callback EI
// ============================================================================

static int audio_get_data(size_t offset, size_t length, float *out_ptr) {
  for (size_t i = 0; i < length; i++) {
    out_ptr[i] = (float)audio_slice[offset + i];
  }
  return 0;
}

// ============================================================================
// Wi-Fi + NTP
// ============================================================================

static void connectWiFi() {
  Serial.printf("[wifi] conectando em %s ", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < 30000) {
    delay(300);
    Serial.print(".");
    rgbLedWrite(LED_PIN, 0, 0, 32);  delay(100);
    rgbLedWrite(LED_PIN, 16, 16, 16); delay(100);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf(" OK | IP=%s | RSSI=%d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    rgbLedWrite(LED_PIN, 8, 8, 8);
  } else {
    Serial.println(" FALHOU (prosseguindo offline)");
    rgbLedWrite(LED_PIN, 64, 0, 0);
  }
}

static void syncNTP() {
  if (WiFi.status() != WL_CONNECTED) return;
  Serial.print("[ntp] sync ");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  struct tm timeinfo;
  unsigned long start = millis();
  while (!getLocalTime(&timeinfo, 500) && (millis() - start) < 15000) {
    Serial.print(".");
  }
  if (getLocalTime(&timeinfo)) {
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
    Serial.printf(" OK | %s\n", buf);
    ntp_synced = true;
  } else {
    Serial.println(" FALHOU");
    ntp_synced = false;
  }
}

// ============================================================================
// Envelope helpers
// ============================================================================

// ISO8601 com millissegundos e Z, ex: "2026-04-24T10:15:30.123Z"
// Regex do backend exige \d{3}Z$
static void buildIsoTime(char* buf, size_t buf_size) {
  struct tm timeinfo;
  if (ntp_synced && getLocalTime(&timeinfo)) {
    int written = strftime(buf, buf_size, "%Y-%m-%dT%H:%M:%S", &timeinfo);
    unsigned int ms = millis() % 1000;
    snprintf(buf + written, buf_size - written, ".%03uZ", ms);
  } else {
    // Fallback se NTP falhou. Backend aceita mas timestamp vira epoch falso.
    unsigned long s = millis() / 1000;
    unsigned int ms = millis() % 1000;
    snprintf(buf, buf_size, "2026-04-24T00:%02lu:%02lu.%03uZ",
             (s / 60) % 60, s % 60, ms);
  }
}

// Offset de Brasília (UTC-3, sem horário de verão desde 2019 — Lei 13.575/2017
// foi revogada em 2019 por decreto; BRT fixo).
static const int BRT_OFFSET_SEC = -3 * 3600;

// Timestamp prefixo pra logs recorrentes no Serial Monitor, em horário de
// Brasília. Usa relógio NTP (UTC) e subtrai 3h pra exibir local. Quando NTP
// ainda não sincronizou, cai pro uptime desde o boot (`+SSS.mmm`).
// Importante: o clock do sistema permanece UTC (configTime com offset 0), então
// o envelope CloudEvents `time` — montado em buildIsoTime — continua correto
// com o sufixo `Z` (Zulu/UTC). A conversão pra BRT é só pro display.
static void logTs() {
  if (ntp_synced) {
    time_t now = time(nullptr);
    if (now > 1700000000) {  // sanidade: após 2023 = NTP realmente subiu
      time_t brt = now + BRT_OFFSET_SEC;
      struct tm tm_brt;
      gmtime_r(&brt, &tm_brt);
      char buf[16];
      strftime(buf, sizeof(buf), "%H:%M:%S", &tm_brt);
      Serial.printf("[%s.%03u BRT] ", buf, (unsigned int)(millis() % 1000));
      return;
    }
  }
  unsigned long up_s  = millis() / 1000;
  unsigned long up_ms = millis() % 1000;
  Serial.printf("[+%lu.%03lu] ", up_s, up_ms);
}

// UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx (y ∈ 8,9,a,b)
static void buildUuidV4(char* buf, size_t buf_size) {
  uint32_t a = esp_random();
  uint32_t b = esp_random();
  uint32_t c = esp_random();
  uint32_t d = esp_random();
  snprintf(buf, buf_size,
           "%08x-%04x-4%03x-%1x%03x-%04x%08x",
           a,
           b & 0xFFFF,
           (b >> 16) & 0x0FFF,
           8 + (c & 0x3),           // 8/9/a/b
           (c >> 4) & 0x0FFF,
           (c >> 16) & 0xFFFF,
           d);
}

// ============================================================================
// secp256k1 signing (ADR-014 path B — Node 2 finally signs its own envelopes)
// ============================================================================

// uECC RNG glue. Hardware RNG is exposed via esp_random() on ESP32. ADR-003
// signing requires a CSRNG for k generation in ECDSA; esp_random() pulls from
// the on-die TRNG when WiFi/Bluetooth is up, which is true throughout the
// firmware lifecycle here.
static int uecc_rng(uint8_t *dest, unsigned size) {
  for (unsigned i = 0; i < size; i++) dest[i] = (uint8_t)esp_random();
  return 1;
}

// SHA-256 + secp256k1 sign of `data` (length `len`), result written as 128-char
// lowercase hex into `sig_hex_out` (must be at least 129 bytes). Returns true
// on success. Mirrors the canonical-JSON-then-hash-then-sign flow Node 1 uses,
// so backend `verifyEnvelopeSignature` accepts both nodes uniformly.
static bool signCanonical(const uint8_t* data, size_t len, char* sig_hex_out, size_t sig_hex_size) {
  if (sig_hex_size < 129) return false;

  uint8_t hash[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, /*is224=*/0);
  mbedtls_sha256_update(&ctx, data, len);
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);

  uint8_t sig[64];
  if (!uECC_sign(DEVICE_PRIVATE_KEY, hash, sizeof(hash), sig, uECC_secp256k1())) {
    return false;
  }

  // Hex-encode (lowercase) into sig_hex_out
  for (int i = 0; i < 64; i++) {
    snprintf(sig_hex_out + i * 2, 3, "%02x", sig[i]);
  }
  sig_hex_out[128] = '\0';
  return true;
}

// ============================================================================
// Publicação
// ============================================================================

// Publica um evento de classificação para a classe dada. `label` é embedado
// direto no JSON — chamadores devem passar strings curtas e seguras (tipo
// "claro", "unknown"), já que não escapamos o conteúdo.
static void publishClassification(const char* label, float prob,
                                   uint32_t dsp_ms, uint32_t nn_ms) {
  if (WiFi.status() != WL_CONNECTED) {
    logTs();
    Serial.println("[publish] skip: Wi-Fi down");
    return;
  }

  char id_buf[40];
  char time_buf[32];
  buildUuidV4(id_buf, sizeof(id_buf));
  buildIsoTime(time_buf, sizeof(time_buf));

  // ============================================================================
  // ADR-010 envelope build with canonical-first ordering for signing.
  //
  // Canonical JSON requires keys sorted alphabetically at every level. We emit
  // the keys in alphabetical order via snprintf so JSON output IS canonical
  // without a runtime sort step (and avoids pulling in ArduinoJson, which
  // would inflate flash by ~30 KB).
  //
  // Top-level alphabetical (without `signature`):
  //   data, datacontenttype, id, latitude, location, longitude, source,
  //   specversion, time, type
  // Inside data (classification): class, confidence, dsp_ms, model_id, nn_ms
  //
  // Two passes:
  //   1) `canonical` — envelope minus signature. SHA-256 input.
  //   2) `body` — canonical with `,"signature":"<hex>"}` substituted for the
  //      closing `}`. This is the actual POST body and is itself canonical
  //      (alphabetical because `signature` sorts after every other top-level
  //      field). The backend re-canonicalises before verifying anyway, so
  //      strict order in `body` is not required, but keeping it here makes
  //      debugging easier (canonical == body without the signature field).
  // ============================================================================
  char canonical[1024];
  int n = snprintf(canonical, sizeof(canonical),
    "{"
      "\"data\":{"
        "\"class\":\"%s\","
        "\"confidence\":%.3f,"
        "\"dsp_ms\":%u,"
        "\"model_id\":\"%s\","
        "\"nn_ms\":%u"
      "},"
      "\"datacontenttype\":\"application/json\","
      "\"id\":\"%s\","
      "\"latitude\":%.6f,"
      "\"location\":\"%s\","
      "\"longitude\":%.6f,"
      "\"source\":\"%s\","
      "\"specversion\":\"1.0\","
      "\"time\":\"%s\","
      "\"type\":\"io.sparkedsense.inference.classification\""
    "}",
    label, prob, dsp_ms, MODEL_ID, nn_ms,
    id_buf,
    DEVICE_LATITUDE,
    DEVICE_LOCATION,
    DEVICE_LONGITUDE,
    DEVICE_SOURCE,
    time_buf);

  if (n < 0 || n >= (int)sizeof(canonical)) {
    logTs();
    Serial.println("[publish] ERR: canonical envelope overflow");
    return;
  }

  // Sign canonical bytes
#if UNSIGNED_DEV_BYPASS
  const char* sig_hex = "unsigned_dev";
#else
  char sig_hex[129];
  if (!signCanonical((const uint8_t*)canonical, (size_t)n, sig_hex, sizeof(sig_hex))) {
    logTs();
    Serial.println("[publish] ERR: secp256k1 sign failed");
    return;
  }
#endif

  // Build final body: canonical + ,"signature":"<hex>" appended just before the
  // closing }. Reuse the canonical buffer if it has room, otherwise a new buf.
  char body[1280];
  if (n < 1) {
    return; // defensive: should be unreachable given the snprintf check above
  }
  // canonical[n-1] is the closing '}'. Replace with `,"signature":"...":"}`.
  int m = snprintf(body, sizeof(body),
                   "%.*s,\"signature\":\"%s\"}",
                   n - 1, canonical, sig_hex);
  if (m < 0 || m >= (int)sizeof(body)) {
    logTs();
    Serial.println("[publish] ERR: signed body overflow");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();  // cert validation desligada pra demo
  client.setTimeout(5);

  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(5000);
  if (!http.begin(client, INGEST_URL)) {
    logTs();
    Serial.println("[publish] ERR: http.begin falhou");
    return;
  }
  http.addHeader("Content-Type", "application/json");

  unsigned long t0 = millis();
  int code = http.POST(body);
  unsigned long elapsed = millis() - t0;

  if (code > 0) {
    logTs();
    Serial.printf("[publish] HTTP %d in %lu ms (class=%s prob=%.2f)\n",
                  code, elapsed, label, prob);
    if (code >= 400) {
      String resp = http.getString();
      logTs();
      Serial.printf("[publish] body: %s\n", resp.c_str());
    }
  } else {
    logTs();
    Serial.printf("[publish] net error: %s (%lu ms)\n",
                  http.errorToString(code).c_str(), elapsed);
  }
  http.end();
}

// ============================================================================
// Setup
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("=== Node 2 — KWS + Sparked Sense publisher ===");
  Serial.printf("PSRAM livre: %u bytes | Heap livre: %u bytes\n",
                ESP.getFreePsram(), ESP.getFreeHeap());

  pinMode(LED_PIN, OUTPUT);
  rgbLedWrite(LED_PIN, 0, 0, 16);  // azul fraco durante boot

  // ADR-014: register the hardware TRNG with uECC and announce the device's
  // current pubkey so the operator can paste it into the dashboard's
  // "Rotate Key" dialog if it doesn't yet match what's on the backend.
  uECC_set_rng(&uecc_rng);
  Serial.println();
  Serial.println("---- ADR-014 device identity ----");
  Serial.print("source: ");
  Serial.println(DEVICE_SOURCE);
  Serial.println(
    "If backend devices.public_key still points to the old placeholder, open"
  );
  Serial.println(
    "the sensor on the dashboard and run 'Rotate Key' with the hex above."
  );
  Serial.println("---------------------------------");

  connectWiFi();
  syncNTP();

  // I²S Standard mode, 16 kHz, 32-bit slot (mic manda 24-bit MSB-aligned), mono left
  i2s.setPins(I2S_SCK_PIN, I2S_WS_PIN, -1, I2S_SD_PIN, -1);
  if (!i2s.begin(I2S_MODE_STD, EI_CLASSIFIER_FREQUENCY, I2S_DATA_BIT_WIDTH_32BIT,
                 I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT)) {
    Serial.println("ERR: I2S begin falhou");
    while (true) {
      rgbLedWrite(LED_PIN, 64, 0, 0); delay(200);
      rgbLedWrite(LED_PIN, 0, 0, 0);  delay(200);
    }
  }

  audio_signal.total_length = SLICE_SIZE;
  audio_signal.get_data     = &audio_get_data;
  run_classifier_init();

  Serial.println("[setup] rodando. Fale 'claro' perto do mic.");
}

// ============================================================================
// Loop
// ============================================================================

void loop() {
  size_t bytes_read = i2s.readBytes((char*)raw_i2s, sizeof(raw_i2s));
  size_t n = bytes_read / sizeof(int32_t);
  if (n != SLICE_SIZE) return;

  for (size_t i = 0; i < n; i++) {
    audio_slice[i] = (int16_t)(raw_i2s[i] >> 16);
  }

  ei_impulse_result_t result = { 0 };
  if (run_classifier_continuous(&audio_signal, &result, false) != EI_IMPULSE_OK) return;

  float best_prob = 0;
  int   best_idx  = 0;
  for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
    if (result.classification[i].value > best_prob) {
      best_prob = result.classification[i].value;
      best_idx  = (int)i;
    }
  }

  logTs();
  Serial.printf("claro=%.2f  noise=%.2f  unknown=%.2f  -> %s (%.2f)\n",
                result.classification[0].value,
                result.classification[1].value,
                result.classification[2].value,
                result.classification[best_idx].label,
                best_prob);

  // Decisão de publicação (claro tem prioridade sobre o argmax).
  const float claro_prob   = result.classification[CLASS_IDX_CLARO].value;
  const float unknown_prob = result.classification[CLASS_IDX_UNKNOWN].value;

  // Atualiza o streak de unknown (gate de estabilidade). Qualquer frame que
  // não seja unknown forte quebra a sequência. Evita picos isolados tipo
  // "unknown=0.67" sandwichados entre noise disparando POST.
  const bool unknown_frame = (best_idx == CLASS_IDX_UNKNOWN && unknown_prob >= PUBLISH_THRESHOLD_UNKNOWN);
  if (unknown_frame) {
    unknown_streak++;
  } else {
    unknown_streak = 0;
  }

  int   publish_idx  = -1;
  float publish_prob = 0.0f;
  const char* skip_reason = nullptr;  // só pra log quando algo quase publicou mas foi barrado

  if (claro_prob >= PUBLISH_THRESHOLD_CLARO) {
    // Claro passou do threshold — publica claro, mesmo que unknown/noise sejam
    // argmax nesse frame. Prioriza a keyword alvo da demo.
    publish_idx  = CLASS_IDX_CLARO;
    publish_prob = claro_prob;
  } else if (unknown_frame && unknown_streak >= UNKNOWN_STABILITY_FRAMES) {
    // Unknown: argmax + alta confiança + 2 frames consecutivos pra publicar.
    publish_idx  = CLASS_IDX_UNKNOWN;
    publish_prob = unknown_prob;
    unknown_streak = 0;  // reseta após publicar pra não disparar em cadeia
  } else if (unknown_frame) {
    // Passou confiança mas não o streak — log pra visibilidade no Serial.
    skip_reason = "unknown abaixo de gate de estabilidade";
  }

  // LED reflete a decisão de publicação (não o argmax cru).
  if (publish_idx == CLASS_IDX_CLARO) {
    rgbLedWrite(LED_PIN, 0, 0, 80);        // azul forte = claro
  } else if (publish_idx == CLASS_IDX_UNKNOWN) {
    rgbLedWrite(LED_PIN, 24, 24, 0);       // amarelo fraco = unknown
  } else if (best_idx == CLASS_IDX_NOISE) {
    rgbLedWrite(LED_PIN, 0, 24, 0);        // verde fraco = noise ambiente
  } else {
    rgbLedWrite(LED_PIN, 8, 8, 8);         // cinza = incerteza / abaixo dos thresholds
  }

  if (publish_idx >= 0) {
    unsigned long now = millis();
    if (now - last_publish_ms > PUBLISH_COOLDOWN_MS) {
      publishClassification(result.classification[publish_idx].label,
                            publish_prob,
                            result.timing.dsp,
                            result.timing.classification);
      last_publish_ms = now;
    } else {
      logTs();
      Serial.printf("[skip] cooldown ativo (%lu ms restantes)\n",
                    PUBLISH_COOLDOWN_MS - (now - last_publish_ms));
    }
  } else if (skip_reason) {
    logTs();
    Serial.printf("[skip] %s (unknown=%.2f streak=%d)\n",
                  skip_reason, unknown_prob, unknown_streak);
  }
}
