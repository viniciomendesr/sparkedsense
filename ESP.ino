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

// --- Network Configuration ---
const char* ssid = "BARROSO 420";
const char* password = "Barroso56@#";

// Supabase Configuration
const char* supabaseProjectId = "djzexivvddzzduetmkel";
const char* supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqemV4aXZ2ZGR6emR1ZXRta2VsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE3ODYzMzAsImV4cCI6MjA3NzM2MjMzMH0.hW1SyZKQRzI-ghokMb-F5uccV52vxixE0aH78lNZ1F4";

// API Endpoints
const char* registerDeviceEndpoint = "https://sparked-three.vercel.app/api/register-device";
const char* getClaimTokenEndpoint = "https://sparked-three.vercel.app/api/get-claim-token";
const char* readingsEndpoint = "https://djzexivvddzzduetmkel.supabase.co/functions/v1/server/readings";

// --- EEPROM Configuration ---
#define EEPROM_SIZE 128
#define STATE_KEY_GENERATED 0xAA

// --- Cryptography Globals ---
uint8_t privateKey[32];
uint8_t publicKey[64];
String nftAddressStored = "";
String claimTokenStored = "";
String currentChallenge = "";

// --- NTP (Time) Configuration ---
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

void saveDeviceData(String nftAddress, String claimToken) {
  // Save NFT address (bytes 33-96)
  for (int i = 0; i < 64; i++) {
    if (i < nftAddress.length()) EEPROM.write(33 + i, nftAddress[i]);
    else EEPROM.write(33 + i, 0);
  }
  // Save claim token (bytes 97-128)
  for (int i = 0; i < 32; i++) {
    if (i < claimToken.length()) EEPROM.write(97 + i, claimToken[i]);
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
  
  // Load NFT address
  for (int i = 0; i < 64; i++) {
    nftBuf[i] = EEPROM.read(33 + i);
    if (nftBuf[i] != 0 && nftBuf[i] != 0xFF) hasNFT = true;
  }
  nftBuf[64] = '\0';
  
  // Load claim token
  for (int i = 0; i < 32; i++) {
    tokenBuf[i] = EEPROM.read(97 + i);
    if (tokenBuf[i] != 0 && tokenBuf[i] != 0xFF) hasToken = true;
  }
  tokenBuf[32] = '\0';
  
  if (hasNFT) nftAddressStored = String(nftBuf);
  if (hasToken) claimTokenStored = String(tokenBuf);
  
  return hasNFT && hasToken;
}

// --- Device Registration Logic ---
// Step 1: Request challenge
// Step 2: Sign challenge and complete registration (creates NFT + claim token)
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
    
    // Sign the challenge
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
    
    // Send signed challenge
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
      Serial.println("Parse error: " + String(error.c_str()));
      Serial.println("Raw response: " + resp);
      return false;
    }
    
    // Debug: Print entire response
    Serial.println("📋 Registration Response:");
    serializeJsonPretty(respDoc, Serial);
    Serial.println();
    
    const char* nftAddress = respDoc["nftAddress"];
    const char* claimToken = respDoc["claimToken"];
    const char* txSignature = respDoc["txSignature"];
    
    // Debug: Check what we got
    Serial.println("🔍 Checking response fields:");
    Serial.printf("  nftAddress: %s\n", nftAddress ? nftAddress : "NULL");
    Serial.printf("  claimToken: %s\n", claimToken ? claimToken : "NULL");
    Serial.printf("  txSignature: %s\n", txSignature ? txSignature : "NULL");
    
    if (nftAddress && claimToken) {
      saveDeviceData(String(nftAddress), String(claimToken));
      Serial.println("======================================================");
      Serial.println("✅ DEVICE REGISTERED SUCCESSFULLY!");
      Serial.println("🎨 NFT Address: " + String(nftAddress));
      Serial.println("🔑 YOUR CLAIM TOKEN:");
      Serial.println(claimToken);
      if (txSignature) {
        Serial.println("📝 Transaction Signature: " + String(txSignature));
      }
      Serial.println("======================================================");
      Serial.println("Copy this token and use it on the website to claim your sensor.");
      Serial.println("MAC Address: " + WiFi.macAddress());
      Serial.println("Device Public Key: " + pubHex);
      return true;
    } else {
      Serial.println("❌ Registration failed, no NFT or claim token returned");
      Serial.println("Response may indicate an error or the device is already registered.");
      return false;
    }
  }
}

void setup() {
  Serial.begin(115200);
  uECC_set_rng(&rng_function);
  EEPROM.begin(EEPROM_SIZE);

  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nConnected!");

  // --- Initialize NTP Client to get current time ---
  Serial.println("Starting NTP client...");
  timeClient.begin();
  timeClient.update(); // Envia a primeira requisição

  Serial.print("Waiting for NTP time sync");
  while (timeClient.getEpochTime() < 1704067200) { 
    delay(1000);
    Serial.print(".");
    timeClient.update(); 
  }

  Serial.println("\nNTP time synced!");
  Serial.printf("Current Epoch Time: %lu\n", timeClient.getEpochTime());
 Serial.println("Current Formatted Time: " + timeClient.getFormattedTime());

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

  

  if (!loadDeviceData()) {
    Serial.println("No device registration found, registering device...");
    while (!registerDevice()) {
      Serial.println("❌ Registration failed, retrying in 10s...");
      Serial.println("💡 Type 'RESET' to clear device and start fresh");
      
      // Wait 10 seconds but check for RESET command every 500ms
      for (int i = 0; i < 20; i++) {
        checkForResetCommand();
        delay(500);
      }
    }
  } else {
    Serial.println("✅ Device data loaded from EEPROM:");
    Serial.println("   NFT Address: " + nftAddressStored);
    Serial.println("   Claim Token: " + claimTokenStored);
    Serial.println("Device is ready to send data.");
  }

  Serial.println("Setup complete. Ready to receive JSON via Serial.");
  Serial.println("💡 TIP: Send 'RESET' via Serial Monitor to clear device and re-register.");
}

// --- Reset Device Function ---
void resetDevice() {
  Serial.println("🔄 Resetting device...");
  Serial.println("⚠️  Clearing all EEPROM data (keys, NFT, claim token)...");
  
  // Clear entire EEPROM
  for (int i = 0; i < EEPROM_SIZE; i++) {
    EEPROM.write(i, 0xFF);
  }
  EEPROM.commit();
  
  // Clear runtime variables
  nftAddressStored = "";
  claimTokenStored = "";
  currentChallenge = "";
  memset(privateKey, 0, 32);
  memset(publicKey, 0, 64);
  
  Serial.println("✅ Device reset complete!");
  Serial.println("🔌 Restarting ESP in 3 seconds...");
  delay(3000);
  ESP.restart();
}

// --- Check for RESET command ---
bool checkForResetCommand() {
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    if (input == "RESET" || input == "reset") {
      resetDevice();
      return true; // Never reaches here due to restart
    }
  }
  return false;
}

void loop() {
  timeClient.update();
  
  // Check for RESET command first
  checkForResetCommand();

  if (Serial.available()) {
    String inputJson = Serial.readStringUntil('\n');
    inputJson.trim();
    if (inputJson.length() == 0) return;

    // Debug: Show what was received
    Serial.print("📥 Received: '");
    Serial.print(inputJson);
    Serial.print("' (length: ");
    Serial.print(inputJson.length());
    Serial.println(")");

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, inputJson);
    if (error) {
      Serial.println("Error: Invalid JSON received from Serial.");
      return;
    }

    doc["timestamp"] = timeClient.getEpochTime();
    
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

    // Prepare reading data for Supabase API
    JsonDocument readingDoc;
    
    // Extract sensor data from sorted doc
    if (sortedDoc["sensorId"]) {
      readingDoc["sensorId"] = sortedDoc["sensorId"];
    }
    if (sortedDoc["value"]) {
      readingDoc["value"] = sortedDoc["value"];
    }
    if (sortedDoc["unit"]) {
      readingDoc["unit"] = sortedDoc["unit"];
    }
    if (sortedDoc["variable"]) {
      readingDoc["variable"] = sortedDoc["variable"];
    }
    if (sortedDoc["timestamp"]) {
      readingDoc["timestamp"] = sortedDoc["timestamp"];
    }
    
    // Add hash of the canonical payload
    readingDoc["hash"] = bytesToHexString(hash, sizeof(hash));
    
    String finalJson;
    serializeJson(readingDoc, finalJson);
    
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.begin(client, readingsEndpoint);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + supabaseAnonKey);
    
    int code = http.POST(finalJson);
    String response = http.getString();
    http.end();

    Serial.printf("📡 Reading sent! HTTP code: %d\n", code);
    if (code == 200 || code == 201) {
      Serial.println("✅ Data successfully sent to Supabase");
    } else {
      Serial.printf("❌ Failed to send data\n");
      Serial.printf("⬅  Response: %s\n", response.c_str());
    }
  }}
