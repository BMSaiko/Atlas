# h1y3yfsy — plano (R3 grill-me: tasks em doing dão crash)

## Objetivo
Round 3 do grill-me. R1 (card original) perguntou objetivo — user respondeu vague ("faz o recomendado", "todos são pessimos"). R2 destravou a frontier com 5Q detalhadas; user respondeu cada uma com implementação específica. R3 = consolidar, **NÃO implementar** (per skill: "NAO atues sem confirmacao"). Saída: nota R3 + card em review + result descritivo.

**Estado actual do código** (verificado agora): a R2 fez dois agentes previos deixarem código parcial em `dev` (uncommitted, dirty):
- `src/views/kanban.ts` L405-410, L881, L891-893, L934-948: **Q1 + Q2 JÁ FEITAS** (badge "⚠ retry após crash" no botão Run, "Limpar worktree órfã" no viewModal).
- `src/main.ts` L196-235 `watchOrphanCrashes`: **Q3 + Q4 + Q5 parciais no CLIENTE** (lê `o.classification`, `o.logTail`, `o.lastHeartbeatAt`, `o.orphanWorktreePath` da API).
- `server/api.ts` L1010-1047 `GET /orphans`: **NÃO PRODUZ** nenhum desses campos — só `cardId, title, priority, startedAt, logSize, logMtime, stMtime, cardAgeMs`. Wrapper python em L446-454 só grava `{state, pane, ts}` no .status (sem `lastHeartbeatAt`).

→ **Gap real**: server-side. Q1+Q2 estão prontas no UI; Q3+Q4+Q5 estão half-implemented no cliente, falta o server.

## Contexto (R1+R2, do card description)
R1 (22:29:25):
- Q1 "free-tier OR exhaustion é normal" → "faz o recomendado"
- Q2 "branch" → "feature/atlas-0bzqiwc5" (provavelmente copy-paste errado; ignorado)
- Q3 "sub-problemas" → "todos são pessimos"
- Q4 "abordagem" → "faz o recomendado"

R2 (22:37:58) — frontier destravada:
- **Q1 retry policy**: NÃO auto-retry. Manual 1-click via botão Run (já implementado). Auto-retry só se aceitares "best-effort 1 retry com backoff 30s em transient" (rede/OOM) — **user rejeitou explicitamente, NÃO adicionar**.
- **Q2 worktree recovery**: cleanup passivo (boot, já existe) + sinalização explícita. NÃO auto-clean agressivo. Botão "Limpar worktree órfã" no viewModal **já implementado** em kanban.ts L892, L937-948. → ✅ completo.
- **Q3 tail do log no card.result**: incluir últimas 5 linhas OU 500 chars (o que for menor). Custo ~10 linhas. → precisa server-side.
- **Q4 telemetria**: 2 fontes. (a) .log progresso ao vivo (já involuntário, prompt template manda). (b) Campo `lastHeartbeatAt` no .status, escrito pelo wrapper a cada 30s. Watchdog expõe no /orphans. → precisa server-side + wrapper.
- **Q5 classificação**: 4 strings: `CRASH_WRAPPER_DIED` (log vazio + startedAt > 5min), `CRASH_HERMES_STUCK` (log stale + heartbeat velho), `CRASH_TRANSIENT` (heartbeat recente + rc≠0), `CRASH_MERGE_FAILED` (.status='merge-failed' antes do watchdog). ~15 linhas. → precisa server-side.

## Frontier R3 = VAZIA
Todas as decisões estão settled. O que falta é a confirmação do user para implementar. NÃO escrevo código de produção neste run.

Possíveis R4 se user pedir:
- Q-merge: como integrar com killPaneForCard (já existente em L258-278) quando classified=CRASH_HERMES_STUCK? Mata pane + reset.
- Q-history: dashboard de orphans histórica (taxa de crash por dia)?
- Q-merge-conflict: .status='merge-failed' → UI mostra diff do conflito? Já temos o log no .status, mas não um botão "ver conflito".

## Abordagem
1. **Plano** (este ficheiro) — output primário.
2. **Nota R3** — 1 nota consolidada com as 5 decisões settled (tags: grilled, decision, card-h1y3yfsy, round-3). Não preciso de 1 nota por decisão — o user já as deu todas no R2; o que vale é a confirmação partilhada de que o plano está correto.
3. **Card → review** — via PUT kanban + `result` field.

## Ficheiros tocados (neste run)
- `plans/h1y3yfsy.md` (este ficheiro)
- `data/atlas/notes.json` (nota R3 via PUT na API, com tags certas)
- `data/atlas/kanban.json` (card h1y3yfsy → review + result, via PUT na API)

## Ficheiros NÃO tocados (espera confirmação)
- nenhum em `server/`, `src/`. **Sem implementação** neste run — só plano.
- Worktree `feature/atlas-h1y3yfsy` não existe; corrijo na próxima ronda (R4) se user aprovar implementação.

## Próximos passos (se user confirmar R3 → "DA")
1. R4 = implementation run. Worker entra na branch `feature/atlas-h1y3yfsy` (criada a partir de dev), commits isolatedos:
   - **server/api.ts** wrapper python: adicionar loop de heartbeat (a cada 30s, re-escrever `.status` com `{state:'running', pane, lastHeartbeatAt: time.time()}`). ~4-5 linhas.
   - **server/api.ts** `/orphans` handler: ler `.status` para `lastHeartbeatAt`, ler `.log` para tail (últimas 5 linhas OU 500 chars), classificar, anexar `orphanWorktreePath` se worktree dir existe. ~15 linhas.
   - **src/main.ts** `watchOrphanCrashes`: já lê os campos; se server envia, render fica limpo. Sem diff.
   - **src/views/kanban.ts**: sem diff (Q1+Q2 já implementadas).
2. tsc --noEmit + vite build OK.
3. Card → review + result com resumo.

## Verificação
- Card h1y3yfsy em `review` com `result` descritivo.
- Nota R3 criada com 5Q settled + tag `awaiting-user`.
- tsc --noEmit: OK (sem diff em server/ nem src/).
- Working tree: 1 ficheiro novo (`plans/h1y3yfsy.md`), 1 ficheiro dirty (kanban.json via API), rest igual ao estado anterior.
