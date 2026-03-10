#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <EEPROM.h>
#include <uECC.h>
#include <bearssl/bearssl_hash.h> // SHA-256
#include <NTPClient.h>
#include <WiFiUdp.h>
#include <vector>
#include <algorithm>
#include <DHT.h>  // Instalar: "DHT sensor library" by Adafruit

// =====================================================
// --- DHT11 Configuration ---
// =====================================================
#define DHT_PIN     D2       // Pino de dados do DHT11 (GPIO4). D4 pode conflitar com boot.
#define DHT_TYPE    DHT11
DHT dht(DHT_PIN, DHT_TYPE);

// Intervalo de envio (60s = limite mínimo do rate limit do servidor)
#define SEND_INTERVAL_MS 60000UL
unsigned long lastSendTime = 0;

// =====================================================
// --- Network Configuration ---
// =====================================================
const char* ssid = "firetheboxv2";
const char* password = "queimeacaixav2";

// Supabase project anon key (used as Bearer token - allows unauthenticated device access)
const char* supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqemV4aXZ2ZGR6emR1ZXRta2VsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE3ODYzMzAsImV4cCI6MjA3NzM2MjMzMH0.hW1SyZKQRzI-ghokMb-F5uccV52vxixE0aH78lNZ1F4";

// API Endpoints (Supabase Edge Function - already deployed and running)
const char* registerDeviceEndpoint = "https://djzexivvddzzduetmkel.supabase.co/functions/v1/server/register-device";
const char* sensorDataEndpoint     = "https://djzexivvddzzduetmkel.supabase.co/functions/v1/server/sensor-data";

// =====================================================
// --- EEPROM Configuration ---
// =====================================================
#define EEPROM_SIZE 128
#define STATE_KEY_GENERATED 0xAA

// =====================================================
// --- Cryptography Globals ---
// =====================================================
uint8_t privateKey[32];
uint8_t publicKey[64];
String nftAddressStored = "";
String claimTokenStored = "";
String currentChallenge = "";

// =====================================================
// --- NTP (Time) Configuration ---
// =====================================================
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org");

// --- RNG for Cryptography ---
int rng_function(uint8_t *dest, unsigned size) {
  for (unsigned i = 0; i < size; ++i) dest[i] = os_random();
  return 1;
}

// --- Utility: Bytes to Hex String ---
String bytesToHexString(const uint8_t* bytes, int len) {
  String str = "";
  for (int i = 0; i < len; i++) {
    char buf[3];
    sprintf(buf, "%02x", bytes[i]);
    str += buf;
  }
  return str;
}

// =====================================================
// --- EEPROM Functions ---
// =====================================================
void savePrivateKey() {
  EEPROM.write(0, STATE_KEY_GENERATED);
  for (int i = 0; i < 32; i++) EEPROM.write(i + 1, privateKey[i]);
  EEPROM.commit();
}

bool loadPrivateKey() {
  if (EEPROM.read(0) != STATE_KEY_GENERATED) return false;
  for (int i = 0; i < 32; i++) privateKey[i] = EEPROM.read(i + 1);
  uECC_compute_public_key(privateKey, publicKey, uECC_secp256k1());
  return true;
}

void saveDeviceData(String nftAddress, String claimToken) {
  for (int i = 0; i < 64; i++) {
    if (i < (int)nftAddress.length()) EEPROM.write(33 + i, nftAddress[i]);
    else EEPROM.write(33 + i, 0);
  }
  for (int i = 0; i < 32; i++) {
    if (i < (int)claimToken.length()) EEPROM.write(97 + i, claimToken[i]);
    else EEPROM.write(97 + i, 0);
  }
  EEPROM.commit();
  nftAddressStored = nftAddress;
  claimTokenStored = claimToken;
}

bool loadDeviceData() {
  char nftBuf[65];
  char tokenBuf[33];
  bool hasNFT = false;
  bool hasToken = false;

  for (int i = 0; i < 64; i++) {
    nftBuf[i] = EEPROM.read(33 + i);
    if (nftBuf[i] != 0 && nftBuf[i] != (char)0xFF) hasNFT = true;
  }
  nftBuf[64] = '\0';

  for (int i = 0; i < 32; i++) {
    tokenBuf[i] = EEPROM.read(97 + i);
    if (tokenBuf[i] != 0 && tokenBuf[i] != (char)0xFF) hasToken = true;
  }
  tokenBuf[32] = '\0';

  if (hasNFT) nftAddressStored = String(nftBuf);
  if (hasToken) claimTokenStored = String(tokenBuf);

  return hasNFT && hasToken;
}

// =====================================================
// --- Device Registration (unchanged) ---
// =====================================================
bool registerDevice() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  uECC_compute_public_key(privateKey, publicKey, uECC_secp256k1());
  uint8_t formattedPublicKey[65];
  formattedPublicKey[0] = 0x04;
  memcpy(&formattedPublicKey[1], publicKey, 64);
  String pubHex = bytesToHexString(formattedPublicKey, sizeof(formattedPublicKey));

  // STEP 1: Request challenge
  {
    Serial.println("📡 Step 1: Requesting challenge from server...");
    DynamicJsonDocument doc(256);
    doc["macAddress"] = WiFi.macAddress();
    doc["publicKey"] = pubHex;
    String payload;
    serializeJson(doc, payload);

    http.begin(client, registerDeviceEndpoint);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + supabaseAnonKey);
    int code = http.POST(payload);
    String resp = http.getString();
    http.end();

    if (code != 200) {
      Serial.printf("❌ Failed to get challenge: %d\n⬅ Response: %s\n", code, resp.c_str());
      return false;
    }

    DynamicJsonDocument respDoc(256);
    deserializeJson(respDoc, resp);
    currentChallenge = String(respDoc["challenge"] | "");
    if (currentChallenge == "") {
      Serial.println("❌ Challenge missing in response");
      return false;
    }
    Serial.println("✅ Challenge received");
  }

  // STEP 2: Sign challenge and register
  {
    Serial.println("📡 Step 2: Signing challenge and registering device...");

    uint8_t hash[32];
    br_sha256_context ctx;
    br_sha256_init(&ctx);
    br_sha256_update(&ctx, currentChallenge.c_str(), currentChallenge.length());
    br_sha256_out(&ctx, hash);

    uint8_t signature[64];
    if (!uECC_sign(privateKey, hash, sizeof(hash), signature, uECC_secp256k1())) {
      Serial.println("❌ Failed to sign challenge");
      return false;
    }

    DynamicJsonDocument doc(512);
    doc["macAddress"] = WiFi.macAddress();
    doc["publicKey"] = pubHex;
    doc["challenge"] = currentChallenge;
    JsonObject sig = doc.createNestedObject("signature");
    sig["r"] = bytesToHexString(signature, 32);
    sig["s"] = bytesToHexString(signature + 32, 32);

    String payload;
    serializeJson(doc, payload);

    http.begin(client, registerDeviceEndpoint);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + supabaseAnonKey);
    int code = http.POST(payload);
    String resp = http.getString();
    http.end();

    if (code != 200) {
      Serial.printf("❌ Registration failed: %d\n%s\n", code, resp.c_str());
      return false;
    }

    DynamicJsonDocument respDoc(512);
    DeserializationError error = deserializeJson(respDoc, resp);

    if (error) {
      Serial.println("❌ Failed to parse registration response JSON");
      Serial.println("Raw response: " + resp);
      return false;
    }

    Serial.println("📋 Registration Response:");
    serializeJsonPretty(respDoc, Serial);
    Serial.println();

    const char* nftAddress = respDoc["nftAddress"];
    const char* claimToken = respDoc["claimToken"];
    const char* txSignature = respDoc["txSignature"];

    if (nftAddress && claimToken) {
      saveDeviceData(String(nftAddress), String(claimToken));
      Serial.println("======================================================");
      Serial.println("✅ DEVICE REGISTERED SUCCESSFULLY!");
      Serial.println("🎨 NFT Address: " + String(nftAddress));
      Serial.println("🔑 YOUR CLAIM TOKEN:");
      Serial.println(claimToken);
      if (txSignature) Serial.println("📝 Transaction: " + String(txSignature));
      Serial.println("======================================================");
      return true;
    } else {
      Serial.println("❌ Registration failed, no NFT or claim token returned");
      return false;
    }
  }
}

// =====================================================
// --- Reset Device ---
// =====================================================
void resetDevice() {
  Serial.println("🔄 Resetting device...");
  for (int i = 0; i < EEPROM_SIZE; i++) EEPROM.write(i, 0xFF);
  EEPROM.commit();
  nftAddressStored = "";
  claimTokenStored = "";
  currentChallenge = "";
  memset(privateKey, 0, 32);
  memset(publicKey, 0, 64);
  Serial.println("✅ Device reset! Restarting in 3s...");
  delay(3000);
  ESP.restart();
}

bool checkForResetCommand() {
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    if (input == "RESET" || input == "reset") {
      resetDevice();
      return true;
    }
  }
  return false;
}

// =====================================================
// --- Setup ---
// =====================================================
void setup() {
  Serial.begin(115200);
  uECC_set_rng(&rng_function);
  EEPROM.begin(EEPROM_SIZE);

  // Inicializa o DHT11
  dht.begin();
  Serial.println("🌡️  DHT11 initialized.");

  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nConnected! IP: " + WiFi.localIP().toString());

  // NTP sync
  Serial.println("Starting NTP client...");
  timeClient.begin();
  timeClient.update();
  Serial.print("Waiting for NTP sync");
  while (timeClient.getEpochTime() < 1704067200UL) {
    delay(1000);
    Serial.print(".");
    timeClient.update();
  }
  Serial.println("\nNTP synced! Time: " + timeClient.getFormattedTime());

  // Keys
  if (!loadPrivateKey()) {
    Serial.println("Generating new key...");
    if (uECC_make_key(publicKey, privateKey, uECC_secp256k1())) {
      savePrivateKey();
      Serial.println("Key generated and saved.");
    } else {
      Serial.println("Key generation failed!");
      delay(60000); ESP.restart();
    }
  } else {
    Serial.println("Key loaded from EEPROM.");
  }

  uint8_t formattedPublicKey[65];
  formattedPublicKey[0] = 0x04;
  memcpy(&formattedPublicKey[1], publicKey, 64);
  Serial.println("Device Public Key: " + bytesToHexString(formattedPublicKey, sizeof(formattedPublicKey)));

  // Registration
  if (!loadDeviceData()) {
    Serial.println("No device registration found. Registering...");
    while (!registerDevice()) {
      Serial.println("❌ Retrying in 10s... (send 'RESET' to clear)");
      for (int i = 0; i < 20; i++) { checkForResetCommand(); delay(500); }
    }
  } else {
    Serial.println("✅ Device loaded from EEPROM:");
    Serial.println("   NFT: " + nftAddressStored);
    Serial.println("   Token: " + claimTokenStored);
  }

  Serial.println("\n🚀 Ready! Sending DHT11 data every 60s.");
  Serial.println("💡 Send 'RESET' via Serial Monitor to clear device.");
}

// =====================================================
// --- Loop: lê DHT11 e envia a cada 60s ---
// =====================================================
void loop() {
  timeClient.update();
  checkForResetCommand();

  // Verifica intervalo de envio
  unsigned long now = millis();
  if (lastSendTime != 0 && (now - lastSendTime) < SEND_INTERVAL_MS) {
    delay(100);
    return;
  }

  // --- Leitura do DHT11 ---
  float humidity    = dht.readHumidity();
  float temperature = dht.readTemperature(); // Celsius

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("❌ DHT11 read failed! Check wiring (DATA → D4, VCC → 3.3V, GND → GND).");
    delay(2000);
    return;
  }

  // Arredonda para 1 casa decimal (DHT11 tem resolução de 1°C / 1%)
  float temp_r = round(temperature * 10.0) / 10.0;
  float humi_r = round(humidity * 10.0) / 10.0;
  unsigned long ts = timeClient.getEpochTime();

  Serial.printf("\n🌡️  Temp: %.1f°C | 💧 Humidity: %.0f%% | ⏱ TS: %lu\n", temp_r, humi_r, ts);

  // --- Monta payload (chaves em ordem alfabética para canonical JSON) ---
  // Ordem: humidity < temperature < timestamp
  JsonDocument payloadDoc;
  payloadDoc["humidity"]    = humi_r;
  payloadDoc["temperature"] = temp_r;
  payloadDoc["timestamp"]   = ts;

  // Ordena chaves e serializa canonicamente (igual ao json-stable-stringify do servidor)
  JsonObject payloadObj = payloadDoc.as<JsonObject>();
  std::vector<const char*> keys;
  for (JsonPair kv : payloadObj) keys.push_back(kv.key().c_str());
  std::sort(keys.begin(), keys.end(), [](const char* a, const char* b) {
    return strcmp(a, b) < 0;
  });

  JsonDocument sortedPayload;
  JsonObject sortedObj = sortedPayload.to<JsonObject>();
  for (const char* key : keys) sortedObj[key] = payloadObj[key];

  String canonicalPayloadString;
  serializeJson(sortedPayload, canonicalPayloadString);
  Serial.println("📄 Canonical: " + canonicalPayloadString);

  // --- SHA256 + Sign ---
  uint8_t hash[32];
  br_sha256_context ctx;
  br_sha256_init(&ctx);
  br_sha256_update(&ctx, canonicalPayloadString.c_str(), canonicalPayloadString.length());
  br_sha256_out(&ctx, hash);

  uint8_t sig[64];
  if (!uECC_sign(privateKey, hash, sizeof(hash), sig, uECC_secp256k1())) {
    Serial.println("❌ Failed to sign payload.");
    return;
  }

  // --- Monta request body para /api/sensor-data ---
  // Formato esperado: { nftAddress, signature: {r, s}, payload: {...} }
  JsonDocument requestDoc;
  requestDoc["nftAddress"] = nftAddressStored;

  JsonObject sigObj = requestDoc.createNestedObject("signature");
  sigObj["r"] = bytesToHexString(sig, 32);
  sigObj["s"] = bytesToHexString(sig + 32, 32);

  JsonObject payloadField = requestDoc.createNestedObject("payload");
  for (const char* key : keys) {
    payloadField[key] = sortedObj[key];
  }

  String finalJson;
  serializeJson(requestDoc, finalJson);

  // --- Envia para o servidor ---
  WiFiClientSecure wifiClient;
  wifiClient.setInsecure();
  HTTPClient http;
  http.begin(wifiClient, sensorDataEndpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + supabaseAnonKey);

  int code = http.POST(finalJson);
  String response = http.getString();
  http.end();

  Serial.printf("📡 HTTP %d\n", code);
  if (code == 200 || code == 201) {
    Serial.println("✅ Data sent successfully!");
  } else {
    Serial.printf("❌ Failed: %s\n", response.c_str());
  }

  lastSendTime = millis();
}
