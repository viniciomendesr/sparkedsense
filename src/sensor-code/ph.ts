export const phCode = `#include <ESP8266WiFi.h>
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

// --- Sensor Configuration ---
#define PH_PIN A0    // PH sensor must be connected to the analog pin A0

// --- Network Configuration ---
const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";
const char* registerApiEndpoint = "https://sparkedsensemvp.vercel.app/api/register-device";
const char* dataApiEndpoint = "https://sparkedsensemvp.vercel.app/api/sensor-data";

// --- EEPROM Configuration ---
#define EEPROM_SIZE 128
#define STATE_KEY_GENERATED 0xAA

// --- Cryptography Globals ---
uint8_t privateKey[32];
uint8_t publicKey[64];
String nftAddressStored = "";
String currentChallenge = "";

// --- NTP (Time) Configuration ---
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org");

// --- Send Timer Configuration ---
unsigned long lastSendTime = 0;
const long sendInterval = 90000; // 90 seconds (1.5 minutes)

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

// --- EEPROM Functions for Key and NFT ---
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

void saveNFT(String nft) {
  for (int i = 0; i < 64; i++) {
    if (i < nft.length()) EEPROM.write(33 + i, nft[i]);
    else EEPROM.write(33 + i, 0);
  }
  EEPROM.commit();
  nftAddressStored = nft;
}

String loadNFT() {
  char buf[65];
  bool hasData = false;
  for (int i = 0; i < 64; i++) {
    buf[i] = EEPROM.read(33 + i);
    if (buf[i] != 0 && buf[i] != 0xFF) hasData = true;
  }
  buf[64] = '\\0';
  if (!hasData) return "";
  nftAddressStored = String(buf);
  return nftAddressStored;
}

// --- Device Registration Logic ---
bool registerDevice() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  uECC_compute_public_key(privateKey, publicKey, uECC_secp256k1());
  uint8_t formattedPublicKey[65];
  formattedPublicKey[0] = 0x04;
  memcpy(&formattedPublicKey[1], publicKey, 64);
  String pubHex = bytesToHexString(formattedPublicKey, sizeof(formattedPublicKey));
  {
    Serial.println("📡 Requesting challenge from server...");
    DynamicJsonDocument doc(256);
    doc["macAddress"] = WiFi.macAddress();
    doc["publicKey"] = pubHex;
    String payload;
    serializeJson(doc, payload);
    http.begin(client, registerApiEndpoint);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(payload);
    String resp = http.getString();
    http.end();
    if (code != 200) {
      Serial.printf("❌ Failed to get challenge: %d\\n⬅ Response: %s\\n", code, resp.c_str());
      return false;
    }
    DynamicJsonDocument respDoc(256);
    deserializeJson(respDoc, resp);
    currentChallenge = String(respDoc["challenge"] | "");
    if (currentChallenge == "") {
      Serial.println("❌ Challenge missing in response");
      return false;
    }
  }
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
  {
    DynamicJsonDocument doc(512);
    doc["macAddress"] = WiFi.macAddress();
    doc["publicKey"] = pubHex;
    doc["challenge"] = currentChallenge;
    JsonObject sig = doc.createNestedObject("signature");
    sig["r"] = bytesToHexString(signature, 32);
    sig["s"] = bytesToHexString(signature + 32, 32);
    String payload;
    serializeJson(doc, payload);
    http.begin(client, registerApiEndpoint);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(payload);
    String resp = http.getString();
    http.end();
    if (code != 200) {
      Serial.printf("❌ Registration failed: %d\\n%s\\n", code, resp.c_str());
      return false;
    }

    DynamicJsonDocument respDoc(512);
    deserializeJson(respDoc, resp);
    if (respDoc["nftAddress"]) {
      String nft = String(respDoc["nftAddress"]);
      saveNFT(nft);
      Serial.println("✅ Device registered! NFT Address: " + nft);

      // Get the claimToken from the response
      const char* claimToken = respDoc["claimToken"];
      if (claimToken) {
        Serial.println("======================================================");
        Serial.println("🔑 YOUR TOKEN TO CLAIM THE NFT:");
        Serial.println(claimToken);
        Serial.println("======================================================");
        Serial.println("Copy this token and use it on the website to claim your NFT.");
      }
      return true;
    } else {
      Serial.println("❌ Registration failed, no NFT returned");
      return false;
    }
  }
}

/**
 * @brief New function to create, sign, and send sensor data.
 * @param sensorKey The JSON key name (e.g., "pH")
 * @param sensorValue The value read from the sensor
 */
void sendSensorData(String sensorKey, float sensorValue) {
  
  Serial.printf("Sending data: %s = %.2f\\n", sensorKey.c_str(), sensorValue);

  // 1. Create the original JSON
  JsonDocument doc;
  doc[sensorKey] = sensorValue;
  doc["timestamp"] = timeClient.getEpochTime();

  // 2. Create the canonical JSON (sorted by key)
  JsonObject originalJson = doc.as<JsonObject>();
  JsonDocument sortedDoc;
  JsonObject sortedJson = sortedDoc.to<JsonObject>();

  std::vector<const char*> keys;
  for (JsonPair kv : originalJson) {
    keys.push_back(kv.key().c_str());
  }
  std::sort(keys.begin(), keys.end(), [](const char* a, const char* b) {
    return strcmp(a, b) < 0;
  });
  for (const char* key : keys) {
    sortedJson[key] = originalJson[key];
  }

  String canonicalPayloadString;
  serializeJson(sortedDoc, canonicalPayloadString);

  // 3. Hash and Sign the canonical payload
  uint8_t hash[32];
  br_sha256_context ctx;
  br_sha256_init(&ctx);
  br_sha256_update(&ctx, canonicalPayloadString.c_str(), canonicalPayloadString.length());
  br_sha256_out(&ctx, hash);

  uint8_t signature[64];
  if (!uECC_sign(privateKey, hash, sizeof(hash), signature, uECC_secp256k1())) {
    Serial.println("❌ Failed to sign payload.");
    return;
  }

  // 4. Create the final JSON for the API
  JsonDocument apiDoc;
  apiDoc["nftAddress"] = nftAddressStored;
  apiDoc["payload"] = sortedDoc;
  JsonObject sigObj = apiDoc.createNestedObject("signature");
  sigObj["r"] = bytesToHexString(signature, 32);
  sigObj["s"] = bytesToHexString(signature + 32, 32);

  String finalJson;
  serializeJson(apiDoc, finalJson);

  // 5. Send the data to the API
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, dataApiEndpoint);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(finalJson);
  String response = http.getString();
  http.end();

  Serial.printf("📡 Payload sent! HTTP code: %d\\n", code);
  if (code != 200) {
    Serial.printf("⬅  Response: %s\\n", response.c_str());
  } else {
    Serial.printf("✅ Data sent successfully: %s\\n", canonicalPayloadString.c_str());
  }
}

// --- SETUP (With sensor initialization) ---
void setup() {
  Serial.begin(115200);
  uECC_set_rng(&rng_function);
  EEPROM.begin(EEPROM_SIZE);

  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\\nConnected!");

  // --- Initialize NTP Client ---
  Serial.println("Starting NTP client...");
  timeClient.begin();
  timeClient.update(); 
  Serial.print("Waiting for NTP time sync");
  while (timeClient.getEpochTime() < 1704067200) {
    delay(1000);
    Serial.print(".");
    timeClient.update();
  }
  Serial.println("\\nNTP time synced!");
  Serial.printf("Current Epoch Time: %lu\\n", timeClient.getEpochTime());

  // --- Initialize the sensor ---
  // pinMode(PH_PIN, INPUT); // A0 is input by default, but this is good practice
  Serial.println("PH sensor (A0) initialized.");

  // --- Key Generation/Load Logic (no changes) ---
  if (!loadPrivateKey()) {
    Serial.println("Generating new key...");
    if (uECC_make_key(publicKey, privateKey, uECC_secp256k1())) {
      savePrivateKey();
      Serial.println("Key generated and saved");
    } else {
      Serial.println("Key generation failed");
      delay(60000); ESP.restart();
    }
  } else {
    Serial.println("Key loaded from EEPROM");
  }
  uint8_t formattedPublicKey[65];
  formattedPublicKey[0] = 0x04;
  memcpy(&formattedPublicKey[1], publicKey, 64);
  String pubHex = bytesToHexString(formattedPublicKey, sizeof(formattedPublicKey));
  Serial.println("Device Public Key:");
  Serial.println(pubHex);

  // --- Device Registration Logic (no changes) ---
  if (loadNFT() == "") {
    Serial.println("No NFT found, registering device...");
    while (!registerDevice()) {
      Serial.println("❌ Registration failed, retrying in 10s...");
      delay(10000);
    }
  } else {
    Serial.println("Loaded NFT from EEPROM: " + nftAddressStored);
  }

  Serial.println("Setup complete. Starting sensor loop...");
  lastSendTime = -sendInterval; // Force an immediate send on the first loop
}

// --- LOOP (Modified to send sensor data) ---
void loop() {
  // Update the NTP client
  timeClient.update();

  unsigned long now = millis();
  
  // Check if the 90-second interval has passed
  if (now - lastSendTime >= sendInterval) {
    lastSendTime = now; // Reset the timer

    // 1. Read sensor data
    int rawValue = analogRead(PH_PIN);

    // 2. Convert to pH (SIMPLE ESTIMATE - REQUIRES CALIBRATION!)
    // This is a simple linear conversion (0-1023 -> 0-14).
    // Your actual PH-4502C sensor WILL require calibration!
    // Adjust this formula based on your tests with buffer solutions.
    float phValue = (float)rawValue * (14.0 / 1023.0);

    // 3. Send the data
    sendSensorData("pH", phValue);
  }
  
  // Small delay to avoid overloading the loop, but optional
  delay(100); 
}`;
