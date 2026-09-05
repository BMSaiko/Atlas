# ATLAS

> O titã que sustenta os céus. Cada projeto é um **mundo** que Atlas carrega nos ombros — notas e relógio próprios, virados para cima para nunca se misturarem.

Num Atlas, não trabalhas em pastas: atravessas **mundos**. Cada **mundo** é um workspace isolado (quicknotes próprios, com icon, fuso horário, tema e estação à sua medida). Entrar num mundo é trocar de contexto de vez — nunca se mistura o que não deve, e `Alt+↑/↓` deixa-te viajar entre mundos num sopro. O **`Ctrl+K`** abre uma command palette para saltar de mundo em mundo, abrir notas/cartões e disparar ações sem largar o teclado; o **leader `;`** (`;N` nota, `;C` cartão, `;M` chat, `;D` dashboard, `;S` settings, `;T` tema, `;F` fuso, `;?` overlay) dá-te tudo a uma tecla do mindinho esquerdo.

Atlas é **keyboard-first**: o registry único em `src/lib/commands.ts` é a source of truth, a palette renderiza a partir dele, todos os `<button>` do app têm `data-cmd` auditado em teste — largar o rato não é opcional.

## Características

- **Dashboard hub (`/`)** — visão geral de todos os mundos com stat-grid, pipeline em stepper e anéis de conclusão por projeto, incluindo sessões/terminais ativos.
- **Icons por mundo** — catálogo de 60 orbs SVG; cada mundo com a sua identidade na sidebar e no dashboard.
- **Tags nas notas** — adiciona, pesquisa e filtra por chips.
- **Checklists nas notas** — `- [ ]` / `- [x]` editáveis com toggle (clique no checkbox) e persistência na nota.
- **Seletor de fuso horário** — relógio da sidebar em ~13 zonas comuns via `Intl`.
- **Tema auto/manual** — dia ↔ entardecer ↔ noite (day/dusk/night) seguem as horas, ou fixas manualmente (botão: esquerdo = manual, direito = auto).
- **Época do ano (estação)** — dimensão paralela ao shift: Inverno (Out–Dez), Primavera (Jan–Mar), Verão (Abr–Jun), Outono (Jul–Set); automática pelo mês ou manual. Botão de estação na sidebar (esquerdo cicla, direito volta a auto).
- **Command palette (`Ctrl+K`)** — atalhos por teclado para mundos, notas e ações (novo mundo, novas notas), com modais completos delegados.
- **Templates** — cria notas a partir de templates (globais + por mundo); no modal Refinar, o template aplica-se à nota de revisão.
- **Brainstorm** — botão por mundo: gera brainstorm + SWOT do projeto e escreve notas novas (headless, sem tocar no código).
- **Gerar DP** — para o chat cross-mundo (`/c`): corre o ciclo de Super Prompt (DP + DA) em segundo plano; resultado streamado no log e notificado ao concluir.
- **Sessões de foco** — overlay imersivo com cronómetro + pomodoro (fases focus/pausa).
- **Prazos (deadlines)** — `due date` por card com badge; cor progressiva por proximidade: a <48h fica laranja, ultrapassado vermelho (done nunca alarme).
- **Prioridades** — urgente/alta/média/baixa com sort e deteção de overdue.
- **Bulk actions** — modo seleção de múltiplos cartões (inclui selecionar a coluna inteira com toggle) e barra bulk: mover coluna, mudar prioridade, arquivar, eliminar.
- **Visualização da tarefa em execução** — no chat cross-mundo (`/c`), o painel de execução mostra o log do worker ao vivo com estado `a executar / concluído`; botões com animação `running`. o card está em `doing`, e pára via MutationObserver em column change.
- **Super Prompt lifecycle (no chat cross-mundo)** — o chat `/c` pode disparar o ciclo SP → DP → DA via `runHermesHeadless` (headless, log streamado). Prompt interpolado a partir de `${userMsg}` + history + world metadata.m.
- **Calendar cross-mundo (`/c/calendar`)** — month grid em React, navegação prev/next, eventos livres CRUD (`GET/PUT /api/w/:slug/events`, sem OT) e chips read-only para cards com `due`/`!archived`/`colId !== 'done'` (clique salta para o card). Entrada no `Ctrl+K` filtrável por "calend/agenda/eventos".
- **Main chat cross-mundo (`/c`) com multi-conversation** — composer + thread, stream do Hermes em tempo real, sidebar de conversas, agent com **Atlas parity** (lê/escreve `meta`/`notes` em qualquer mundo via API; token injetado no prompt). Slug sempre explícito no prompt. Cap 200 msgs/conversa (FIFO).
- **Data de criação na nota** — visível no header da nota (`title="Criado em …"`).
- **Eventos recorrentes + lembretes** — `recur` (diária/semanal/mensal) com badge `↻`; eventos `due` em ≤30min disparam notificação/toast (dedup por `slug:id`); próximo ciclo materializa-se sozinho.
- **Dashboards de operação do Hermes** — API keys (`/api/hermes/keys`, com `access_token` censurado e `secret_fingerprint` sha256) e Usage (`/api/hermes/usage`, hoje/tokens/custo) em ambas as dashboards.
- **Backup/Export/Import de workdir** — Definições → Backup: exportar notas+meta como JSON, ou importar (replace destrutivo); útil para migrar mundos entre máquinas. Bundles antigos com campo `kanban` opcional (compat). preservado (compat).
- **Cobertura de testes do backend + front** — testes `node --test` puros (vanilla `node:assert`, ~13s) cobrem as routes de `server/api.ts` (token fence, wtoken loopback, bundle roundtrip, hermes keys redaction, hermes usage, workdirs, run-finish close handler, chat history cap, chat routes, sp-persistence/refine/kill-transition/runs-pid, commands registry + palette dom audit, etc.) **+ fluxo end-to-end** (`POST /run` → Node run-card module → git worktree → `p.on('close')` doing→review, com fixtures `test/fixtures/hermes_cli/`). Os 2 integration tests lentos (`run-integration`, `syncvault-debounce`) vivem em `npm run test:integration` separado. Harnesses partilhados: `test/_atlas-runtime.mjs` (Vite `middlewareMode` + seam `ATLAS_TEST_*`) e `test/_atlas-harness.mjs` (integration real); ambos zero risco prod. Default `npm test` passa 117/117 em ~13s; `npm run test:integration` adiciona +2.

- **Notificações de review** — avisos globais para revisão de notas.
- **Import roadmap** — um `.md` vira uma nota por tarefa, idempotente.
- **Export notas** — exporta notas não-arquivadas para markdown na vault (`docs/notas.md`).
- **Git headless por mundo** — cada mundo pode apontar para o seu repo (path) e correr merge `dev → main` ou resolver conflito, tudo em segundo plano.
- **Live-data + CI** — dados versionados com auto-backup na vault e GitHub Actions (typecheck + build).
- **Review por tag** + `Alt+↑/↓` entre mundos.
- **Write-token anti-corrida** — `PUT` em `notes|bundle|events` exige header `X-Atlas-Token`; apenas loopback (`127.0.0.1`/`::1`) ou requests do `localhost`. Token impresso no boot do server, configurável via `.env` (`ATLAS_WTOKEN`) ou `npm run dev:token`.
- **Dashboard defloat + Meteorologia** — dashboard hub em modo funcional (anéis só em vistas por mundo) + widget meteorologia (Open-Meteo) com emoji/cache 10 min.
- **Keybinds** — `Alt+←/→` cicla tabs do workspace, `Ctrl/Cmd+Enter` submete forms em modais, `Esc`/clique-fora fecha overlays.

## Stack

- **Vite 6.4 + TypeScript 5.6** — dev server, build, plugin `atlasApi()` que serve a API em `/api`
- **React 18.3 + react-router-dom 6.30** — routes frozen: `/`, `/w/:slug`, `/w/:slug/settings`, `/c`, `/c/calendar`. Views vanilla (`*-vanilla.ts`) preservadas intactas; cada view expõe um thin React wrapper que renderiza o DOM vanilla via `NavBridge` (capture `useNavigate()` em `globalThis` para `navigate('/...')` imperativo das views).
- **Tailwind CSS 4.3** via `@tailwindcss/vite` — `src/index.css` `@theme` block declara cosmos/gold/marble/pipe como `--color-*` (`bg-bg-0`, `text-gold`). `components.css` ainda carregado para classes vanilla até Epic A polish sweep.
- **shadcn/ui** — 17 componentes em `src/components/ui/` (alert, avatar, badge, button, card, command, dialog, dropdown-menu, input, label, popover, progress, scroll-area, separator, sheet, skeleton, tabs, textarea, tooltip) sobre `@radix-ui/*` + `cmdk` + `lucide-react` + `next-themes` + `sonner` + `class-variance-authority` + `tailwind-merge` + `tailwindcss-animate`.
- **Persistência local** em **ficheiros JSON** por mundo (`data/<slug>/{meta,notes,kanban}.json` — `kanban.json` preservado para restore-compat), servida por uma **mini-API embutida** no Vite dev/preview (Node `server/api.ts` + `server/lib/chat.mjs`)
- **Drag & Drop nativo** (HTML5), zero libs de runtime para isso
- **Task-runner (chat cross-mundo)**: cada mensagem no `/c` pode disparar o ciclo SP → DP → DA via `runHermesHeadless` → `hermes_cli.main` (headless, log streamado em tempo real).

## Correr

```bash
npm install
npm run dev          # http://localhost:5173 (dev server + API)
npm run build        # build de produção -> dist/
npm run preview      # serve o build + API (persistência funciona igual)
npm test             # testes do backend + front (node --test vanilla, ~13s)
npm run test:integration  # +2 integration tests (run-integration, syncvault-debounce)
```

> O CI (GitHub Actions) corre `npm run typecheck` (`tsc --noEmit`) + `build` em `dev`/`main`.

## Estrutura

```
data/                 # persistência (versionada no git) — fronteira dura por slug (mundo)
  index.json          #   lista de mundos (workdirs)
  <slug>/{meta,notes,kanban}.json   # kanban.json preserved on disk (feature removed 2026-09-05)
  _chat/history.json  # multi-conversation chat history (cap 200 msgs/conversa)
live-data/            # junction para a vault — datas locais fora do repo, auto-backup
server/
  api.ts              # plugin Vite + mini-API embutida (rotas /api) + task-runner de cards
  config.ts           # cfg: port, wtoken, wezterm paths, etc.
  roadmap.ts          # parser de roadmap markdown -> notes (import)
  routes/             # chat, hermes, icons, terms, w-survivors, workdirs, index
  lib/                # chat.mjs, chat-runner.mjs (Node helpers)
  prompts/            # chat (other prompts were kanban-specific and removed)
src/
  main.tsx            # entry React (createRoot) — substituiu main.ts na migração epic-D
  App.tsx             # router root + NavBridge (capture useNavigate)
  router.tsx          # rotas (/, /w/:slug, /w/:slug/settings, /c, /c/calendar)
  api.ts              # cliente HTTP partilhado (Card interface, j<T>, helpers)
  store.ts            # state global
  lib/
    commands.ts       # registry único (56 commands × 6 grupos) — keyboard-first source of truth
    utils.ts          # cn() helper (clsx + tailwind-merge)
  ui/                 # icons, palette, modal, toast, confirm, clock, text, theme (shift+estação), notifs, pomodoro, timezones, icon.tsx
  views/              # shell, workspace, dashboard, notes, settings, main-chat, calendar
    *-vanilla.ts      # código vanilla preservado; *-tsx são React wrappers (NavBridge)
  components/
    ui/               # 17 componentes shadcn/ui (alert, avatar, badge, button, card, command, dialog, dropdown-menu, input, label, popover, progress, scroll-area, separator, sheet, skeleton, tabs, textarea, tooltip)
  styles/             # tokens.css (cosmos/noite), base.css, components.css (vanilla classes)
  index.css           # Tailwind v4 @theme block + @import components.css
public/icons/         # 60 orbs SVG (catálogo de icons por mundo)
test/                 # ~45 ficheiros *.test.mjs (node --test vanilla) — 117 asserts em ~13s
  _atlas-runtime.mjs  # harness Vite middlewareMode + ATLAS_TEST_* seam
  _atlas-harness.mjs  # harness integration (POST /run → runCard → close handler)
  _register-loader.mjs, _ts-loader.mjs  # Node 22 ESM/strip-types plumbing
  fixtures/hermes_cli/  # fixtures para integration tests
plans/                # DPs por feature/epic (2026-08-28..2026-09-05)
```

## Rotas frontend

- `/` — **main dashboard**: visão geral de todos os mundos (projetos, notas, pipeline, sessões ativas)
- `/w/:slug` — workspace (tabs **Notas**)
- `/w/:slug/settings` — editar mundo, tema, estação, colunas, icon, repo, notificações, eliminar
- `/c` — **main chat cross-mundo**: composer + thread, multi-conversation sidebar, agent com Atlas parity (lê/escreve qualquer mundo via API; token injetado no prompt; slug sempre explícito no user prompt)
- `/c/calendar` — **calendário cross-mundo**: month grid + eventos livres CRUD

## Palette (`Ctrl+K`) & keyboard-first

Command palette keyboard-first, **renderizada a partir do registry único `src/lib/commands.ts`**. Secções: **Workdirs**, **Notas**, **Cartões**, **Global** (inclui **Chat** cross-mundo, **Calendário**, FAQ, How to use) e **Ações** (ex. *Novo mundo*). Introduzir texto filtra; `Enter` executa. Criar por aqui delega nos modais completos de criar (nota/cartão), para não duplicar lógica.

**Leader `;` + 1 letra** (mindinho esq descansa em `;`, zero conflito com filtro PT-PT):

| Shortcut | Comando |
|---|---|
| `;N` | Nova nota |
| `;C` | Novo cartão |
| `;T` | Tema (cicla day/dusk/night) |
| `;D` | Dashboard |
| `;S` | Settings |
| `;M` | Main chat |
| `;F` | Fuso horário |
| `;?` | Overlay de atalhos |

Bare shortcut `?` (símbolo) → overlay. **PT-PT-safe**: match primário por `e.code === 'Semicolon'` (layout-independent), fallback `e.key === ';'` e `e.key === ':'` — o handler funciona em todos os layouts.

Recentes via MRU (`atlas.recentCommands`, max 10). Todos os 81 `<button>` do app têm `data-cmd` auditado em `test/palette-dom-audit.test.mjs`.

## API

Endpoints embutidos no Vite (prefixo `/api`):

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | `/api/workdirs` | listar / criar mundo (`{name, description?, repo?}`) |
| PUT | `/api/workdirs` | reordenar (bloco de todos) — `{order: [slug...]}` |
| PATCH/DELETE | `/api/workdirs/:slug` | editar (nome/descrição/icon/repo) / apagar mundo |
| GET | `/api/icons` | catálogo de icons disponíveis (órbitas SVG) |
| POST | `/api/orchestrator/start[/slug]` | passa TODO(s) não arquivados (de um mundo, se slug) para `doing` |
| GET/PUT | `/api/w/:slug/{notes,meta}` | ler / gravar dados do mundo (com optimistic concurrency via `ver`) |
| GET | `/api/w/:slug/templates` | templates (globais + do mundo) p/ criar notas/cartões |
| GET | `/api/w/:slug` | lê `meta.json` do mundo |
| POST | (removed) | (former card-runner route — feature removed 2026-09-05) |
| POST | `/api/w/:slug/brainstorm` | **brainstorm + SWOT** do mundo — escreve notas novas (headless) |
| POST | `/api/w/:slug/dp` | **gera/reescreve o DP** de um card (headless, não toca no código) |
| — | (removed) | (former `/api/w/:slug/kanban/{sp,refine}` routes — feature removed 2026-09-05) |
| GET | `/api/w/:slug/runs/:cardId/pid` | devolve `String(child.pid)` do worker (escrito por `runCard` no PID file) |
| GET/PUT | `/api/w/:slug/events` | CRUD de eventos livres do calendar (`title + date + colour + note`); flat array, sem OT |
| POST | `/api/chat/message` | envia mensagem ao agent (`/c` main chat); stream em `/api/chat/stream/:runId`; agent com Atlas parity via token injetado |
| GET | `/api/chat/conversations` | lista conversas do main chat (multi-conversation schema em `data/_chat/history.json`) |
| POST | `/api/chat/conversations` | cria nova conversa; DELETE/GET by id disponíveis |
| GET | `/api/w/:slug/output/:cardId` | stream do log do run/DP (offset-based, p/ a vista de execução) |
| POST | `/api/w/:slug/cleanup` | limpeza manual de runs/worktrees órfãs |
| POST | `/api/w/:slug/import-roadmap` | importa um roadmap `.md` → notas + cards (idempotente) |
| POST | `/api/w/:slug/export` | exporta notas não-arquivadas → markdown na vault (`docs/notas.md`) |
| POST | `/api/w/:slug/git/merge-main` | merge `dev → main` + push (headless, repo do mundo) |
| POST | `/api/w/:slug/git/resolve` | resolve conflito de merge em `dev` (headless, repo do mundo) |
| — | (removed) | (former `/api/w/:slug/review/*` routes — kanban feature removed 2026-09-05) |
| GET/PUT | `/api/w/:slug/bundle` | backup/restore do workdir inteiro (`meta+notes+kanban?`); PUT não valida `ver` (replace destrutivo) |
| GET | `/api/hermes/keys` | lista API keys do Hermes (censurado: `secret_fingerprint`, **sem** `access_token`) |
| GET | `/api/hermes/usage` | agrega `usage.jsonl` por `key_id` (`since=` ISO opcional; default = início do dia local) |
| GET | `/api/atlas/logs` | tail/stream dos logs do atlas (filtro por level, últimos N) |
| PUT | `/api/w/:slug/{notes,bundle,events}` | exige header `X-Atlas-Token`; recusado fora de loopback |

### Write token (anti-corrida)

`PUT /api/w/:slug/{notes,bundle,events}` exige o header `X-Atlas-Token` igual a `cfg.wtoken`. O server imprime o token no boot (`[atlas] write token: <hex>`); o cliente recolhe-o via `?token=<hex>` no URL (fica em `localStorage` para reloads). Para setups persistentes, fixa `ATLAS_WTOKEN` no `.env` (`npm run dev:token` gera um hex novo). GETs nunca são gated.

Apenas requests de **loopback** (`127.0.0.1`/`localhost`/`::1`) ou do header `Host: localhost` são aceites; em containers/WSL com IP interno não-loopback a verificação recorre ao `x-forwarded-for` apenas quando o request já vem de loopback. Inspeção sem `WezTerm`: `GET /api/atlas/logs`.

> `kanban.json` é preservado no disco (restore-compat) mas a UI já não o mostra. As rotas novas devem registar-se **acima** do bloco genérico `/api/w/:slug/{notes|meta}` (catch-all `w:notes-events-bundle`).

## Chat cross-mundo (`/c` workflow)

> (Section rewritten 2026-09-05 — kanban feature removed; chat cross-mundo still uses `runHermesHeadless` para SP → DP → DA, sem worktree isolada nem auto-merge.)

1. **Mensagem do user** → composer no `/c` faz spawn de `runHermesHeadless` (em `server/lib/chat-runner.mjs`) com prompt interpolado (`${userMsg}` + history + world metadata + atlas token).
2. **Stream ao vivo** — o worker escreve em `${runsDir}/<conversation>.log`; o cliente faz fetch offset-based e renderiza em tempo real (linha-a-linha ou batched).
3. **Status** — `.status` JSON em `${runsDir}/<conversation>.status` regista `state: 'running' | 'done' | 'cancelled'` + `code: N` + `ts`. UI mostra um chip `agent: running (pid NNNN)` durante `running`.
4. **Stop** — STOP pelo user escreve `state: 'cancelled'` no `.status` + mata o child PID via `killWorkerForCard` (narrow `taskkill /F /PID <pid>`).
5. **Done** — em `rc==0` o resultado fica na última linha do log (Markdown-friendly); em `rc!=0` o estado fica `done` com `code: 1`.

### Chat runner interno (`server/lib/chat-runner.mjs` + `server/lib/chat.mjs`)

- **Node module único** (`server/lib/chat-runner.mjs`) substitui o antigo `run-card.mjs` (removido com o kanban 2026-09-05) — única variante que resta: `runHermesHeadless({exe, args, env, logWs})`.
- **Sem worktree** — o chat cross-mundo corre no repo raiz (ou onde o user quiser via `cwd` override), sem `auto-merge.mjs`.
- **Stream offset-based** — logs escritos em `${runsDir}/<conversation>.log`; o cliente faz GET para ler do offset atual.
- `.status` JSON em `${runsDir}/<conversation>.status` regista `state: 'running' | 'done' | 'cancelled'` + `code: N` + `ts`.
- `killWorkerForCard` (em `server/api.ts`) — narrow `taskkill /F /PID <pid>` (NÃO mata `node.exe` em massa); usado pelo STOP do user.
- Spawn não-bloqueante: `python -m hermes_cli.main -z "<prompt>"` com stdout/stderr piped para logWs (não detached — o cliente acompanha).
- Qualquer falha (rc != 0 ou excepção) regista `code: 1` + `state: 'done'` no `.status` — **nunca** return silencioso.
- Cancelamento limpo: STOP do user ou timeout escreve `state: 'cancelled'` antes de matar o PID (UI mostra "interrompido pelo utilizador").
- **Sem CI gate inline** — chat cross-mundo não dispara build; CI roda no GitHub Actions em push (ver secção CI).

### Variáveis de ambiente do server

| Var | Default | Uso |
|-----|---------|-----|
| `WEZTERM` | `...WezTerm\wezterm-gui.exe` | CLI usado pelo wrapper de autoclose da pane |
| `WEZTERM_CLI` | `...WezTerm\wezterm.exe` | CLI usado para `cli kill-pane` / `cli set-tab-title` |
| `GIT_BIN` | `C:\Program Files\Git\bin\git.exe` | git usado no run/merge |
| `HERMES_PY` | `.venv\Scripts\python.exe` | Python do Hermes oneshot |
| `HERMES_HOME` | `AppData\Local\hermes` | home do Hermes |
| `ATLAS_REPO` | repo do Atlas | `cwd` dos spawns + worktrees |

## Dados

`data/` é versionado no git — **backup = clone do repo**. `data/.wt/` (worktrees) nunca é commitado. `live-data/` (junction à vault) guarda cópia dos dados com auto-backup. Cada mundo pode ter `repo` (path absoluto do repositório) usado pelas ações git headless.

## Design

- Cosmos azul-noite → quase-preto; accents gold/mármore
- **Duas dimensões de tema**: *shift* dia (blue/sky) ↔ entardecer (cobre/âmbar) ↔ noite (gold), e *época do ano* Inverno→Primavera→Verão→Outono; cada uma com modo auto (hora/mês) ou manual. Paletas AA-safe.
- Automático: shift às 07h dia, 17h entardecer, 20h noite; estação pelo mês (Out–Dez Inverno, Jan–Mar Primavera, Abr–Jun Verão, Jul–Set Outono). Botões na sidebar: esquerdo = manual, direito = auto.
- icon próprio por mundo; relógio global com fuso horário selecionável; foco overlay (cronómetro + pomodoro)
- Acessível: contrastes AA, `prefers-reduced-motion`, focos visíveis

