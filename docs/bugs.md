# Bugs

Registro vivo de bugs conhecidos e workarounds ativos. Diferente de [`melhorias-estruturais.md`](melhorias-estruturais.md) (débito deliberadamente adiado) e de [`timeline.md`](timeline.md) (changelog cronológico), este doc rastreia **defeitos comportamentais** — algo que está fazendo a coisa errada agora, mesmo que não bloqueie a operação.

Cada entrada segue o formato:

- **Status:** `aberto` | `mitigado` (workaround ativo) | `resolvido`
- **Sintoma:** o que o usuário/operador observa
- **Causa raiz:** o porquê técnico
- **Workaround atual:** como está mascarado hoje (se aplicável)
- **Fix definitivo:** o caminho pra fechar de verdade

---

## Canonical JSON float-format mismatch entre ESP32-S3 e server

- **Status:** mitigado (bypass `unsigned_dev` ativo no firmware do Nó 2)
- **Detectado:** 2026-04-30
- **Componentes:** `ESP/esp32s3/esp32s3.ino`, `supabase/functions/server/lib/ingest.ts`

**Sintoma.** Após registrar a pubkey do Nó 2 corretamente em `devices.public_key`, todo POST do ESP32-S3 pra `/server/reading` retornava `401 { "error":"Invalid signature","code":"bad_signature" }`. O ESP8266 (Nó 1) publicando contra o mesmo endpoint funciona normalmente.

**Causa raiz.** O ESP32-S3 monta o canonical JSON pra assinar via `snprintf` com formatos de ponto flutuante fixos:

- `"confidence":%.3f` → quando `prob=0.97`, gera `"confidence":0.970` (com zero à direita)
- `"latitude":%.6f`, `"longitude":%.6f` (idem em casos onde o último dígito é 0)

O server reconstrói o canonical com `JSON.stringify(sortObjectKeysDeep(rest))` (`supabase/functions/server/lib/ingest.ts:178,200-202`), que segue a regra ECMAScript de **shortest round-trip**: `JSON.stringify(0.97)` retorna `"0.97"` (sem zero à direita). Com strings divergentes, os SHA-256 divergem e a verificação ECDSA falha.

O ESP8266 não tem esse bug porque usa `ArduinoJson::serializeJson()`, que implementa shortest round-trip estilo Grisu — bate com `JSON.stringify` byte-a-byte.

**Workaround atual.** `#define UNSIGNED_DEV_BYPASS 1` em `ESP/esp32s3/esp32s3.ino` faz o firmware enviar `signature="unsigned_dev"`. O handler `/server/reading` (`supabase/functions/server/index.ts:2515-2517`) aceita esse marcador conforme ADR-011 e pula a verificação ECDSA. **Identidade do device continua sendo enforced** via lookup `source` → `devices.public_key`; o que se perde é prova de integridade do payload.

**Fix definitivo.** Portar a construção do canonical envelope no ESP32-S3 de `snprintf` pra `ArduinoJson::JsonDocument` + `serializeJson()`, igual o ESP8266 faz. Branch sugerida: `feat/esp32s3-arduinojson-canonical`. Ao mergear, mudar `UNSIGNED_DEV_BYPASS` pra `0` (ou remover o `#define` + `#if`/`#else`/`#endif` correspondente) e remover o handler do `unsigned_dev` em `index.ts:2515-2523`.

---

## Múltiplos POSTs por uma única elocução de "claro"

- **Status:** resolvido (refractory específico de claro)
- **Detectado:** 2026-04-30
- **Resolvido:** 2026-04-30
- **Componentes:** `ESP/esp32s3/esp32s3.ino`

**Sintoma.** Falar "claro" uma vez perto do mic disparava 2-3 POSTs pra `/server/reading` em sequência (~1-3 segundos de espaçamento). O dashboard renderizava a mesma elocução como múltiplas readings independentes (timestamps próximos, hashes distintos).

Logs de exemplo (sessão 2026-04-30 15:01):

```
15:01:30.025  claro=0.88  noise=0.02  unknown=0.09  -> claro (0.88)   [POST]
15:01:39.010  claro=0.82  noise=0.00  unknown=0.18  -> claro (0.82)   [POST]
15:01:41.080  claro=0.30  noise=0.45  unknown=0.24  -> noise (0.45)   [POST]
```

**Causa raiz.** Combinação de duas decisões válidas individualmente mas que interagem mal:

1. Edge Impulse roda em **modo contínuo** com janela deslizante (~50% overlap). Uma elocução de ~1s cobre 2-3 frames de inferência. Cada frame ainda tem `claro` elevado, mas o último frame frequentemente é um "tail" onde claro caiu pra ~0.30 enquanto noise subiu.
2. O gate de publicação privilegia `claro` sobre o argmax: se `claro_prob ≥ 0.30` (`PUBLISH_THRESHOLD_CLARO`), publica claro mesmo quando noise/unknown são argmax. Decisão deliberada pra demo (comentário em `esp32s3.ino:111-116`), com aceitação explícita de "falso-positivo ocasional".

O cooldown compartilhado de 1.2s (`PUBLISH_COOLDOWN_MS`) era suficiente pro Nó 1 (DHT11 publicando a cada 10s+), mas insuficiente pra inferência KWS contínua: 2-3 frames consecutivos do mesmo ~1s de áudio passam todos do cooldown.

**Fix aplicado.** Refractory específico de claro em `ESP/esp32s3/esp32s3.ino`:

- `CLARO_REFRACTORY_MS = 3000` (3s — cobre duração típica de uma fala + reverberação curta sem suprimir uma segunda elocução intencional).
- Estado `last_claro_publish_ms` rastreado separadamente do `last_publish_ms` global.
- Ao gate da claro, verifica `millis() - last_claro_publish_ms < CLARO_REFRACTORY_MS` e suprime com log `[skip] claro em refractory pós-publicação`.
- Threshold (0.30) e prioridade-sobre-argmax preservados — a decisão original de favorecer ativações de demo continua intacta. Só blocamos o replay da mesma elocução.

**Por que não foi a outra opção.** Subir o threshold pra ~0.65 e/ou aumentar o cooldown global eram alternativas discutidas. Rejeitadas porque (a) o threshold baixo é deliberado e descer falso-positivos vinha junto, (b) cooldown global afeta unknown também, que tem dinâmica diferente.
