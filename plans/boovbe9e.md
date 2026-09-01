# boovbe9e — plano (R1 grill-me: tasks em doing dão crash)

## Objetivo
Round 1 do grill-me sobre o tema "tasks em doing crasham, quero resolver mas não sei o que fazer".
Conforme a skill grilling, NÃO implemento nada sem confirmação do BMS. Saída: 1 nota `awaiting-user` com 4Q + recommended, card movido para review.

## Abordagem
1. Fact-finding já feito (lendo o repo, sem perguntar ao user):
   - `GET /api/w/:slug/orphans` (server/api.ts L1007-1047): heurística `startedAt > 5min + status=running + log parado/vazio`.
   - `watchOrphanCrashes()` em `src/main.ts` L194-227: poll 30s, dedup, **notifica + reseta doing→todo + grava card.result**.
   - Faltam: telemetria de CAUSA, retry, recovery de worktree órfão, histórico de crashes por card.

2. Frontier R1 = 4 Q com recommended (objetivo, escopo, dor central, telemetria).

3. Notas: 1 nota R1 (tags grilled/decision/awaiting-user/card-boovbe9e/round-1). Decisões settled no fim → 1 nota por decisão.

## Ficheiros tocados (R1)
- `knowledge/projects/atlas/code/data/atlas/notes.json` (criar nota via API).
- `knowledge/projects/atlas/code/data/atlas/kanban.json` (mover card doing→review, escrever `result`).

## Ficheiros NÃO tocados (espera confirmação)
- nenhum em `server/`, `src/`, `plans/`.

## Verificação
- card visível em `review` com `result` descritivo + nota R1 com 4Q legíveis.
