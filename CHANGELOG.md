# Changelog

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