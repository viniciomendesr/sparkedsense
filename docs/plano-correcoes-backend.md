# Plano de Correções Backend — Sparked Sense

**Contexto:** Este plano corrige os achados CRÍTICOS da auditoria de 2026-03-16. O objetivo é eliminar o dual write de readings no kv_store e migrar toda leitura de sensor data para `sensor_readings` (PostgreSQL), mantendo o kv_store apenas para metadata de sensores e datasets. O firmware ESP8266 NÃO será alterado — ele continua enviando dados normalmente para POST /sensor-data. Todas as mudanças são no backend (edge function) e no frontend (queries).

**Arquivos principais:**
- `supabase/functions/server/index.ts` — edge function (todas as rotas)
- `supabase/functions/server/kv_store.ts` — módulo KV store
- `src/api.ts` — API client do frontend
- `src/pages/sensor-detail.tsx` — página de detalhe do sensor
- `src/pages/dashboard.tsx` — dashboard principal

**Referência:** ler `docs/auditoria-2026-03-16.md` e `docs/adr/004-dual-layer-storage.md` antes de começar.

---

## Correção 1: Criar índice em sensor_readings

Criar uma migration SQL no Supabase que adicione:

```sql
CREATE INDEX IF NOT EXISTS idx_sensor_readings_nft_ts
ON sensor_readings (nft_address, timestamp DESC);
```

Isso permite que queries com `WHERE nft_address = X ORDER BY timestamp DESC LIMIT N` usem index scan em vez de sequential scan.

---

## Correção 2: Migrar GET /readings/:sensorId para ler de sensor_readings

No arquivo `supabase/functions/server/index.ts`, rota `app.get("/server/readings/:sensorId", ...)` (linhas ~505-525):

**Estado atual:** usa `kv.getByPrefix("reading:{sensorId}:")` que faz scan O(n) de TODAS as readings, ordena em memória, e aplica slice.

**O que fazer:**
1. Manter a autenticação (`getUserFromToken`)
2. Buscar o sensor metadata via `kv.get("sensor:{userId}:{sensorId}")` — isso é 1 row, rápido
3. A partir do sensor, obter o `claimToken`, e buscar o device em `devices` para pegar o `nftAddress`
4. Fazer query direta em `sensor_readings` com `.eq('nft_address', nftAddress).order('timestamp', { ascending: false }).limit(limit)` onde limit é `Math.min(parseInt(query.limit || '100'), 500)`
5. Mapear o resultado para o formato que o frontend espera: `{ id, sensorId, timestamp, variable, value, unit, verified, hash }`
6. O campo `variable` e `value` devem ser extraídos de `sensor_readings.data` (JSONB com `{temperature, humidity, timestamp}`). Usar `sensor.type` para decidir qual campo retornar como valor principal. Se o sensor é tipo "temperature", `value = data.temperature`, `unit = "°C"`. Se "humidity", `value = data.humidity`, `unit = "%"`.
7. O campo `hash` pode ser string vazia por enquanto (será recalculado quando necessário)

**Verificação:** a resposta JSON deve ter o mesmo schema que a versão anterior para não quebrar o frontend.

---

## Correção 3: Migrar GET /readings/:sensorId/historical (se existir)

Verificar se existe uma rota de historical readings. Se existir, aplicar a mesma migração da Correção 2: trocar kv.getByPrefix por query em sensor_readings com filtro temporal.

---

## Correção 4: Remover o KV write de readings em POST /sensor-data

No arquivo `supabase/functions/server/index.ts`, rota `app.post("/server/sensor-data", ...)`:

**Estado atual (linhas ~1491-1531):** após o write em `sensor_readings`, faz um bloco try/catch que:
- Busca todos os sensores com `kv.getByPrefix('sensor:')`
- Encontra o sensor linkado
- Cria um objeto `kvReading` com hash e metadata
- Faz `kv.set("reading:{sensorId}:{readingId}", kvReading)`
- Atualiza o status do sensor com `kv.set("sensor:{owner}:{sensorId}", linkedSensor)`

**O que fazer:**
1. REMOVER as linhas que fazem `kv.set("reading:...")` — não gravar mais readings no kv_store
2. MANTER o `kv.set("sensor:...")` que atualiza o status do sensor (lastReading, lastTimestamp, etc.) — essa metadata ainda é usada pelo frontend para mostrar status do sensor
3. OTIMIZAR: trocar o `kv.getByPrefix('sensor:')` (que busca TODOS os sensores) por um lookup direto. O device já é conhecido nesse ponto da rota (variável `device`). Buscar o sensor linkado usando `kv.get("sensor:{owner}:{sensorId}")` diretamente se possível, ou pelo menos filtrar por claimToken de forma mais eficiente
4. Manter o write em `sensor_readings` exatamente como está — esse é o write canônico

---

## Correção 5: Atualizar a rota hourly-merkle (se aplicável)

Verificar se existe uma rota de merkle tree que lê do kv_store. Se existir, migrar para ler de `sensor_readings` também, já que os readings não estarão mais no kv_store.

---

## Correção 6: Atualizar o frontend (se necessário)

Verificar `src/api.ts` (função `readingAPI.list()`) e `src/pages/sensor-detail.tsx`. O frontend provavelmente não precisa mudar se o schema da resposta JSON se mantiver igual (Correção 2 garante isso). Mas verificar:

1. Se o frontend usa algum campo específico do kv_store que não existe em sensor_readings (ex: `hash`, `signature`)
2. Se sim, adicionar esses campos como valores default na resposta mapeada
3. Garantir que o tipo TypeScript do Reading continua compatível

---

## Correção 7: Limpar readings antigos do kv_store

SOMENTE APÓS validar que as correções 1-6 estão funcionando:

Criar um script ou migration que execute:
```sql
DELETE FROM kv_store_4a89e1c9 WHERE key LIKE 'reading:%';
```

Depois rodar VACUUM para recuperar o espaço:
```sql
VACUUM ANALYZE kv_store_4a89e1c9;
```

Isso deve liberar ~39 MB de armazenamento.

---

## Correção 8: Criar ADR-005 documentando a decisão

Criar `docs/adr/005-remove-kv-readings-direct-postgres.md` documentando:
- Contexto: achados da auditoria (kv_store 72% do banco, O(n) scan, index bloat 5x)
- Decisão: readings saem do kv_store, lidos diretamente de sensor_readings
- kv_store mantido apenas para: sensor metadata, datasets
- Buffer local planejado para ESP32-S3 (futuro, fora deste escopo)
- Status: Accepted

---

## Ordem de execução

1 → 2 → 3 → 4 → 5 → 6 → testar tudo end-to-end → 7 → 8

## Status de execução (2026-03-17)

- [x] **Correção 1** — Índice `idx_sensor_readings_nft_ts` criado em produção e local
- [x] **Correção 2** — GET /readings/:sensorId migrado para sensor_readings via `getSensorReadings()`
- [x] **Correção 3** — GET /readings/:sensorId/historical migrado
- [x] **Correção 4** — KV write de readings removido do POST /sensor-data
- [x] **Correção 5** — Todas as rotas hourly-merkle migradas (15 callsites no total)
- [x] **Correção 6** — Frontend sem mudanças necessárias (schema da resposta mantido)
- [x] **Correção 7** — 9.482 readings removidos do kv_store (~39 MB liberados)
- [ ] **Correção 8** — ADR-004 atualizado com nota de superseding (ADR dedicado pendente)

## Critérios de validação

- [x] Frontend carrega readings sem erro
- [x] Response time do GET /readings < 200ms (antes: segundos com 8k+ rows)
- [x] POST /sensor-data continua funcionando (firmware não percebe mudança)
- [x] kv_store não recebe novos `reading:*` keys
- [x] Sensor status (lastReading, etc.) continua atualizando no kv_store
- [x] Nenhum erro 500 nos logs da edge function
- [x] Readings count mostra valor real (9.735, não travado em 1.000)
