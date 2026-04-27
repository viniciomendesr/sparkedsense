# Melhorias estruturais

Débito reconhecido que não justifica trabalho agora, mas vale registrar pra retomar quando os gatilhos baterem. Não é um ADR — é memória institucional sobre decisões deliberadas de adiar.

## KV store → tabelas tipadas

**Estado atual:** `sensor:<owner>:<id>` e `dataset:<sensorId>:<id>` vivem na tabela `kv_store_4a89e1c9` (Postgres `(key TEXT PK, value JSONB)`) acessada via prefix scan. Aproximadamente 14 sites em `supabase/functions/server/index.ts` fazem `kv.getByPrefix('sensor:')` em handlers públicos — cada chamada é um scan O(N) sobre todos os sensores de todos os owners porque a chave é composta com `owner` que o request anônimo não conhece.

**Por que adiar:** com até 10 sensores em produção previstos pra fim de 2026, o scan custa ~50-100ms num PG com cache quente. O ganho de migrar pra tabelas tipadas seria ~500ms → ~300ms de TTFB em handlers públicos — trabalho de uma tarde + risco de bug em ~14 call sites pra economizar 200ms num site sem SLA. Over-engineering pra escala atual.

**Quando reconsiderar (gatilhos):**
- N de sensores públicos passa de ~50.
- Aparece query estruturada por filtro (geo, status, type) que prefix scan não atende.
- Necessidade de RLS por linha (ex: visibility=`public` como filtro SQL, não checagem em runtime).
- Necessidade de foreign keys / integridade referencial entre `dataset` e `sensor` (hoje órfão é possível).

**O que migrar quando o gatilho bater:**
- Nova tabela `sensors`: `id PK, owner FK, name, type, mode, status, claim_token, device_public_key, nft_address, last_reading JSONB, location TEXT, latitude, longitude, location_accuracy, visibility, description, thumbnail_url, created_at, updated_at`. Index em `(visibility)`, `(owner)`, `(claim_token)`.
- Nova tabela `datasets`: `id PK, sensor_id FK, name, start_date, end_date, readings_count, status, merkle_root, anchor_tx_signature, anchor_explorer_url, anchor_cluster, anchor_memo, anchored_at, is_public, access_count, mint_status, signature_composition JSONB, created_at`. Index em `(sensor_id)`, `(is_public)`, `(status)`.
- Substituir `kv.getByPrefix('sensor:')` + `.find(s => s.id === id)` por `supabase.from('sensors').select('*').eq('id', id).maybeSingle()` nos 14 sites.
- Migration de dados: dois selects da tabela KV + INSERT na nova tabela. 2 sensores + ~2 datasets hoje = trivial.

**O que NÃO precisa migrar:**
- `lastReading` continua razoável como JSONB embedded (atualização única por ingest, leitura única no render do card; cache stale-vs-truth não é um problema em prática porque o ingest é o único escritor).
- Mock-mode infrastructure (`reading:<sensorId>:` prefix + `generateMockReading` + endpoint `/internal/generate-mock-data`) — vestigial mas inofensivo enquanto não houver sensor mock em produção (zero hoje). Se ficar inativo por meses, dá pra remover na mesma rodada.

## kv_store_4a89e1c9 — abstração leaky

A camada `kv` (em `supabase/functions/server/kv_store.ts`) sugere "key-value rápido", mas é só um wrapper de uma tabela Postgres com lookup `LIKE prefix%`. As funções `set/get/del/getByPrefix` mascaram isso e induzem padrões que seriam óbvios anti-patterns se a API fosse SQL nu (ex: scans completos em hot paths). Quando a migração de `sensor:` e `dataset:` pra tabelas próprias acontecer, o módulo `kv_store.ts` perde a maior parte do uso e pode virar `mock_readings_kv.ts` ou ser removido junto com o mock-mode.

## Cleanup paralelo (não bloqueador)

Pendências menores, sem impacto em escala:

- Mock-mode infrastructure inteira (`generateMockReading`, endpoint, branches em `getSensorReadings`/`countSensorReadings`, prefix `reading:` no KV) — remover quando confirmado que não há plano de demo/teste que dependa de mock sensors.
- `/server/sensors/retrieve-claim-token` — endpoint gera claim_token mas só retorna pro caller; antes ele persistia no KV, hoje não persiste mais (KV write removido em 2026-04-27). Pode ficar como utility pra futuras integrações ou ser removido se ninguém consumir.
