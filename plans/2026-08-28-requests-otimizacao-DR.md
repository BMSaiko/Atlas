# DR - Otimizacao de requests: OpenRouter free tier

Estado: AGUARDA DP (DP escrita em branch)
Data: 2026-08-28    Card: atlas/gimqpiy5

## Objetivo
Reduzir o NUMERO de requests a API (OpenRouter) para que a migracao para o
free tier (apos top-up de 10$) preserve o trabalho atual. No free tier o teto e
1000 requests/dia (contagem de chamadas, nao volume de tokens).

## Referencia
Artigo: https://ask-coreai.com/blog/openrouter-free-models-2026-limits-catches

### Factos que mandam
1. Free = modelos sufixo `:free`, custo $0/token.
2. ~20 RPM por conta - comprar creditos NAO sobe o teto por minuto.
3. Limite diario: ~50/dia conta nova; 1000/dia apos top-up de 10$ (uma vez,
   lifetime) - os 10$ e o desbloqueio principal.
4. Prioridade BAIXISSIMA no free: fila, throttling/429 em pico, modelos podem
   ser retirados sem aviso (= spot capacity).
5. Privacidade: alguns endpoints free podem ler/partilhar nos prompts - nada
   sensivel para o free.
6. Fallback ranked: passa uma lista de modelos e o free que devolve 429 cai
   num budget pago (mantem o teto de falhas).
7. Custo tokens: budget pago (ex. Nex-N2-Mini) e quasi zero para o nosso
   volume - e o backstop natural.

NOTA CRITICA: como o teto free e "1 request = 1 chamada LLM", otimizar e
REDUZIR o COUNT de calls, nao o tamanho em tokens.

## Inventario atual - onde vao os requests

| Superficie | Rotina | Modelo atual | Requests/run (est.) |
|---|---|---|---|
| 7 cron jobs (AppData/Local/hermes/cron/jobs.json) | diario/semanal | stealth/ox-alpha (openrouter) | 1 sessao LLM = dezenas de chamadas |
| Interactive CLI (HEIMDALL) | on-demand | deepseek-v4-flash | por turno/tool |
| Gateway Discord | on-demand | default openrouter | por comando |
| Atlas run-card (spawn -hermes oneshot) | por card | perfil hermes | 1+ /card multi-turno |
| Aux models (web_extract/compression) | dentro de sessao | auto->openrouter | 1+ /invocacao |
| Retries (api_max_retries=2) | nas falhas | - | +1-2 por request falho |

O consumo real esta DENTRO das sessoes: cada turno com tool-call = 1 request.
Cron jobs e run-cards (multi-turno autonomos) sao os maiores geradores.

## Opcoes (A..G)
- A - Reduzir sessoes/dia (maior ganho): fundir 7 cron jobs; jobs mecanicos (ex. Vault Backup) em no_agent = ZERO LLM.
- B - Reduzir requests por sessao: multi-step em execute_code (1 request em vez
  de N); max_turns 90->25; compression ajuste.
- C - Response Cache: openrouter.response_cache true (ja ativo) - requests
  repetidas ficam cached, nao descontam. TTL 300s ok.
- D - Fallback ranked (imperativa p/ autonomia): [:free -> budget] - free da
  429 -> NÃO falha o job, cai p/ budget pago. E o que garante "continuar
  a trabalhar como hoje".
- E - Modelos certos: free p/ batch/cron, budget p/ interactive e aux.
- F - Aux em :free (web_extract etc.) quando puder.
- G - 20 RPM: so afeta bursts simultaneos (ex. muitos cards run em paralelo).

## Criterios de aceite
- Requests/dia (cron + workflow normal) < 1000, confirmado dashboard.
- Nenhum fluxo critico falha com 429 (fallback cobre).
- Autonomia atual (cron + Atlas run-card + interactive) preservada.

## Riscos
- Privacidade (secrets vs free) - evitar free para o sensivel.
- Endpoint free e volatil: fallback pago obrigatorio.
- Fundir cron pode reduzir qualidade de decisao - aceite para batch.
- 20 RPM em paralelo se varios run-cards correrem ao mesmo tempo.

## Referencias
- Skills: kanban-worker, dr-brainstorming, atlas-dev.
- Config chef: AppData/Local/hermes/config.yaml (modelo nex-agi/nex-n2-mini,
  openrouter; api_max_retries: 2; response_cache: true).
