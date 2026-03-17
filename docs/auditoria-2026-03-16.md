# Auditoria Completa da Infraestrutura — Sparked Sense

**Data:** 2026-03-16
**Sensor:** DHT11 (ESP8266) em operacao continua desde 10/03/2026
**Projeto Supabase:** `djzexivvddzzduetmkel` (Sparked Sense MVP v2)

---

## Resumo Executivo

### 5 Achados Mais Importantes

| # | Achado | Severidade |
|---|--------|------------|
| 1 | **kv_store consome 39 MB (72% do banco) vs 2.1 MB do sensor_readings** — indice bloat 5x com 28 MB de desperdicio. A 90 dias de operacao, so o kv_store estoura o free tier de 500 MB | CRITICO |
| 2 | **`getByPrefix()` faz scan O(n) sem LIMIT** — cada chamada de leitura puxa TODOS os readings do KV, ordena em memoria e depois fatia. Com 8.351+ rows, sao 72.223 seq scans acumulados | CRITICO |
| 3 | **Firmware sem watchdog, sem reconexao Wi-Fi, sem timeout HTTPS** — se o Wi-Fi cair ou o Supabase travar, o ESP fica bloqueado ate reinicio manual | CRITICO |
| 4 | **Dual write desnecessario** — cada leitura eh gravada em `sensor_readings` E `kv_store`, duplicando armazenamento sem beneficio real (kv_store nao eh in-memory) | WARNING |
| 5 | **Taxa de perda de ~5.8%** — 519 leituras perdidas em 6 dias, provavelmente por gaps de Wi-Fi sem reconexao automatica | WARNING |

### 3 Acoes de Maior Impacto

1. **Migrar frontend para ler direto de `sensor_readings`** e eliminar dual write no kv_store — libera 39 MB imediatamente e remove a causa raiz do travamento
2. **Adicionar watchdog + reconexao Wi-Fi + timeout HTTPS ao firmware** — garante operacao 30+ dias sem intervencao
3. **Adicionar indice `(nft_address, timestamp)` em `sensor_readings`** e implementar paginacao/janela temporal na API de leituras

---

## PARTE 1 — Diagnostico dos Dados Reais

### 1.1 Integridade do Dataset

**Total de leituras reais:**
- `sensor_readings`: **8.355 rows**
- `kv_store` (reading: prefix): **8.351 rows**
- Divergencia: **4 readings** existem apenas no `sensor_readings` (provavelmente leituras antes do sensor ser linkado ao claimToken, ou falhas pontuais do KV write)

**Janela temporal:**
- Primeira leitura: `2026-03-10T15:10:18-03:00`
- Ultima leitura: `2026-03-16T19:04:25-03:00`
- Duracao total: **~6 dias, 3 horas, 54 minutos** (~8.874 minutos)

**Taxa de perda:**
- Leituras esperadas (1/min): ~8.874
- Leituras reais: 8.355
- **Taxa de perda: ~5.8%** (519 leituras perdidas)
- **Diagnostico: WARNING** — aceitavel para DHT11 mas indica gaps de conectividade

> Nota: Nao foi possivel executar a query de gaps via MCP (`execute_sql` retorna erro `crypto is not defined`). A taxa de perda de 5.8% sugere ~8-10 gaps significativos, consistente com instabilidade de Wi-Fi residencial.

### 1.2 Consumo de Armazenamento

```
Tabela                   | Dados     | Indices  | Total    | Rows  | Seq Scans
-------------------------|-----------|----------|----------|-------|----------
public.kv_store_4a89e1c9 | 4.024 kB  | 35 MB    | 39 MB    | 8.351 | 72.223
public.sensor_readings   | 1.832 kB  | 320 kB   | 2.152 kB | 8.354 | 74
public.devices           | 16 kB     | 48 kB    | 64 kB    | 1     | 16.931
public.users             | 8 kB      | 40 kB    | 48 kB    | 0     | 9
```

**Banco total: 54 MB** (de 500 MB do free tier = **10.8%** utilizado)

**Bytes por row:**
- `sensor_readings`: ~258 bytes/row (eficiente)
- `kv_store`: ~4.802 bytes/row (18.6x mais — causado por JSONB value + index bloat)

**Index Bloat (critico):**
```
Index                                      | Size  | Bloat | Desperdicio
kv_store_4a89e1c9_pkey                     | 18 MB | 5.0x  | 14 MB
idx_kv_store_4a89e1c9_key_prefix           | 18 MB | 5.0x  | 14 MB
```
Total desperdicado em indices: **28 MB** (51.8% do banco inteiro)

**Projecao de armazenamento (1.440 readings/dia):**

| Periodo | sensor_readings | kv_store (se mantido) | Total  | % do Free Tier |
|---------|-----------------|----------------------|--------|----------------|
| Atual   | 2.1 MB          | 39 MB                | 41 MB  | 10.8%          |
| 30 dias | ~11 MB          | ~203 MB              | ~214 MB| 42.8%          |
| 90 dias | ~33 MB          | ~609 MB              | **>500 MB** | **ESTOURA** |
| 365 dias| ~133 MB         | N/A (ja estourou)    | N/A    | N/A            |

> **Diagnostico: CRITICO** — o kv_store sozinho estoura o free tier em ~75 dias. Sem o kv_store, `sensor_readings` cabe confortavelmente por 1+ ano.

**Overhead do dual write:** O kv_store consome **95% do armazenamento** para dados que sao duplicata do sensor_readings. Remove-lo libera ~39 MB imediatamente.

### 1.3 Qualidade dos Dados do Sensor

**Amostra das ultimas leituras:**
```json
{"humidity": 60, "timestamp": 1773698665, "temperature": 27.5}
{"humidity": 60, "timestamp": 1773698602, "temperature": 27.8}
{"humidity": 60, "timestamp": 1773698536, "temperature": 27.4}
{"humidity": 60, "timestamp": 1773698473, "temperature": 27.0}
{"humidity": 60, "timestamp": 1773698408, "temperature": 27.0}
```

**Campos gravados em `sensor_readings.data` (JSONB):**
- `humidity` (float)
- `temperature` (float)
- `timestamp` (epoch unix, int)

> Nota: Nao inclui metadados como signature hash, device ID ou RSSI. O hash eh calculado separadamente no kv_store.

**Anomalias de temperatura:** Nenhuma leitura abaixo de 10C detectada via REST API filter.

**Observacoes sobre o DHT11:**
- Umidade frequentemente "trava" em valores redondos (ex: 60%) — comportamento normal do DHT11 (resolucao de 1%)
- Temperatura varia entre ~27.0-27.8C no horario testado — range plausivel para ambiente interno no Brasil em marco
- **Diagnostico: SAUDAVEL** — dados dentro do range esperado, sem anomalias

---

## PARTE 2 — Revisao do Codigo

### 2.1 Firmware (ESP8266) — `ESP/ESP.ino`

#### Watchdog
- **NAO tem** `ESP.wdtEnable()` ou `ESP.wdtFeed()`
- O software watchdog do ESP8266 esta habilitado por padrao (~3.2s), mas o firmware usa `delay()` que alimenta o watchdog implicitamente
- **Risco:** Se o HTTPS request travar (ex: Supabase fora do ar), o `http.POST()` pode bloquear por tempo indefinido. O watchdog padrao so funciona se o loop travar completamente, nao em blocking I/O
- **Diagnostico: CRITICO**

#### Reconexao Wi-Fi
```cpp
// ESP/ESP.ino:289-291
WiFi.begin(ssid, password);
Serial.print("Connecting WiFi");
while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
```
- **NAO tem reconexao automatica no loop.** Se o Wi-Fi cair apos o setup, `WiFi.status()` retorna `WL_DISCONNECTED` mas o firmware nunca chama `WiFi.begin()` novamente
- O `http.POST()` simplesmente falha com erro e o firmware tenta novamente no proximo ciclo — mas sem reconexao, falha infinitamente
- **Diagnostico: CRITICO** — explica parte dos 5.8% de perda

#### Timeout HTTPS
- **NAO tem timeout configurado** no `WiFiClientSecure` ou `HTTPClient`
- `HTTPClient` usa timeout padrao de 5000ms no ESP8266, o que eh razoavel, mas nao esta explicito
- `wifiClient.setInsecure()` desabilita verificacao TLS (aceitavel para IoT/dev, mas risco em producao)
- **Diagnostico: WARNING**

#### Falha DHT11
```cpp
// ESP/ESP.ino:360-364
if (isnan(humidity) || isnan(temperature)) {
    Serial.println("❌ DHT11 read failed! ...");
    delay(2000);
    return;  // Pula o ciclo
}
```
- **CORRETO**: se a leitura falha, pula o ciclo e tenta novamente apos 2s + intervalo restante
- Nao envia dados invalidos ao servidor
- **Diagnostico: SAUDAVEL**

#### EEPROM
- Chave privada eh lida em `setup()` via `loadPrivateKey()` (linha 307)
- `savePrivateKey()` so eh chamada uma vez, na geracao inicial (linha 310)
- `saveDeviceData()` so eh chamada no registro (linha 232)
- **Nenhuma escrita no loop** — EEPROM protegida
- **Diagnostico: SAUDAVEL**

#### Logging
- Loga temperatura, umidade e timestamp a cada ciclo
- Loga HTTP status code e resposta em caso de erro
- **NAO loga**: RSSI Wi-Fi, contadores de erro consecutivos, uptime, motivo de falhas DHT
- **Diagnostico: WARNING** — informacao de diagnostico limitada

### 2.2 Backend (Edge Function) — `supabase/functions/server/index.ts`

#### Rate Limit na rota `POST /server/sensor-data`
```typescript
// index.ts:1441-1445
const nowSec = Math.floor(Date.now() / 1000);
if (device.lastTsSeen && (nowSec - Number(device.lastTsSeen)) < 55) {
    return c.json({ error: 'Rate limited - wait before sending another reading' }, 429);
}
```
- Retorna **HTTP 429** com body `{"error": "Rate limited - wait..."}`
- **O firmware NAO trata o 429 explicitamente** — apenas loga `"❌ Failed: ..."` e continua. O rate limit eh respeitado pelo intervalo de 60s do firmware (> 55s do servidor)
- **Diagnostico: SAUDAVEL** (mas fragil — se o clock do ESP desincronizar, pode gerar 429s silenciosos)

#### Dual Write
```typescript
// index.ts:1479-1490 — Write 1: sensor_readings (PostgreSQL)
const { error: insertError } = await supabase
    .from('sensor_readings')
    .insert({ nft_address: nftAddress, timestamp: readingTimestamp, data: payload });

// index.ts:1499-1543 — Write 2: kv_store (best-effort)
try {
    const allSensors = await kv.getByPrefix('sensor:');  // SCAN ALL SENSORS
    const linkedSensor = allSensors.find(...);
    // ... hash, create reading object ...
    await kv.set(`reading:${linkedSensor.id}:${readingId}`, kvReading);
    // ... update sensor status ...
    await kv.set(`sensor:${linkedSensor.owner}:${linkedSensor.id}`, linkedSensor);
} catch (kvErr: any) {
    console.error('KV write error (non-fatal):', kvErr.message);
}
```

**Problemas identificados:**
1. **Sequencial, nao paralelo** — o write no kv_store so executa apos o sensor_readings completar
2. **`kv.getByPrefix('sensor:')` busca TODOS os sensores** a cada leitura, so para encontrar o sensor linkado — O(n) desnecessario
3. Se o KV write falhar, sensor_readings fica inconsistente com kv_store (design by intent — "best effort")
4. O try/catch separado garante que falha do KV nao impede o write principal
- **Diagnostico: WARNING** — funcional mas ineficiente

#### Campos gravados

**`sensor_readings` (PostgreSQL):**
| Campo | Tipo | Conteudo |
|-------|------|----------|
| id | uuid | auto-generated |
| nft_address | text | endereco NFT do device |
| timestamp | timestamptz | ISO 8601 (convertido do epoch) |
| data | jsonb | `{humidity, temperature, timestamp}` |

**`kv_store` (reading entry):**
| Campo | Tipo | Conteudo |
|-------|------|----------|
| id | uuid | random UUID |
| sensorId | text | ID do sensor no kv_store |
| timestamp | string | ISO 8601 |
| variable | string | ex: "temperature" |
| value | number | valor principal (temp OU humidity, nao ambos) |
| unit | string | ex: "°C" |
| verified | boolean | sempre `true` |
| hash | string | SHA-256 do reading data |
| signature | string | trecho truncado da assinatura |

> **IMPORTANTE:** O kv_store grava apenas UM valor (temperature OU humidity), enquanto sensor_readings grava ambos no JSONB. Alem disso, o kv_store adiciona hash e metadata, aumentando o tamanho por row.

#### Consistencia kv_store vs sensor_readings
- `sensor_readings`: 8.355 rows
- `kv_store` readings: 8.351 rows
- **Diferenca: 4 rows** — provavelmente leituras antes do sensor ser linkado ao claimToken, ou falhas pontuais do KV write (best-effort)
- **Diagnostico: SAUDAVEL** (diferenca minima e esperada)

### 2.3 Frontend

#### Query de leituras (`readingAPI.list()`)

```typescript
// api.ts:180
list: async (sensorId: string, accessToken: string, limit = 100) => {
    const response = await fetch(`${API_BASE}/readings/${sensorId}?limit=${limit}`, ...);
```

Backend que atende:
```typescript
// index.ts:505-525
app.get("/server/readings/:sensorId", async (c) => {
    const limit = parseInt(c.req.query('limit') || '100');
    const readings = await kv.getByPrefix(`reading:${sensorId}:`);  // BUSCA TODOS
    const sortedReadings = (readings || [])
        .sort(...)
        .slice(0, limit);  // LIMITA SO DEPOIS
});
```

**Problema critico:** O frontend pede `limit=100`, mas o backend faz `getByPrefix()` que **busca TODAS as 8.351+ readings do kv_store**, ordena em memoria, e so entao fatia. Isso significa:
- Cada request lê 8.351 rows do PostgreSQL (via `LIKE 'reading:sensorId:%'`)
- Transfere ~4.8 KB/row * 8.351 rows = **~40 MB de dados por request** do kv_store para a edge function
- Ordena tudo em memoria na edge function
- Retorna apenas 100 entries ao frontend

**Diagnostico: CRITICO** — complexidade O(n) no banco e na memoria para retornar O(1) dados. Este eh o motivo do travamento em ~1.000 readings.

#### Polling
- **sensor-detail.tsx**: polling a cada **15 segundos** para sensores reais (linha 175)
- **dashboard.tsx**: polling a cada **30 segundos** como fallback (linha 131); sensores reais polled a cada **15 segundos** (linha 200)
- Cada poll dispara o `getByPrefix()` completo descrito acima
- **Diagnostico: CRITICO** — ~40 MB processados a cada 15s no backend

#### Recharts
```typescript
// sensor-detail.tsx:326-329
const chartData = readings.map(r => ({
    time: r.timestamp.toLocaleTimeString(),
    value: r.value,
}));
```

- O grafico renderiza **todos os readings** do state (ate 100 por causa do limit da API)
- **Sem downsampling** — mas como o limit eh 100, o Recharts consegue renderizar sem problemas
- A tabela `lastHourReadings` filtra para ultima hora e mostra `.slice(-10)` — correto
- **Diagnostico: SAUDAVEL** (o limit de 100 protege o Recharts, mas o backend sofre)

#### Biblioteca de Sensores (Listagem)

Metadados exibidos atualmente no card do sensor:
- Nome
- Descricao
- Status (active/inactive)
- Tipo (temperature/humidity/etc.)
- Badge visual do tipo
- Ultima leitura (valor + unidade + timestamp)
- Mini grafico de sparkline com ultimos 30 valores

Metadados **NAO exibidos** mas uteis:
- Modo (real vs mock) — nao tem indicador visual
- Dias ativos desde registro
- Total de leituras
- Uptime / health score
- Frequencia de leitura
- Localizacao

**Diagnostico: WARNING** — informacao minima para um MVP, mas insuficiente para biblioteca publica

---

## PARTE 3 — Melhorias Propostas

### 3.1 Dados que o Sensor Detail deveria mostrar

| Campo | Viabilidade | Fonte de dados |
|-------|-------------|----------------|
| Uptime (% sem gaps >2min) | Alta | Calcular server-side a partir de `sensor_readings.timestamp` |
| Total de leituras | Alta | `COUNT(*)` em `sensor_readings` filtrado por `nft_address` |
| Taxa de entrega | Alta | leituras reais / leituras esperadas (baseado no intervalo e registro) |
| Min/Max/Media | Alta | `MIN/MAX/AVG` em `sensor_readings.data` |
| Ultimo gap | Alta | Query de gaps no `sensor_readings` |
| Armazenamento consumido | Media | `pg_total_relation_size` filtrado ou estimativa por row count |
| Status da verificacao criptografica | Ja existe | Merkle root e hash verification ja implementados |
| Latencia media | Baixa | Requer comparar `payload.timestamp` (device) vs `sensor_readings.timestamp` (server) |

### 3.2 Dados que a biblioteca de sensores deveria mostrar

| Campo | Prioridade |
|-------|------------|
| Tipo de sensor (real vs mock) com indicador visual | Alta |
| Frequencia de leitura (a cada Xs) | Media |
| Dias ativos desde o registro | Alta |
| Health score (verde/amarelo/vermelho) | Alta |
| Ultima leitura (valor + timestamp relativo) | Ja existe |
| Localizacao | Baixa (requer schema change) |
| Contagem total de leituras | Alta |

### 3.3 Correcoes Prioritarias

#### Correcao #1: Frontend travando em 1.000+ readings (CRITICO)

**Causa raiz:** `kv.getByPrefix()` faz `SELECT * FROM kv_store WHERE key LIKE 'reading:X:%'` sem LIMIT — scan O(n).

**Correcao minima** (sem eliminar kv_store ainda): Adicionar paginacao no backend.

**Codigo atual** (`index.ts:505-525`):
```typescript
app.get("/server/readings/:sensorId", async (c) => {
    const limit = parseInt(c.req.query('limit') || '100');
    const readings = await kv.getByPrefix(`reading:${sensorId}:`);
    const sortedReadings = (readings || [])
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
    return c.json({ readings: sortedReadings });
});
```

**Correcao recomendada** (migrar para sensor_readings diretamente):
```typescript
app.get("/server/readings/:sensorId", async (c) => {
    const user = await getUserFromToken(c.req.raw);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const sensorId = c.req.param('sensorId');
    const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);

    // Buscar o nft_address do sensor via kv_store (1 row, rapido)
    const sensor = await kv.get(`sensor:${user.id}:${sensorId}`);
    if (!sensor) return c.json({ error: 'Sensor not found' }, 404);

    // Buscar o device linkado para obter nft_address
    const { data: device } = await supabase
        .from('devices')
        .select('nftAddress')
        .eq('claimToken', sensor.claimToken)
        .single();

    if (!device) return c.json({ readings: [] });

    // Query direta com ORDER BY + LIMIT no PostgreSQL
    const { data: rows, error } = await supabase
        .from('sensor_readings')
        .select('id, timestamp, data')
        .eq('nft_address', device.nftAddress)
        .order('timestamp', { ascending: false })
        .limit(limit);

    if (error) return c.json({ error: error.message }, 500);

    // Mapear para formato esperado pelo frontend
    const readings = (rows || []).map(r => ({
        id: r.id,
        sensorId,
        timestamp: r.timestamp,
        variable: sensor.type === 'humidity' ? 'humidity' : 'temperature',
        value: r.data?.[sensor.type] ?? r.data?.temperature ?? 0,
        unit: sensor.type === 'humidity' ? '%' : '°C',
        verified: true,
        hash: '', // recalcular se necessario
    }));

    return c.json({ readings });
});
```

**Impacto:** De O(n) scan em 8.351+ rows para O(1) index lookup + limit. Response time cai de segundos para <50ms.

**Indice necessario em `sensor_readings`:**
```sql
CREATE INDEX idx_sensor_readings_nft_ts
ON sensor_readings (nft_address, timestamp DESC);
```

#### Correcao #2: Eliminar Dual Write (WARNING → economia de 95% do storage)

**Avaliacao:**
- O kv_store eh usado por: readings API, sensor metadata, datasets, public API
- Remover o kv_store **readings** eh o de maior impacto (8.351 de 8.352 rows)
- O sensor metadata (1 row) e datasets podem permanecer no kv_store por enquanto

**Plano de migracao:**
1. Criar indice `(nft_address, timestamp DESC)` em `sensor_readings`
2. Alterar rotas de leitura (`GET /readings/:sensorId`, `GET /readings/:sensorId/historical`) para ler de `sensor_readings`
3. Alterar rota hourly-merkle para calcular a partir de `sensor_readings`
4. Remover o KV write de readings em `POST /sensor-data` (manter o update do sensor status)
5. Limpar readings antigos do kv_store: `DELETE FROM kv_store_4a89e1c9 WHERE key LIKE 'reading:%'`

**Impacto no Nicolas:** Nenhum — o frontend ja usa a API intermediaria (`readingAPI.list()`). Mudar a fonte de dados no backend eh transparente.

#### Correcao #3: Firmware sem resiliencia (CRITICO)

**Mudancas minimas para operacao 30+ dias:**

```cpp
// Adicionar no inicio do loop(), antes de qualquer operacao:
void loop() {
    timeClient.update();
    checkForResetCommand();

    // === RECONEXAO WI-FI ===
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("⚠️ WiFi disconnected. Reconnecting...");
        WiFi.disconnect();
        WiFi.begin(ssid, password);
        unsigned long startAttempt = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
            delay(500);
            Serial.print(".");
        }
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("\n❌ WiFi reconnect failed. Retrying next cycle.");
            delay(5000);
            return;
        }
        Serial.println("\n✅ WiFi reconnected: " + WiFi.localIP().toString());
        // Re-sync NTP apos reconexao
        timeClient.update();
    }

    // ... resto do loop ...
```

```cpp
// Adicionar timeout explicito antes do HTTP POST:
    WiFiClientSecure wifiClient;
    wifiClient.setInsecure();
    wifiClient.setTimeout(10000);  // 10s timeout TLS handshake

    HTTPClient http;
    http.setTimeout(15000);  // 15s timeout total
    http.begin(wifiClient, sensorDataEndpoint);
```

```cpp
// Adicionar watchdog explicito no setup():
void setup() {
    Serial.begin(115200);
    ESP.wdtEnable(8000);  // Watchdog de 8 segundos
    // ... resto do setup ...
}

// E alimentar no loop:
void loop() {
    ESP.wdtFeed();
    // ... resto do loop ...
}
```

```cpp
// Adicionar logging de diagnostico:
    // No final do loop, apos envio:
    Serial.printf("📶 RSSI: %d dBm | Uptime: %lus | Free heap: %d bytes\n",
        WiFi.RSSI(), millis() / 1000, ESP.getFreeHeap());
```

---

## Dados Brutos da Auditoria

### Tamanhos das Tabelas (via `supabase inspect db table-stats`)

```
Tabela                    | Dados    | Indices | Total  | Rows  | Seq Scans
--------------------------|----------|---------|--------|-------|-----------
public.kv_store_4a89e1c9  | 4024 kB  | 35 MB   | 39 MB  | 8.351 | 72.223
public.sensor_readings    | 1832 kB  | 320 kB  | 2.1 MB | 8.354 | 74
public.devices            | 16 kB    | 48 kB   | 64 kB  | 1     | 16.931
public.users              | 8 kB     | 40 kB   | 48 kB  | 0     | 9
```

### Index Bloat (via `supabase inspect db bloat`)

```
Tipo  | Nome                                                        | Bloat | Desperdicio
------|-------------------------------------------------------------|-------|------------
index | public.kv_store_4a89e1c9::idx_kv_store_4a89e1c9_key_prefix | 5.0   | 14 MB
index | public.kv_store_4a89e1c9::kv_store_4a89e1c9_pkey           | 5.0   | 14 MB
table | public.sensor_readings                                     | 1.1   | 88 kB
table | public.kv_store_4a89e1c9                                   | 1.0   | 88 kB
```

### Index Usage (via `supabase inspect db index-stats`)

```
Index                                     | Size  | Usage | Index Scans | Unused
------------------------------------------|-------|-------|-------------|-------
kv_store_4a89e1c9_pkey                    | 18 MB | 100%  | 39.733      | false
idx_kv_store_4a89e1c9_key_prefix          | 18 MB | 100%  | 46.411      | false
sensor_readings_pkey                      | 320kB | 100%  | 18          | false
devices_nftAddress_key                    | 16 kB | 100%  | 105         | false
devices_claimToken_key                    | 16 kB | 0%    | 0           | TRUE
```

> Nota: `devices_claimToken_key` nunca eh usado (0 index scans). O lookup de device por claimToken no `POST /sensor-data` usa `getByPrefix('sensor:')` no kv_store ao inves de consultar a tabela devices diretamente.

### Cache Hit (via `supabase inspect db db-stats`)

```
Database Size | Index Hit Rate | Table Hit Rate | WAL Size
54 MB         | 0.99           | 1.00           | 144 MB
```

> Hit rates excelentes (99-100%), indicando que os dados cabem no buffer cache do PostgreSQL.

### Amostra de Dados do Sensor

```json
{"humidity": 60, "timestamp": 1773698665, "temperature": 27.5}
{"humidity": 60, "timestamp": 1773698602, "temperature": 27.8}
{"humidity": 60, "timestamp": 1773698536, "temperature": 27.4}
{"humidity": 60, "timestamp": 1773698473, "temperature": 27.0}
{"humidity": 60, "timestamp": 1773698408, "temperature": 27.0}
```
