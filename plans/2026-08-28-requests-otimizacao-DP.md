# DP - Aplicar: otimizacao de requests OpenRouter (free tier)

**Estado:** AGUARDA DA (aplicar quando quiser migrar)
**Card:** atlas/gimqpiy5
**Ref:** DR 2026-08-28-requests-otimizacao-DR.md

## Fase 1 - Reduzir superficies (maior corte)
1. cron/jobs.json: fundir:
   - FoodLister Loop + Ideas + Report -> 1 job diario (Nex-N2-Mini :free).
   - Vault Backup -> script/no_agent (git puro, zero LLM).
   - Inbox Zero e Reviews -> manter, com :free.
2. openrouter.response_cache true + TTL >300s.

## Fase 2 - Fallback ranked (nao perder trabalho)
1. Config fallback_providers => primary :free, dentro budget Nex-N2-Mini.
2. Teste 429 simulado (burst 20+ RPM): task cai p/ budget e nao falha.

## Fase 3 - Requests por sessao
1. api_max_retries 2->1.
2. max_turns 90->~25; baixar threshold compression se a sessao ficar longa.
3. Preferir execute_code p/ multi-step (menos chamadas LLM).

## Fase 4 - aux 100% free
- aux.web_extract/compression/approval -> :free (contam para o mesmo limite).

## Verificacao (evidence)
- Rodar todos os cron uma vez; medir OpenRouter dashboard nesse dia;
  assert requests diarios < 1000 com margem.
- Teste 429/503: fallback coverage.
- Validacao: hermes config; confirmar no console.

## Commit / notes
- Este card e so DOC (DR+DP) - nao muda codigo-fonte do Atlas.
- Documentos no worktree do card; aplicacao num card Run posterior.
