# Timeline de Evolução — Sparked Sense

## Fase 1 — Fundação e UI (30-31 Out 2025)
**Contribuidores**: Vinicio Mendes, Nícolas Gabriel, Figma Bot

- **30/10** — Commit inicial + importação dos ficheiros do Figma Make (93 ficheiros, ~19.500 linhas). Inclui toda a estrutura frontend React + Vite, componentes UI (Radix, Tailwind, Recharts), Supabase Edge Function com KV store, e templates de código para sensores.
- **30/10** — Transfer do backend (Nícolas Gabriel): integração Supabase, fixes de build e deploy com pnpm. Merge de 2 PRs da branch `nicolas`.
- **30/10** — Deploy da aplicação frontend no Vercel como projeto `sparkedsensemvpv1`, servindo em `sparkedsensemvp.vercel.app`. Build configurado como Vite SPA (`vite build`).
- **30/10** — Configuração do projeto Supabase (`djzexivvddzzduetmkel`): criação da tabela `kv_store` para o KV store da Edge Function, deploy da Edge Function `server` (Hono + Deno), configuração de autenticação com Supabase Auth.
- **30-31/10** — Ajustes de conteúdo, favicon, limpeza do README. Configuração das variáveis de ambiente no Vercel: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (prefixo VITE_ para acesso no frontend).

## Fase 2 — Refinamento e Documentação (Nov-Dez 2025)
**Contribuidores**: Vinicio Mendes, Pedro Goularte (psgoularte)

- **01-03/11** — Fixes de tipografia, capitalização nos headings da HomePage, atualização do README.
- **06/11** — Pedro Goularte adiciona a seção de missão do Sparked Sense ao README.
- **06/11** — Pedro Goularte cria o projeto `sparked-three` no Vercel como ambiente de teste para integração Solana (página com campos Token e Wallet Address). Este projeto utilizava a secret key `SERVER_SECRET_KEY_BASE58` para testes de mint de NFTs na devnet.
- **19/12** — Adição do link do pitch video ao README.

## Fase 3 — Refatoração da Arquitetura (09 Mar 2026)
**Contribuidor**: Vinicio Mendes (com assistência de IA — Claude)

- **09/03** — Grande refatoração: remoção de 2.186 linhas de código duplicado/não utilizado (`kv_store.tsx`, `deviceRegistry.ts`, `redis.ts`, `solanaService.ts`, `supabaseClient.ts` e migration SQL antiga). Estes ficheiros estavam em `src/supabase/` e eram redundantes com a estrutura em `supabase/`.
- **09/03** — Padronização das rotas da API na Edge Function: remoção do versionamento nos paths, URLs simplificadas de `/server/v1/*` para `/server/*`. Atualização do `api.ts` no frontend e da URL do KV store (`kv_store.ts`).
- **09/03** — Redeploy da Supabase Edge Function `server` com as rotas padronizadas.

## Fase 4 — Integração Hardware IoT + DePIN (09-10 Mar 2026)
**Contribuidor**: Vinicio Mendes (com assistência de IA — Claude)

### Diagnóstico de arquitetura (09/03)
- Descoberta de que as rotas Next.js em `app/api/` (register-device, sensor-data, claim-device, etc.) eram código morto — o projeto usa `vite build` no `package.json` e não tem `next` como dependência. Apesar de existir um `next.config.ts`, as rotas API nunca foram deployadas.
- Identificação de que `sparked-three.vercel.app` (Pedro Goularte) era apenas uma página de teste, não o backend da aplicação.
- Conclusão: não existia backend funcional para os dispositivos IoT comunicarem. A solução adotada foi adicionar as rotas à Supabase Edge Function já ativa.

### Alterações no Supabase — Base de Dados (10/03)
- Drop das tabelas antigas (`devices`, `sensor_readings`, `datasets`, `audit_logs`) que tinham schema incompatível (colunas em snake_case vs código em camelCase).
- Criação da tabela `devices` com colunas em camelCase (`publicKey` PK, `macAddress`, `nftAddress` UNIQUE, `txSignature`, `lastTsSeen`, `revoked`, `challenge`, `ownerAddress`, `claimToken` UNIQUE, `is_mock`, `mock_sensor_type`, `mock_private_key`).
- Criação da tabela `sensor_readings` (`id` UUID PK, `nft_address`, `timestamp`, `data` JSONB).
- Desabilitação de Row Level Security (RLS) em ambas as tabelas para permitir acesso direto pela Edge Function.
- Concessão de permissões (`GRANT ALL`) aos roles `anon`, `authenticated` e `service_role`.

### Alterações no Supabase — Edge Function (10/03)
- Adição do import `@noble/curves` via esm.sh para verificação de assinaturas secp256k1 (substituindo `npm:elliptic` que causava BOOT_ERROR no Deno).
- Nova rota `POST /server/register-device`: registo de dispositivos físicos em dois passos — (1) ESP envia `macAddress` + `publicKey`, recebe `challenge` aleatório armazenado na tabela `devices`; (2) ESP assina o challenge com secp256k1 (uECC), servidor verifica com `@noble/curves` e devolve `nftAddress` + `claimToken` + `txSignature` (atualmente simulados).
- Nova rota `POST /server/sensor-data`: receção de leituras do sensor físico com verificação criptográfica. Valida assinatura secp256k1 contra o canonical JSON do payload, aplica rate limit de 55s via campo `lastTsSeen`, grava na tabela `sensor_readings` (PostgreSQL) e simultaneamente no KV store (tabela `kv_store`) para exibição no dashboard.
- Fix de `{ lowS: false }` na verificação de assinatura para aceitar assinaturas high-S geradas pela biblioteca uECC do ESP8266 (que não normaliza segundo BIP-0062).
- Bridge KV ↔ PostgreSQL: a rota `sensor-data` procura no KV store o sensor vinculado pelo mesmo `claimToken` e grava a leitura no formato que o dashboard espera (com hash SHA-256, variable, unit, status update para "active").
- Três redeploys da Edge Function ao longo do dia (`supabase functions deploy server`).

### Alterações no Vercel (10/03)
- Adição de variáveis de ambiente no projeto `sparkedsensemvpv1`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SERVER_SECRET_KEY_BASE58` (embora estas variáveis server-side não sejam usadas pelo Vite SPA, foram adicionadas durante a investigação do problema das rotas API mortas).
- Redeploy do projeto após adição das variáveis.
- Identificação de que as variáveis com prefixo `VITE_` são as únicas acessíveis no frontend Vite.

### Firmware ESP8266 (10/03)
- Criação do firmware `ESP/ESP.ino` para sensor DHT11: geração e persistência de chaves secp256k1 em EEPROM, registo via challenge-response, assinatura criptográfica de cada leitura com canonical JSON (chaves ordenadas alfabeticamente), envio periódico a cada 60 segundos.
- Endpoints alterados de Vercel (código morto) para Supabase Edge Function (`djzexivvddzzduetmkel.supabase.co/functions/v1/server/...`).
- Adicionado header `Authorization: Bearer <anon_key>` em todos os pedidos HTTP para satisfazer a verificação JWT da Supabase.
- Pino de dados alterado de D4 (GPIO2, conflito com boot do ESP8266) para D2 (GPIO4).
- Redes WiFi testadas: `firetheboxv2` (fábrica), hotspot iPhone, `MVISIA_2.4GHz` (Inova USP). Rede `eduroam` incompatível (WPA2-Enterprise não suportada pelo ESP8266).

### Teste end-to-end bem-sucedido (10/03)
- Sensor DHT11 físico → ESP8266 → WiFi → HTTPS → Supabase Edge Function → verificação de assinatura secp256k1 → armazenamento em PostgreSQL + KV store → dashboard com Live Chart e Recent Readings em tempo real. Status do sensor mudou de "Inactive" para "Active".

## Fase 5 — Reset e Nova Identidade Blockchain (10 Mar 2026)
**Contribuidor**: Vinicio Mendes (com assistência de IA — Claude)

### Transição de ownership (10/03)
- Remoção da secret key antiga da Solana devnet (pertencente a Pedro Goularte, que saiu do projeto). Criação de nova carteira Solana devnet via Phantom Wallet, agora sob controle exclusivo de Vinicio Mendes.
- Nova public key Solana (devnet): `6RuAxerE8GsMziM4c77ZzakfMAiebSfTE3LX4S1EyMNn` (base58).
- Airdrop de 10 SOL na devnet para futuros testes de mint de NFTs.

### Reset completo da base de dados (10/03)
- Limpeza total das 4 tabelas do Supabase via SQL Editor: `DELETE FROM sensor_readings`, `DELETE FROM devices`, `DELETE FROM kv_store_4a89e1c9`, `DELETE FROM users`.
- Remoção dos utilizadores no Supabase Auth (painel Authentication → Users).
- Objetivo: eliminar dados de teste antigos, sensores mock acumulados, e referências à chave Solana anterior.

### Re-registo do dispositivo físico (10/03)
- Reset da EEPROM do ESP8266 via comando `RESET` no Serial Monitor (limpa chaves e nftAddress antigos).
- Novo registo challenge-response bem-sucedido com identidade renovada:
  - NFT Address: `b1f7dbebfd314fdb03f624486e9da1ff68071a65ae22a604b341f32bf0dc580d`
  - Claim Token: `ed52b6ee5d816593d65cd0c51927ddee`
  - Transaction: `devnet_sim_b1f7dbebfd314fdb03f624486e9da1ff`
- Primeira leitura pós-reset: 24.7°C / 83% humidade — HTTP 200, dados enviados com sucesso.
- Rede WiFi mantida: `MVISIA_2.4GHz` (Inova USP).

### Reatividade do frontend (10/03)
- Diagnóstico: o frontend não atualizava leituras de sensores reais automaticamente — o polling de live data só funcionava para sensores mock (gerava dados fake locais a cada 2s), e sensores `mode === 'real'` eram excluídos explicitamente do polling.
- `sensor-detail.tsx`: adicionado `useEffect` com polling da API (`readingAPI.list`) a cada 15 segundos para sensores reais, com chamada imediata no mount. Também atualiza o Merkle root periodicamente.
- `dashboard.tsx`: sparkline dos sensor cards agora diferencia mock (dados gerados localmente) vs real (polling da API a cada 15s). Adicionado polling global de sensores + stats a cada 30s como fallback para o Supabase Realtime.
- `api.ts`: adicionado header `Cache-Control: no-cache, no-store` em todas as chamadas para evitar dados stale por cache do browser ou CDN.

## Fase 6 — Fix CORS e Estabilidade da Edge Function (10 Mar 2026)
**Contribuidor**: Vinicio Mendes (com assistência de IA — Claude)

### Diagnóstico (10/03)
- Homepage exibia erro "Unable to Load Featured Sensors — Edge Function not deployed" na seção Featured Public Sensors.
- Investigação revelou que a Edge Function estava deployada e ativa (v8). Curl direto à API retornava HTTP 200 com dados corretos (1 sensor, 49 readings).
- Causa raiz: o header `Cache-Control: no-cache, no-store` adicionado na Fase 5 (`api.ts`) não estava listado no `Access-Control-Allow-Headers` da configuração CORS da Edge Function. O browser bloqueava o request no preflight OPTIONS, gerando `TypeError: Failed to fetch` que o frontend interpretava como "Edge Function not deployed".

### Decisão de design
- Manter o `Cache-Control` no frontend (importante para evitar dados stale) e adicionar o header à whitelist CORS no servidor, em vez de remover do client. Desta forma, futuros headers custom também podem ser adicionados sem quebrar CORS.

### Correção (10/03)
- `supabase/functions/server/index.ts`: adicionado `Cache-Control` em 4 pontos de configuração CORS — middleware Hono `cors()`, handler explícito OPTIONS, e handler `Deno.serve` (preflight + response headers).
- Redeploy da Edge Function `server` (v9).

## Estado Atual e Próximos Passos

**Implementado**: Fluxo DePIN completo com autenticação criptográfica (secp256k1), identidade digital simulada (nftAddress), dashboard com dados em tempo real e polling automático para sensores reais, verificação de integridade via hashes e Merkle root, duas camadas de armazenamento (PostgreSQL para persistência, KV store para dashboard). Nova carteira Solana devnet sob controle do projeto (Phantom Wallet). Homepage com Featured Public Sensors funcional e CORS estável.

**Pendente**: Mint real de NFTs na Solana devnet para identidade on-chain dos dispositivos (código base existe em `solanaService.ts`, necessita adaptação para Deno), fix do cálculo do Merkle root, setup de estação permanente de sensoriamento (ESP8266 + DHT11 em Dell antigo ou alimentação USB contínua), e documentação para open source.
