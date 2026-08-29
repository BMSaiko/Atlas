# ATLAS

> O titã que sustenta os céus. Cada projeto é um **mundo** que Atlas carrega nos ombros — notas, kanban e relógio próprios, virados para cima para nunca se misturarem.

Num Atlas, não trabalhas em pastas: atravessas **mundos**. Cada **mundo** é um workspace isolado (quicknotes + kanban próprios, com icon, fuso horário e tema à sua medida). Entrar num mundo é trocar de contexto de vez — nunca se mistura o que não deve, e `Alt+↑/↓` deixa-te viajar entre mundos num sopro.

## Características

- **Dashboard hub (`/`)** — visão geral de todos os mundos com stat-grid, pipeline em stepper e anéis de conclusão por projeto.
- **Icons por mundo** — catálogo de 60 orbs SVG; cada mundo com a sua identidade na sidebar e no dashboard.
- **Tags nas notas** — adiciona, pesquisa e filtra por chips.
- **Seletor de fuso horário** — relógio da sidebar em ~13 zonas comuns via `Intl`.
- **Tema auto/manual** — dia ↔ entardecer ↔ noite (day/dusk/night) seguem as horas, ou fixas manualmente.
- **Sessões de foco** — overlay imersivo com cronómetro + pomodoro (fases focus/pausa).
- **Notificações de review** — avisos globais quando um card está pronto a revisar.
- **Import roadmap** — um `.md` vira um card por tarefa + nota de detalhe, idempotente.
- **Live-data + CI** — dados versionados com auto-backup na vault e GitHub Actions (typecheck + build).
- **Review como coluna default** + cards em 2 tamanhos, `Alt+↑/↓` entre mundos.

## Stack

- **Vite + TypeScript** (vanilla, zero framework de UI pesado) — SPA com shell/sidebar + painel
- Persistência local em **ficheiros JSON** por mundo (`data/<slug>/{meta,notes,kanban}.json`), servida por uma **mini-API embutida** no Vite dev/preview
- **Drag & Drop nativo** (HTML5), zero libs de runtime
- Task-runner: cada card kanban pode disparar uma **tarefa autónoma** (WezTerm + Hermes oneshot), com branch git própria por card

## Correr

```bash
npm install
npm run dev      # http://localhost:5173 (dev server + API)
npm run build    # build de produção -> dist/
npm run preview  # serve o build + API (persistência funciona igual)
```

> O CI (GitHub Actions) corre `npm run typecheck` (`tsc --noEmit`) + `build` em `dev`/`main`.

## Estrutura

```
data/                 # persistência (versionada no git) — fronteira dura por slug (mundo)
  index.json          #   lista de mundos (workdirs)
  <slug>/{meta,notes,kanban}.json
live-data/            # junction para a vault — datas locais fora do repo, auto-backup
server/
  api.ts              # mini-API embutida (rotas /api) + task-runner de cards
  roadmap.ts          # parser de roadmap markdown -> kanban (import)
src/
  main.ts             # entrada; importa tokens/base/components + watcher de notifs
  router.ts           # `/` e `/w/:slug(/settings)`; renderShell sempre
  store.ts, api.ts    # state partilhado e cliente HTTP da API
  ui/                 # icons, modal, toast, confirm, clock, text, theme, notifs, pomodoro, timezones
  views/              # shell, workspace, dashboard, notes, kanban, settings
  styles/             # tokens.css (cosmos/noite), base.css, components.css
public/icons/         # 60 orbs SVG (catálogo de icons por mundo)
```

## Rotas frontend

- `/` — **main dashboard**: visão geral de todos os mundos (projetos, notas, pipeline, sessões ativas)
- `/w/:slug` — workspace (tabs **Notas | Kanban**)
- `/w/:slug/settings` — editar mundo, tema, colunas, icon, notificações, eliminar

## API

Endpoints embutidos no Vite (prefixo `/api`):

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | `/api/workdirs` | listar / criar mundo (`{name, description?}`) |
| PUT | `/api/workdirs` | reordenar (bloco de todos) — `{order: [slug...]}` |
| PATCH/DELETE | `/api/workdirs/:slug` | editar (nome/descrição/icon) / apagar mundo |
| GET | `/api/icons` | catálogo de icons disponíveis (órbitas SVG) |
| GET/PUT | `/api/w/:slug/{notes,kanban,meta}` | ler / gravar dados do mundo |
| GET | `/api/w/:slug` | lê `meta.json` do mundo |
| POST | `/api/w/:slug/run` | **corre card kanban** — marca `doing`, abre WezTerm+Hermes (tarefa = `description`) |
| POST | `/api/w/:slug/import-roadmap` | importa um roadmap `.md` → notas + cards (idempotente) |
| POST | `/api/w/:slug/review/approve` | Card em `review` → `done` + **`merge dev → main`** |
| POST | `/api/w/:slug/review/reject` | Card → `doing` (refinamento) + re-corre a tarefa |

> `card.result` (resumo do que o worker fez) é gravado pelo worker no `kanban.json` e renderizado no card.

## Workflow kanban (task-runner)

1. **Run** (`▶` no card) → card vai a **Em Curso** e abre uma janela WezTerm a correr Hermes autónomo numa **worktree isolada** da branch `dev` (`feature/<card-slug>`).
2. O worker faz commit localmente, e no fim move o card para **Review** (coluna `review`) com um campo `result`.
3. **`status`:** a view faz polling do board enquanto houver card em `doing`; o `result` é renderizado com destaque assim que aparece.
4. **Review (só BMS):** `approve` → mergem `dev → main` e card para **done**; `reject` → volta a `doing` com nota de refinamento e re-corre. **`done` é sempre manual** (validação BMS), nunca automático.

### Task-runner interno (`server/api.ts::launchHermes`)

- Cria **uma worktree por card**: `git worktree add -B feature/<slug>-<cardId> <code>/data/.wt/<slug>/<cardId> dev`.
- `cwd` do spawn = a worktree do card (nunca o repo raiz).
- Spawn não-bloqueante: `WEZTERM start -- <python> -m hermes_cli.main -z "<prompt>"` com `{detached:true, stdio:'ignore'}` e `p.unref()`.
- Qualquer falha escreve `card.result` (ex. `ERRO: …`) — **nunca** return silencioso.
- No fim do card (rc==0): merge branch→dev + push dev, remove a junction node_modules, `worktree remove --force`, apaga a branch → auto-cleanup; panes WezTerm que seguram a worktree são mortas (`killWtLockers`).

### Variáveis de ambiente do server

| Var | Default | Uso |
|-----|---------|-----|
| `WEZTERM` | `...WezTerm\wezterm-gui.exe` | CLI usado pelo wrapper de autoclose da pane |
| `WEZTERM_CLI` | `...WezTerm\wezterm.exe` | CLI usado para `cli kill-pane` / `cli set-tab-title` |
| `GIT_BIN` | `C:\Program Files\Git\bin\git.exe` | git usado no run/merge |
| `HERMES_PY` | `.venv\Scripts\python.exe` | Python do Hermes oneshot |
| `HERMES_HOME` | `AppData\Local\hermes` | home do Hermes |
| `ATLAS_REPO` | repo do Atlas | `cwd` dos spawns + worktrees |

> As rotas novas devem registar-se **acima** do bloco genérico `/api/w/:slug/{notes|kanban|meta}` (o handler genérico rejeita com 400 `bad request` se colidir com o padrão).

## Dados

`data/` é versionado no git — **backup = clone do repo**. `data/.wt/` (worktrees) nunca é commitado. `live-data/` (junction à vault) guarda cópia dos dados com auto-backup.

## Design

- Cosmos azul-noite → quase-preto; accents gold/mármore
- Auto-shift dia (blue/sky) ↔ entardecer (cobre/âmbar) ↔ noite (gold); paletas AA-safe
- Modo automático segue a hora (07h dia, 17h entardecer, 20h noite); manual fixo — escolher nas Definições; indicador clicável na sidebar
- icon próprio por mundo; relógio global com fuso horário selecionável; foco overlay (cronómetro + pomodoro)
- Acessível: contrastes AA, `prefers-reduced-motion`, focos visíveis
