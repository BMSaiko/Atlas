# utsuo3r4 — plano (R2 grill-me: tasks em doing dão crash)

## Objetivo
Round 2 do grill-me (re-spawn de boovbe9e). R1 já perguntou objetivo, escopo, dor central, telemetria — user respondeu Q1 (Durable + Diagnóstico + Resiliência), Q2 (default escopo Atlas-wide — reply "feature/atlas-0bzqiwc5" foi provavelmente copy-paste errado de branch), Q3 (TODOS os 3 sub-problemas — "todos são pessimos"), Q4 (heartbeat sim — "faz o recomendado").

R2 destrava a nova frontier: retry policy, worktree recovery, diag no card.result, telemetria (log vs status), classificação de failure modes.

Conforme a skill grilling, NÃO implemento nada — output: nota R2 + card em review com result. User confirma via reply.

## Abordagem
1. **Fact-finding** (lido no repo, sem perguntar):
   - Watchdog existe em `server/api.ts` L1007-1047 (`GET /orphans`) + `src/main.ts` L194-227 (`watchOrphanCrashes`). Heurística 5min + log parado/vazio.
   - Wrapper spawn em `server/api.ts` L371-490: `spawn(VENV_PY, ['-c', wrapperWithPane, ...])`, detached, windowsHide. argv: [stPath, wt, branch, repo, prompt, baseBranch]. argv[1]=stPath escreve `{state, pane, ts}` antes de chamar hermes.
   - `.status` schema atual: `{state: 'running'|'done'|'merge-failed', code?, pane?, ts, branch?, log?}`.
   - `cleanupWorktrees()` corre no boot (configureServer), fire-and-forget, best-effort.
   - Sem auto-retry, sem diag no result (string fixa "CRASH: ..."), sem histórico, sem classificação.

2. **Frontier R2 = 5 Q independentes**:
   - Q1: Retry policy (auto vs manual)
   - Q2: Worktree recovery (cleanup passivo + signal vs auto-clean agressivo)
   - Q3: Card.result com tail do log
   - Q4: Telemetria — .log heartbeat (já involuntário) vs campo `lastHeartbeatAt` no .status
   - Q5: Failure mode classification (4 strings: WRAPPER_DIED / HERMES_STUCK / TRANSIENT / MERGE_FAILED)

3. **Notas**: 1 nota R2 (tags grilled/decision/awaiting-user/card-utsuo3r4/round-2). Cada Q com recommended.

## Ficheiros tocados (neste run)
- `plans/utsuo3r4.md` (este ficheiro)
- `data/atlas/notes.json` (nota R2 via PUT na API)
- `data/atlas/kanban.json` (card → review + result via PUT na API)

## Ficheiros NÃO tocados (espera confirmação)
- nenhum em `server/`, `src/`. Sem implementação.

## Próximos passos (se user confirmar R2)
1. Quando user responder via Reply no card:
   - Lançar R3 com sub-quests dependentes (merge-conflict recovery, dashboard metrics, etc.).
   - Ou, se R2 já cobre tudo, ir direto a implementation plan: 1-2 ficheiros em `server/api.ts` (heartbeat no wrapper + classification no watchdog) + 1-2 em `src/main.ts` (read tail do log no card.result).
2. Implementação respeitando ponytail: mínimo código, stdlib first, fence anti-wipe mantido.

## Verificação
- Card utsuo3r4 em `review` com `result` descritivo.
- Nota R2 `n1788298419529` na board com 5Q + recommended.
- tsc --noEmit: OK (exit=0; sem diff em server/ nem src/).
- Working tree clean.
