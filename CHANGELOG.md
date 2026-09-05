# Changelog

## [Unreleased] - 2026-09-05 — kanban feature + card-driven workflow removed

- **feat(atlas): strip kanban feature and workflow** (`06db44e`, ~9633 LOC removed) — primary views, routes, lib/run-card, orchestrator, card-driven loop, prompts, dead tests.
- **2nd-pass cleanup (this commit)** — residue scrub: catch-all route renamed `w:notes-kanban-bundle` → `w:notes-events-bundle`, dead CSS classes dropped (~2.5KB), chat prompt examples retargeted to calendar events, dead Kanban icon dropped, snapshot-UI kind-label removed. `data/<slug>/kanban.json` preserved on disk for restore-compat of old snapshots; bundle shape keeps the optional `kanban` field for old-bundle compat.
- Notes/Calendar/Chat/Settings/Workspace/Workdirs/Snapshots untouched (functional surface unchanged).

## 2026-09-05 — card-driven kanban loop (SP lifecycle)

- **feat(atlas): card-driven kanban loop — SP lifecycle, kill-on-transition, status chip** (`e25ff0d`) — liga o Atlas kanban ao ciclo de vida do **Super Prompt** end-to-end:
  - **Schema** (`src/api.ts`): 2 campos opcionais no `Card` — `superPromptBody?: string`, `superPromptRef?: string`. Zero schema bump para callers existentes.
  - **3 rotas novas** em `server/routes/w.ts`:
    - `POST /api/w/:slug/kanban/sp` — persiste `{cardId, body, ref}` (validação: `50 ≤ body.length ≤ 200000`, `ref` regex `^knowledge/infra/super-prompts/[A-Za-z0-9_\-./]+\.md$`, 409 em `ver` mismatch), bumps `ver`.
    - `POST /api/w/:slug/kanban/refine` — re-usa a mesma worktree, mata o PID antigo via `killWorkerForCard`, dispara novo `launchHermes`.
    - `GET /api/w/:slug/runs/:cardId/pid` — devolve `String(child.pid)` do worker (escrito pelo `runCard` em PID file `<runsDir>/<slug>/<cardId>.pid`).
  - **`killWorkerForCard` helper** (`server/api.ts`) — narrow `taskkill /F /PID <pid>`; **NÃO** mata `node.exe` em massa. Complementa `killPaneForCard` no handler `PUT /api/w/:slug/kanban` (L645-657): agora ao mudar coluna, mata pane **e** worker python.
  - **`launchHermes`** injecta o bloco `${cardSP}` antes de `${cardDp}` no `prompts/run-card.md` interpolation; escreve PID file right after spawn.
  - **`runCard`** (`server/lib/run-card.mjs`) ganha campo opcional `pidPath?` (BC-additive — 2 callers existentes `w:approve-agent` + `launchHermes` continuam zero-config). Ponytail default: signature não muda, helper só ganha 1 path.
  - **UI** (`src/views/kanban-vanilla.ts`):
    - `kops(c)` em `todo`: se `!c.superPromptBody` → botão **generate-sp**; senão → mantém **run**.
    - Em `review`: botão **refine** adicionado.
    - `openSPModal` reusa `openModal` (1 hidden input + 1 textarea; Esc cancela, Ctrl+Enter submete).
    - `pidChip` polla `runs/<slug>/<cardId>.pid` cada 5s enquanto `colId === 'doing'`; MutationObserver na card root pára o polling em column change. Chip: `agent: running (pid 1234)`.
  - **Tests** — 4 ficheiros novos: `test/sp-persistence.test.mjs`, `test/sp-refine.test.mjs`, `test/sp-kill-transition.test.mjs`, `test/sp-runs-pid.test.mjs`. Gates: tsc `--noEmit` rc=0 · `npm test` 104 pass / 0 fail · `vite build` 6.63s. Scope: 305 ins / 30 del em 8 files. DP: `plans/atlas-card-driven-loop-DP/DP.md`.

## 2026-09-05 — calendar cross-mundo em `/c/calendar` (palette + grid + events CRUD)

- **feat(atlas-calendar): `/c/calendar` — month grid + kanban deadlines + events CRUD** (`d9fc113`) — agenda cross-mundo com:
  - **Month grid** (`src/views/calendar.tsx`) — view React (`/c/calendar`), navegação prev/next mês, dias com pontos para events+deadlines.
  - **Cards do kanban com `due && !archived && colId !== 'done'`** renderizam como chips read-only; clique salta para o card.
  - **Events CRUD** — `GET/PUT /api/w/:slug/events` (eventos livres: `title + date + colour + note`); flat array por mundo, **sem OT** (single-user save-state). Reusa `openModal`, `confirmDialog`, `Icon`, `j<T>`.
  - **No new deps** — `lucide-react` + nativo `<input type="date">` + `Intl.DateTimeFormat`.
- **feat(atlas-calendar): add calendar to common command palette** (`2b4d9cb`) — entrada "Calendário" no `Ctrl+K`, filtrável por "calend/agenda/eventos/calendar/event". Sibling do Chat (cross-mundo) na secção Global; sem shortcut leader (evita clash com `;D` dashboard, `;M` chat, `;T` tema, `;F` fuso).

## 2026-09-05 — keyboard-first: commands registry + leader `;` + data-cmd audit

- **polish(keyboard-first): commands.ts registry + Ctrl+K palette + ; leader shortcuts + data-cmd audit** (`62ca91e`) — Atlas agora é keyboard-first:
  - **`src/lib/commands.ts`** — registry único: **56 commands em 6 grupos** (mundo, notas, kanban, global, navegação, sistema). Single source of truth; a palette renderiza a partir daqui.
  - **`src/ui/palette.ts`** — refactor: substitui o bloco inline `push()` (linhas 41-95 do original) por loop sobre `useCommands()`. Bridges `window.__atlas*` para o registry dispatch, recentes via MRU (`atlas.recentCommands`, max 10), overlay de atalhos via `?` (símbolo bare).
  - **Leader `;` + 1 letra** — mindinho esq descansa em `;`, zero conflito com filtro PT-PT. Mapa: `;N` (nota), `;C` (cartão), `;T` (tema), `;D` (dashboard), `;S` (settings), `;M` (chat), `;F` (fuso), `;?` (overlay de atalhos).
  - **`data-cmd` em todos os 81 `<button>`** do app (7 ficheiros). Audit test em `test/palette-dom-audit.test.mjs` garante zero orphans e per-view counts ≥ SP.
  - **Tests** — 11 new asserts em `commands.test.mjs` (registry invariants, MRU, PT-PT-safe shortcut regression guard) + 6 em `palette-dom-audit.test.mjs`. Total: **117/117 verde**, tsc rc=0.
- **fix(palette): leader `;` accepts physical Semicolon code (cross-layout)** (`e320c3f`) — match primário por `e.code === 'Semicolon'` (layout-independent), fallback `e.key === ';'` e `e.key === ':'`. Regression guard em `commands.test.mjs` grep-a o source para garantir as 3 variantes. 118/118 verde.
- **Não tocado** — `server/**`, `src/api.ts` (HTTP contract), tokens, PWA shell, arquitetura React-shim, todos os `<button>` inline (só ganharam `data-cmd`).

## 2026-09-05 — epic-D: vanilla TS → React 18 + Tailwind v4 + shadcn/ui + next-themes

- **migrate(epic-D)** (`cc95fda`) — migração de stack completa:
  - **Stack** — **React 18.3** + **react-router-dom 6.30** + **Tailwind CSS 4.3** (`@tailwindcss/vite`) + **shadcn/ui** (`@radix-ui/*`, `cmdk`, `lucide-react`, `next-themes`, `sonner`, `class-variance-authority`, `tailwind-merge`, `tailwindcss-animate`).
  - **Routes** (frozen): `/`, `/w/:slug`, `/w/:slug/settings`, `/c`, `/c/calendar` via `react-router-dom@6`.
  - **Server byte-identical** — `server/**` intocado, `api.ts` HTTP contract preservado.
  - **Approach** — thin React wrappers por view; vanilla view code preservado em `*-vanilla.ts` (70KB kanban, 35KB notes, 25KB dashboard intactos). `NavBridge` captura `useNavigate()` em `globalThis` para `navigate('/...')` imperativo das views vanilla. `useThemeShift()` lê time on mount (60s interval) → `data-shift`/`data-season` em `<html>`; `next-themes` ortogonalmente seta `class="dark"`.
  - **Tailwind v4** — `src/index.css` `@theme` block declara cosmos/gold/marble/pipe como `--color-*` (utilities `bg-bg-0`, `text-gold`); `components.css` ainda carregado para classes vanilla até Epic A polish sweep.
  - **Gates** — tsc rc=0, `npm test` 102/102, `vite build` rc=0 (510KB main JS), smoke: dashboard, `/c`, `/w/:slug` renderizam 0 JS errors.
  - **Ponytail** — skipped sonner Toaster wiring (Epic C owns toast styling), kept bespoke `ui/toast.ts`. Skipped full Tailwind conversion de `components.css` (Epic A). Skipped lucide-react replacement de `ui/icons.ts` (~50 refs) — novo `<Icon>` disponível para código novo, legacy `icon('name', n)` shim preservado.
  - **Novos ficheiros** — `src/App.tsx`, `src/main.tsx`, `src/router.tsx`, `src/lib/utils.ts`, 17 componentes em `src/components/ui/` (alert, avatar, badge, button, card, command, dialog, dropdown-menu, input, label, popover, progress, scroll-area, separator, sheet, skeleton, tabs, textarea, tooltip).

## 2026-09-04 — main-chat v2 (multi-conversation + sidebar + agent self-execute)

- **feat(atlas): main-chat v2 — multi-conversation + sidebar + agent self-execute** (`4782533`) — chat cross-mundo `/c` upgrade:
  - **Schema multi-conversation** (`server/lib/chat.mjs`) — migra `{messages:[]}` antigo. **8 funções**: `read/append/clear` + `newConversation/switchConversation/deleteConversation/listConversations`. Cap 200 msgs/conversa (FIFO rotate).
  - **Sidebar de conversas** + agent com **self-execute** (Atlas parity) — lê `meta`/`notes`/`kanban`/`logs`, escreve `notes`/`kanban`/`review.approve|reject`/`orchestrator.start` em qualquer mundo via API. Token injetado no prompt.
  - **Slug sempre explícito** no user prompt — agente nunca assume mundo; se user não disser, responde "Em que mundo?".
- **atlas: main chat cross-mundo em /c** (`6fb66e9`) — feature inicial: composer + thread scrollable + stream output (poll 1s, reusa pattern `w:output`).
- **Persistencia** — `data/_chat/history.json`, item na sidebar + entrada no `Ctrl+K`.
- **Tests** — `test/chat-history-cap.test.mjs`, `test/chat-routes.test.mjs`.
- **DP** — `plans/2026-09-04-main-chat-DP/DP.md`.

## 2026-09-04 — polish(A): token scales + components.css sectioned + uniform cards + focus AA

- **polish(epic-A)** (`1c4890b`) — foundations de design:
  - **Token scales em `src/styles/tokens.css`** — `--shadow-1..3`, `--z-*`, `--motion-*`, `--ease-*` (comment `ponytail:` documenta o porquê). `--space-*`/`--radius-*` rejeitados (esbuild minifier quebra em inner-dash names) — alias `--s1..7`/`--r1..3` preservados.
  - **`src/styles/components.css` sectioned** (64KB, 801 lines, 284 selectors) — banner approach com 9 secções navegáveis; byte-count preservado.
  - **Uniform cards** — `.wd-card`, `.note-card`, `.kcard`, `.card-block` partilham padding/border-radius/shadow scale; excluded `.foco-card` e `.sess-card`.
  - **Focus AA** — `:focus:not(:focus-visible)` mouse-only reset em `base.css` (sem flicker ring em clicks, ring só em Tab/keys).
  - **Chat lazy-load** — code-split por rota (`/c` carrega só on demand).
  - **DP** — `plans/2026-09-04-polish-A-foundations-DP/DP.md`.

## 2026-09-04 — Node run-card module (substitui 5 Python wrappers)

- **refactor(atlas): replace 5 inline Python wrappers with Node run-card module** (`042e60a`) — fim da "wrapper-class" de bugs:
  - **`server/lib/auto-merge.mjs`** (NEW) — detached sub-process para o post-hermes git flow (chdir repo, checkout bb, fetch+merge, push, on push-fail retry, success cleanup wt+branch, merge-fail write `.status=merge-failed`). `detached+unref` sobrevive Vite restart.
  - **`server/lib/run-card.mjs`** (NEW) — `runCard()` spawns `hermes_cli.main` directly (no Python wrapper), heartbeats `.status` cada 60s (era 30s), sanitises C1 stdio, kills WezTerm pane on exit, em `rc==0` spawns `auto-merge.mjs` detached. `runHermesHeadless()` é a variante thin para os 3 sites sem worktree (`launchDp`, `spawnHeadless`, `launchBrainstorm`).
  - **5 sites em `server/api.ts` colapsam para 1 `runCard()` + 3 `runHermesHeadless()`** — argv shape lock-step TS↔Python (BUG 3b family) **morre** — call-sites passam typed object.
  - **Tests** — `wrapper-argv`, `wrapper-skills-argv` reescritos para testar o módulo novo; `sanitize-stdio`, `run-finish` atualizados. `test/_ts-loader.mjs` skip `.mjs` re-write. 81/81 verde.
  - **Closes** — `atlas-wrapper-python/SKILL.md` BUG 1, 2, 3, 3b partial, 3e, 3f partial, 3h partial.

## 2026-09-04 — fix EOL default CRLF + CI gate isolates dev server

- **fix(atlas): EOL default to CRLF + CI gate isolates dev server** (`80de9ff`) — 2 fixes acoplados:
  1. **EOL pinned CRLF** — `.gitattributes` updated (`*/ts/css/mjs eol=crlf`); `.git/config` local `autocrlf=true` + `eol=crlf` (matches Windows default, no rewrite on checkout). 224 files normalizados LF→CRLF in-place via Python (recipe em `michi/references/atlas-state-2026-09-03.md`). Supersedes `8514860` que declarava `eol=lf` sem local config para sustentar.
  2. **`runCIGate(repo)` → `runCIGate(repo, wtDir?)`** — quando `wtDir` ausente (current callers BC), build escreve em `.ci-gate/<ts>` (gitignored, cleaned após); quando `wtDir` passado, build fica em `dist/` default dentro da worktree isolada. Resolve clash com `npm run dev` no mesmo dir (rewrite de `dist/` sob live watcher).
- **style(atlas): normalize EOL to LF per .gitattributes** (`8514860`) — commit anterior que abriu o debate EOL (reconciliou working tree vs attributes sem logic change).
- **Recovered** — card `t02krhls` (sentido "lost work") NÃO foi perdido: vive em `live-data/atlas/kanban.json` colId=review com DP 10079 chars preservado.

## 2026-09-03..2026-09-05 — housekeeping

- **chore: relocate `.codebase-memory/` to `~/.hermes` (out of /code)** (`2dbdb14`) — Vite estava a page-reload cada vez que o HEIMDALL tooling escrevia em `.codebase-memory/` (artifact.json + graph.db.zst), porque o dir estava dentro do `/code` watched root. Como o dir é cache de tooling externo, não pertence ao repo. 3 files tracked removidos do tree (histórico git preserva).
- **chore(atlas): split test script — default skips integration tests** (`ef2e022`) — `npm test` corre 40 fast tests (~11s); `npm run test:integration` corre os 2 heavy (`run-integration`, `syncvault-debounce`).
- **fix(commands.test): use top-level readFileSync import** (`e039536`) + **post-merge resolution** (`6850e5a`) — conflitos no `test/commands.test.mjs` resolvidos via dynamic fs import / top-level readFileSync.

## 2026-09-01 — test routes e2e (16 routes + seam + harness)

- **Test infra para o backend (`server/api.ts`)** — 3 commits (`6bf5f37` + `ff7aece` + `64b83b6`) cobrem **~16 routes** out of ~30 do `api.ts` com `node --test` puro (vanilla `node:assert`, sem framework):
  - **11 routes e2e** (`6bf5f37`): `token-fence` (PUT sem token non-loopback → 401), `wtoken-loopback` (GET `/api/wtoken` non-loopback → 403), `bundle-roundtrip` (GET/PUT bundle shape), `hermes-keys-redact` (whitelist 17 campos, **access_token nunca vaza**, `secret_fingerprint = sha256(tok).slice(0,10)`, status 429/quota/rate → exhausted), `hermes-usage` (aggregator por `key_id` + bucket `__unknown__`), `orphans-heuristic` (5min stale window), `output-stream` (offset streaming), `import-roadmap-pat` (path-traversal), `workdirs-shape` (POST/PATCH/DELETE/reorder), `export-md` (front-matter + tags), `templates-merge` (global+workdir union).
  - **3 routes tier-A + test seam** (`ff7aece`): `icons-meta` (catálogo sorted `.svg`), `review-action` (approve/reject com 409 archived/colId-mismatch), `notes-kanban-put` (OT/wipe guard/backup/sanitize). **Test seam** = 7 LOC em `api.ts` que curto-circuita `launchHermes/launchBrainstorm/launchDp/launchGitOp/killPaneForCard` quando `ATLAS_TEST_NO_SPAWN=1`, e `runCIGate`/`mergeDevToMain` com `ATLAS_TEST_CI_OK=1` / `ATLAS_TEST_MERGE_OK=1` — comportamento 100% idêntico sem env (zero risco prod).
  - **2 routes tier-B + run-finish mirror** (`64b83b6`): `run-dp` (POST `/run` + `/dp` com board mutation + guards), `run-finish` (mirror do `p.on('close')` handler em `launchHermes` — 5 branches: code≠0+!result → ERRO, mergeFailed → MERGE FALHOU, code=0+result+doing → review, archived skip, colId≠doing skip). Cobre **B1** (card preso em doing) e **B2** (marker `ERRO` não aparece).
- **Harness partilhado** (`test/_atlas-runtime.mjs`, 217 LOC) — `spinAtlas({env})` levanta **Vite real em `middlewareMode`** com o plugin `atlasApi()` contra tempdir isolado; helpers `req()` (HTTP loopback) e `reqRaw({remote})` (spoofing de `socket.remoteAddress` para o token fence). `mergeDevToMain` shim via `opts.env` no mesmo processo. Per-test Vite `cacheDir` (cwd/node_modules/.vite) evita orphan-race no `~/.vite/deps` global. Companion `_ts-loader.mjs` reescreve `./roadmap`/`./config` → `.ts` quando o parent é `server/api.ts` (Node 22 strip-types não auto-resolve extensionless).
- **Run + status:** 24/24 PASS sequencial em ~17s (`node --experimental-strip-types --test test/*.test.mjs`); tsc verde. `npm test` continua a falhar em Windows (PATH `cmd.exe`); runner sequencial com `TEST_GIT` set passa 19–24/24 conforme o commit.
- **Padrão:** vanilla `node:assert` + counter `failures++` + `SOURCE EQUALITY` guard no fim ancora as linhas críticas do `api.ts` (regex/fence/strings) para apanhar silent divergence. Atlas-testing skill (`SKILL.md` v0.3.1) patchada com os pitfalls: DATA sticky (api.ts:11), PassThrough `push()` upfront, `res.statusCode` em Writable sintético, SLUG regex sem underscore.

## 2026-09-01 — integration tests i1..i4 + config.ts wezterm fix (root cause)

- **fix(server/config.ts): `||` -> `??` em `wezterm`** (commit `fd37ac4`) — `server/config.ts:67` usava `||` que comia string vazia vinda do `atlas.config.json` (`wezterm: ""` em testes headless) e caía no default `wezterm-gui.exe`. Como o GUI sai 0 imediatamente, o `p.on('close')` disparava com `code=0` antes do worker filho terminar, gravava valores errados no `.status`, e o close handler não promovía (merge-failed/sem `result`/code errado). Correcção alinha com o campo `port` que já usava `??`. Ponytail: o bug não era Node22, era config.
- **4 integration tests i1..i4** (`test/run-integration.test.mjs`, 122 LOC) — substituem `hermes_cli` por `test/fixtures/hermes_cli/` (PYTHONPATH shim) e exercitam o caminho REAL (`POST /run` -> python child -> git worktree -> `p.on('close')` doing->review). Cobertura:
  - **`[i1]` happy path** — fake worker grava `card.result`; close handler promove `doing`->`review`; wt removida pelo wrapper após merge OK.
  - **`[i2]` B1 forget_result** — worker NÃO grava `result`; card fica em `doing` (sintoma exacto do bug B1 "card preso em doing"); gap conhecido: wt é removida mesmo sem `result` — doc'd.
  - **`[i3]` B1+B2 crash** — worker exit 1; `card.result='ERRO: processo terminou com código 1 ...'`; `colId=doing`. Cobre o marker `ERRO` (B2 detect).
  - **`[i4]` source equality** — ancora `wrapperWithPane` grava `.status={state:running,pane,ts}`, `argv[1..6]=st..bb` (sem off-by-1), `os.chdir(repo)` (sem `base`), `p.on('close')` intacto, branches `code!=0` + ERRO marker + `!c2.result` guard de promoção (regressão do `dee0c2d`).
- **Harness `test/_atlas-harness.mjs`** (125 LOC) — `spinAtlasHarness({slug,cardId,mode})` partilha 1 `atlasRepo` (`_sharedCwd` sticky) entre os 4 testes (isolamento por slug único); `waitForClose(stPath, boardPath)` poll o `.status`. **+5 LOC** para suportar bare remote + push inicial dev (sem isso, `push origin dev` falhava em test e gravava `merge-failed` no `.status`, mascarando o close handler).
- **Fixture `test/fixtures/hermes_cli/main.py`** (62 LOC) — três modos: `write_result` (i1), `forget_result` (i2), `crash` (i3, exit 1).
- **Run + status:** 24/24 PASS sequencial em ~17s (routes-e2e); **28/28** com i1..i4. tsc verde. Cobertura backend salta de ~16 routes para ~16 routes **+** fluxo end-to-end `run`/`dp`/`close-handler`.

## 2026-08-30 — fix worker crash (argv off-by-1 root cause)

- **fix(kanban): argv off-by-1 no wrapper python** (commit `dee0c2d`) — `python -c SCRIPT` faz `sys.argv[0]='-c'`, não o python path. Wrapper de `launchHermes` lia `argv[2..8]` quando devia ler `argv[1..6]`. O commit `2397db5` tentou corrigir mas continuou off-by-1 (assumiu argv[0]=python path). Corrigido: `st=argv[1]; wt=argv[2]; branch=argv[3]; repo=argv[4]; prompt=argv[5]; bb=argv[6]`.
- **fix(kanban): `os.chdir(base)` → `os.chdir(repo)`** (`dee0c2d`) — `base` nunca foi definido nesta scope (typo antigo do commit `de12033`); em sucesso o `if rc==0:` crashava com `NameError` e o card ficava preso em `doing` (auto-merge não corria).
- **Repro:** `bao35dg0` / `phqqhn10` / `q49x3w24` (2026-08-30) — `.status=state:running` + `.log=0b` + card voltou a `todo` via watchdog aos 90s.
- **E2E pós-fix:** argv parse correto (`st`=stPath, `wt`=wt, ...), rc=0, `.status` gravado com `pane`, sem IndexError. tsc+build verde.
- **Refs:** `plans/2026-08-30-worker-crash-argv-off-by1-DP.md`

## 2026-08-30 — terminal-control-v2

- `killPaneForCard`: ao matar pane, se card ainda em `doing`, reset para `todo` (worker não promoveu ou master kill) — patch `b44c56c`
- `killAllPanesAtlas()`: cross-workdir; itera `index.json`, mata panes running em todos os mundos e reseta os cards
- `POST /api/terms/kill-all-atlas`: endpoint cross-workdir (loopback-only)
- `POST /api/terms/open {slug}`: abre pane WezTerm visível no workdir ativo (cwd = wt running se houver, repo root senão)
- Palette (Ctrl+K): 2 entradas novas no grupo "Terminais" — `Abrir terminal WezTerm` e `Matar todos os terminais do ATLAS` (confirm-dialog)

Todas as mudanças notáveis do Atlas. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-PT/1.1.0/), versionamento em `0.x`.

## [Unreleased]

### Added
- **PWA instalável + offline shell** — `vite-plugin-pwa` (1 dep dev) com manifest Web App (`ATLAS`, theme `#d6a83f`, bg `#050403`, ícones 192/512/maskable/SVG), `registerType: 'autoUpdate'` + `injectRegister: 'auto'`, Workbox precache do shell + assets públicos (74 entries, 318 KiB). `devOptions.enabled: false` (SW só ativa em build/preview). `vite.config.ts` + `public/icons/icon-{192,512,512-maskable}.png` (PNGs gerados a partir do `favicon.svg`). Sem cache de `/api/*` (rede continua a ser a fonte dos dados — card fixou "offline só lê cache de UI"). `package.json` + `vite.config.ts` + `public/icons/`.
- **Temporizador por cartão** — badge `mm:ss` no card + bloco no modal de edição (Iniciar/Pausar/Retomar/+1min/Remover). Estado (`timerMs`, `timerStartedAt`) persiste no `kanban.json`; alarme global em `src/main.ts` dispara `notify` (toast sempre, Notification nativa se houver permissão) ao fim, limpa `timerStartedAt` e mantém `timerMs` para Retomar. Cor: accent a correr, warn nos últimos 20%, ghost quando parado.
- **docs:** README temático Atlas — metáfora "mundo" (workdir) como voz central na documentação, sincronizada com as features de `dev`.
- **docs (refinamento 29/08):** README cobre agora também épocas do ano/estações, command palette (`Ctrl+K`), templates, botões Brainstorm e Gerar DP, visualização da tarefa em execução (stream de log), prazos/deadlines, prioridades urgentes e bulk actions — voz Atlas/"mundo" mantida sem perder precisão técnica.
- **Main dashboard** no root (`/`, `src/views/dashboard.ts`): visão geral de todos os workdirs — stat-grid (projetos, notas, cartões em aberto, concluídos), pipeline de trabalho em stepper com conectores + paleta por etapa (todo/doing/review/done nos 3 shifts), projetos com anel orbital de conclusão e sessões/terminais ativos (tempo decorrido com ticker de 1s). `src/views/dashboard.ts`.
- **Icons por workdir** — catálogo de 60 orbs SVG + picker nas Definições; cada trabalho com icon próprio na sidebar/dashboard (`/api/icons`).
- **Tags nas notas** — adicionar, pesquisar e filtrar por chips de tag; barra de tags na view de notas.
- **Seletor de fuso horário** (relógio da sidebar, badge clicável) — ~13 zonas comuns via `Intl`; persistido por workdir.
- **Tema auto/manual** — modo automático segue a hora (dia/entardecer/noite com horários nas Definições) ou manual fixo; indicador na sidebar visível em auto; paletas day/dusk/night realmente distintas e AA-safe.
- **Sessões de foco (overlay imersivo)** — cronómetro + pomodoro (fases focus/pausa, ciclos, notificações) num overlay a pedido; tiram os widgets da sidebar.
- **Notificações de review globais** — watcher em `main.ts` (qualquer vista/tab) com dedup por `(slug, card)`; permissão pedida só em user gesture (settings) via `src/ui/notifs.ts`.
- **Import roadmap** — `POST /api/w/:slug/import-roadmap` (botão **Importar** no Kanban): lê `.md` e cria 1 cartão por tarefa aberta + nota com o detalhe; idempotente por título; parser `server/roadmap.ts` cobre checkboxes, tabela BACKLOG e bullets (com cross-check de DONE).
- **Live-data** — junction para a vault + auto-backup por escrita (`syncVault`): as datas deixam de viver presas ao repo.
- **CI** — GitHub Actions (`typecheck` + build em `dev`/`main`).
- **Ordem dos workdirs** — drag & drop para reordenar na sidebar (+ `PUT /api/workdirs`).
- **Navegação** — `Alt+↑/↓` atravessa mundos e dashboard com wrap-around.
- **Checklists interativas nas notas** — `- [ ]` / `- [x]` com toggle (clique no checkbox) e persistência na nota (`src/ui/text.ts` + `src/views/notes.ts`).
- **Data visível no card (`kdate`)** — data de criação no título do card kanban (`src/views/kanban.ts`).
- **Cards recorrentes (kanban)** — campo `recur`/`occurrenceOf` (diária/semanal/mensal); quando uma ocorrência fica done/arquivada, watcher global (30s) materializa a próxima em `todo` com `due` avançado e `occurrenceOf=template`. Lembretes: card com `due` em [0, 30min] dispara UMA `Notification` (toast fallback), dedup por `slug:id`. Select "Recorrência" no modal novo+editar.
- **Badge de recorrência** — variante visual (`↻ diária`) com cor `--accent` para distinguir dos badges existentes (DP, resultado, review).
- **Backup/Export/Import de workdir inteiro** — `GET/PUT /api/w/:slug/bundle` (serializa `meta+notes+kanban`); UI em **Definições → Backup**: exportar (Blob + anchor download `atlas-<slug>-<data>.json`) e importar (file picker, valida shape mínimo, confirm de overwrite, re-fetch via navigate). Guards: `SLUG` regex + `inside(DATA, file)` contra path-traversal; PUT não valida `ver` (restore completo é destrutivo).
- **Dashboard: secção API keys (`/api/hermes/keys`)** — lê `auth.json` do Hermes, devolve `status` (active/exhausted/error/unknown) derivado do último erro, **censura `access_token`** (whitelist de campos + `sha256(token).slice(0,10)` como `secret_fingerprint`). Secção presente nas duas dashboards.
- **Dashboard: secção Usage (`/api/hermes/usage`)** — read-only sobre `HERMES_HOME/logs/atlas/usage.jsonl` (1 linha/request, escrita pelo HEIMDALL). Colunas `Hoje` / `Tokens hoje` / `Custo hoje` reativas; `totals_by_key` agrega por `key_id`, ignora linhas malformadas/sem `key_id` (balde `__unknown__`). Ficheiro ausente/ilegível → 200 com `totals_by_key: {}`.
- **Write-token anti-corrida (PUT)** — `PUT /api/w/:slug/{notes,kanban,bundle}` exige header `X-Atlas-Token = cfg.wtoken`; server imprime o token no boot (`[atlas] write token: <hex>`). Client recolhe via `?token=` no URL → `localStorage`. Helper CLI `npm run dev:token` (gera hex novo) e `.env` (`ATLAS_WTOKEN`) para setups persistentes. Fence: PUT **não-`127.0.0.1`/`localhost`/`::1` recusado** (loopback check + `x-forwarded-for` bypass); `1abde2a` corrige o bypass para aceitar loopback e adiciona endpoint `/logs` (`GET /api/atlas/logs`) para inspeção sem `WezTerm`. (iykn11lg — `f89b4c0` + `bcd18e0` + `1abde2a`)
- **Dashboard defloat** — strip da "floaty decoration" do dashboard hub (anéis orbitais ficam só em vistas por mundo); mantém stat-grid, stepper, sessões ativas e `Ctrl+K`. (kejap87w — `2f16cd2`)
- **Widget Meteorologia (Open-Meteo) no dashboard** — widget no dashboard hub com temperatura, condição textual (PT) e emoji (☀️/⛅/🌧/❄️); cache 10 min, geolocation via `Intl`/IP fallback, lat/lon configurável em Definições. (qoukodvd — `49b559f`)
- **Refactor `dpCard/viewDp`** — botão "Gerar DP" reusável entre cards (substitui duplicação em `dpCard`/`viewDp`); idempotente, não regenera se `dp` já existe salvo se `force=1`. (bao35dg0 — `c9afb6c`)

### Added
- **Crash detection + auto-recovery** — `server/api.ts` (`/api/w/:slug/orphans` GET, idempotente) + `src/main.ts` (`watchOrphanCrashes` 30s poll): card em `doing` há >90s com log parado ou wrapper python morto → toast + native notification + reset `doing→todo` + grava `result: 'CRASH: worker nao respondeu por >90s ...'`. Sem isto, runs orfãos ficavam invisíveis para o user. `0408ee8` + `34039f0` + `d8482f0`.
- **Auto-cleanup stuck runs** — `cleanupRuns` apaga `.status` com `state=running` há >6h. Runs activos (mtime recente) intactos. Log companheiro preserva output. `0408ee8`.

### Fixed
- **argv off-by-1 no wrapper python** (root cause dos crashes) — `python -c WRAPPER args...` faz `sys.argv[0]='-c'`, mas o wrapper lia a partir de `sys.argv[1]`, recebendo `'-c'` em vez de `stPath` e o `wt` (worktree path) em vez do `prompt`. O hermes recebia o caminho como prompt, crashava silenciosamente, e o card ficava preso em `doing` (auto-merge só corre se `rc==0`). Fix em `launchHermes` (wrapper + wrapperWithPane) + `launchDp` + `launchBrainstorm` + `launchGitOp` (todos liam `argv[1]` em vez de `argv[2]`). `2397db5`.
- **Patch 2 (kill-pane) tinha 1 path que saía antes** (`sys.exit(0)` no `if co.returncode!=0:` no auto-merge). Patch cobre o caminho comum; o fix de argv cobre o resto.
- **Empty `.log` no wezterm mode é por design** (output vai para a pane, não para o Node `p.stdout`). Watchdog ajustado para não disparar em false positives.

### Changed
- Cards com **2 tamanhos** (conteúdo vs output `.has-output`): limita o título do resultado (line-clamp 2 no card, completo no modal).
- Review agora é **coluna por default** em todos os kanban (garante no load + no default ao criar workdir).
- `run`: terminal WezTerm abre com o título do cartão (set-tab-title); auto-cleanup do worktree mais robusto (junction node_modules partilhado, retry remove+rm vs EBUSY, `worktree remove --force`, kill de panes lockers).
- `merge dev → main` resolve o tip real de `main` (local‖remote) antes do fast-forward.
- DP/resultado do card renderizam **Markdown legível** (`renderMd`, classe `.md-view`) no modal (`kdp-body`/`kresult-body`), substituindo o colapso CSS cru.
- **Keybinds de navegação** — `Alt+ArrowLeft`/`Alt+ArrowRight` cicla tabs do workspace (settings, kanban, notes, dashboard); `Ctrl+Enter` / `Cmd+Enter` submete forms em modais (cards + notas). (gz2775bp + rcrc00p4 — `945338f` + `2118985`)

### Fixed
- Notificações: poll com um único `setInterval` (sem duplicar em review), notif global funciona fora do kanban.
- Re-run de card: worktree "já existe" — retry remove+rm + prune após o dir sumir; limpa `result`/`reviewed` ao voltar a `doing`.
- Foco: overlay fecha com Esc/clique-fora; botões/durações visíveis (z-index do modal pomodoro corrigido).
- Contagens (10.2.1): arquivar a última nota ativa atualiza a badge (early-return).
- Notas: em `renderMd`, a linha de **task/checkbox** (`- [ ]`) casa **antes** da lista genérica — o checkbox só renderizava após o `- ` genérico cair no `<li>` morto (DI 29/08).
- `launchHermes`: base branch do task-runner passou a ser a **branch default real do repo do mundo** (não hardcode `dev`) — repos sem `dev` (ex. só `master`) deixam de falhar no `worktree add`.
- **Cards headless stuck em `doing`** — quando o worker termina (`code=0`) com `result` ou `dp`, `launchHermes`/`launchDp` no `p.on('close')` promove `colId='review'` (idempotente; salta se o user já moveu manualmente). Erros `code!=0` ficam em `doing` para o user ler o log.
- **Notes sem `id` (sanitize+defesas)** — PUT de notes e `openNewNoteModal`/`renderNotes` garantem `id` (uid()) em items faltantes (brainstorm/import/manual); sem id os handlers `data-id` partiam. Emite `[atlas] note sem id — sanitize:` com count no server (`server/api.ts` + `src/views/notes.ts`).
- **View modal não fecha ao clicar nas ações** — cliques nos botões do modal (DP, run, archive, priority) mantinham-no aberto por stopPropagation; corrigido — clique numa ação agora fecha o modal. (as9jxybp — `f1d3d58`)

## [0.1.0] — app-shell + workdirs + kanban

### Added
- Vite+TS SPA: shell com sidebar workdirs (keybind `Ctrl+Alt+1..9`, item activo gold) + painel.
- Workdirs isolados (`data/<slug>/{meta,notes,kanban}.json`), hub `/`, workspace `/w/:slug`, settings.
- Quicknotes com busca; kanban (To Do / Em Curso / Review / Done), prioridade, drag & drop nativo.
- Design cosmos/noite com auto-shift dia↔dusk↔noite, acessibilidade AA, links gold, counts.

### Added (task-runner)
- Card kanban → `POST /api/w/:slug/run`: WezTerm + Hermes oneshot em worktree git própria; `doing` automático, `result` gravado no card, polling no front.
- Fluxo Review `/api/w/:slug/review/{approve|reject}`: `done` manual (BMS) com `merge dev → main` no approve; reject volta a `doing`.