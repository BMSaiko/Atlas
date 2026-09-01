# DP: ver sessões de DP junto das outras sessões

## Objetivo

No dashboard (e dashboard do mundo) a secção **"Sessões / terminais ativos"** lista apenas cards em `doing`. Uma sessão de **DP** corre headless (id fictício `dp-<cardId>`) mas **nao mexe** no `colId` — pode arrancar a partir de um card em `todo`. Resultado: DPs em curso sao invisiveis no dashboard, mesmo sendo a sessão mais longa do agente. Este card junta-as.

## Contexto / estado atual

- `src/views/dashboard.ts` → `sessions(rows)` (L84-100) filtra `r.board.cards.filter(c => !c.archived && c.colId === 'doing')`. Esta é a unica fonte da UI.
- `server/api.ts` → `launchDp(slug, card)` (L533-585) cria `runs/<slug>/dp-<cardId>.{log,status}` com `{state:'running', ts}` e mantém o card onde estava. Log/status partilhados com `/output/:cardId` (o id é literalmente `dp-<cardId>`).
- `server/api.ts` → `/api/w/:slug/orphans` (L1005) já lê `.status` por card; é o mesmo padrão.
- `data/.wt/runs/<slug>/dp-*.status` é onde a verdade sobre "DP a correr" vive. Não há endpoint que liste isto.

Caveat: já ha `dpPollers` no client (`src/views/kanban.ts` L25, L240, L479) mas vive so no escopo do kanban view — se o user nunca abriu o card, nao há poller. Tese: a fonte de verdade tem de ser o server.

## Abordagem proposta

1. **Server** — novo endpoint `GET /api/w/:slug/dp-sessions` (`server/api.ts`).
   - Itera `board.cards` (não arquivados).
   - Para cada card: `readJ('dp-<id>.status')` em `runs/<slug>/`; se `state === 'running'` e o `.status` foi tocado há < 30 min (sessão zombie = mesma heuristica do orphans), inclui o card.
   - Resposta: `{ sessions: Array<{ cardId, title, priority, startedAt, slug, wdIcon?, wdName }> }`.
   - Implementação segue literalmente o padrão de `/orphans` (L1014-1042): mesmo loop, mesmo `readJ`, mesmo `STALE_MS` (5min). Diff: não filtra por `colId==='doing'` e o id do status é prefixado com `'dp-'`.

2. **Client** — extender `sessions(rows)` em `src/views/dashboard.ts`.
   - 2ª chamada paralela em `renderDashboard` / `renderWorldDashboard`: `api.dpSessions(slug)` por mundo, agregado.
   - Junta-se à lista atual; badge visual `DP` (cor sky, reutiliza `.kbadge-dp` ja existente em `components.css` L246). Sem novo CSS.
   - Render: `<li class="sess sess-dp">` com `.sess-card` igual + suffixo "DP". Click navega para `/w/<slug>?tab=kanban&open=<id>` (mesmo padrão do search results L274).
   - Count separado ou somado: somado, com label "X a decorrer (Y DPs)". Minimo.

3. **Reutilização** — zero abstracções novas. `sessions()` ganha 1 param opcional `dpSessions: DpSession[]`; cai no helper existente de tick 1s (`data-elapsed`, L75-82) — nada novo para refrescar tempo.

4. **Testes** — não há suite de teste deste codepath; nenhum card de teste cobre UI dashboard. Skip. Smoke manual: gerar 1 DP num card em todo → verificar que aparece na secção sem mover o card.

## Ficheiros afectados

- `server/api.ts` (+~25 linhas: novo handler `/api/w/:slug/dp-sessions` ao lado de `/orphans`, L1005).
- `src/api.ts` (+2 linhas: `dpSessions: (slug) => j<...>(...)` no objeto `api`).
- `src/views/dashboard.ts` (~10 linhas: 2ª fetch paralela + `sessions()` com param + render do badge DP).

Total estimado: ~40 linhas. Zero CSS novo. Zero dependência nova.

## Criterios de aceite

1. Abrir dashboard global com ≥1 mundo onde haja 1 DP a correr (card em todo) → aparece na lista com badge "DP" + elapsed ticking.
2. Abrir dashboard desse mundo → mesmo comportamento, scoped.
3. Cards que estão simultaneously em DP e em doing (edge: orquestrador moveu o card antes do DP acabar) → aparecem uma vez, badge DP (DP é o estado "vivo" mais especifico).
4. DP terminado (`state==='done'` no .status) → desaparece da lista no proximo refresh do dashboard.
5. Zombie (status running há > 5min, log parado) → **nao** aparece (mesma janela do orphans — quem tratar, trata via orphans; este endpoint lista sessões saudaveis).
6. `npm run typecheck` limpo, `npm run build` limpo.

## Riscos / consideracoes

- **Cache / polling**: dashboard já é re-rendered manualmente (sem auto-refresh). Se o user deixar o dashboard aberto durante um DP, só vê a sessão ao re-entrar. Aceitável para v1; auto-refresh é outro card.
- **Múltiplos DPs no mesmo card**: hoje o `dp-<cardId>.status` é único por card. Re-pedir DP sobrescreve o ficheiro (cria novo `running`). Sem locking — race possivel mas a mesma já existe no `/output`. Sem mudanças.
- **Privacidade entre mundos**: cada endpoint já é escopado por slug. Sem cross-tenant leak.
- **Sem logs em disco**: se a pasta `runs/<slug>/` nao existir (workdir novo, nunca correu DP), o endpoint devolve `{sessions:[]}`. Sem erro.
- **No-op para workdirs sem repo**: o `runs/<slug>/` é derivado de `wtRoot(repoDir(slug))` — segue o mesmo caminho do `orphans`. Se o mundo nao tem repo, hoje o orphans rebenta silenciosamente com try/catch. Mesmo padrão aqui.
