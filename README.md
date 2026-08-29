# ATLAS

> O titã que sustenta os céus. Cada projeto é um **mundo** que Atlas carrega nos ombros — notas, kanban e relógio próprios, virados para cima para nunca se misturarem.

Num Atlas, não trabalhas em pastas: atravessas **mundos**. Cada **mundo** é um workspace isolado (quicknotes + kanban próprios, com icon, fuso horário, tema e estação à sua medida). Entrar num mundo é trocar de contexto de vez — nunca se mistura o que não deve, e `Alt+↑/↓` deixa-te viajar entre mundos num sopro. O **`Ctrl+K`** abre uma command palette para saltar de mundo em mundo, abrir notas/cartões e disparar ações sem largar o teclado.

## Características

- **Dashboard hub (`/`)** — visão geral de todos os mundos com stat-grid, pipeline em stepper e anéis de conclusão por projeto, incluindo sessões/terminais ativos.
- **Icons por mundo** — catálogo de 60 orbs SVG; cada mundo com a sua identidade na sidebar e no dashboard.
- **Tags nas notas** — adiciona, pesquisa e filtra por chips.
- **Seletor de fuso horário** — relógio da sidebar em ~13 zonas comuns via `Intl`.
- **Tema auto/manual** — dia ↔ entardecer ↔ noite (day/dusk/night) seguem as horas, ou fixas manualmente (botão: esquerdo = manual, direito = auto).
- **Época do ano (estação)** — dimensão paralela ao shift: Inverno (Out–Dez), Primavera (Jan–Mar), Verão (Abr–Jun), Outono (Jul–Set); automática pelo mês ou manual. Botão de estação na sidebar (esquerdo cicla, direito volta a auto).
- **Command palette (`Ctrl+K`)** — atalhos por teclado para mundos, notas, cartões e ações (novo mundo, novas notas/cartões), com modais completos delegados.
- **Templates** — cria notas e cartões a partir de templates (globais + por mundo); no modal Refinar, o template aplica-se à nota de revisão.
- **Brainstorm** — botão por mundo: gera brainstorm + SWOT do projeto e escreve notas novas (headless, sem tocar no código).
- **Gerar DP** — botão por card: gera/reescreve o Design Plan (DP) do card em segundo plano (headless); resultado streamado no modal e notificado ao concluir.
- **Sessões de foco** — overlay imersivo com cronómetro + pomodoro (fases focus/pausa).
- **Prazos (deadlines)** — `due date` por card com badge; cor progressiva por proximidade: a <48h fica laranja, ultrapassado vermelho (done nunca alarme).
- **Prioridades** — urgente/alta/média/baixa com sort e deteção de overdue.
- **Bulk actions** — modo seleção de múltiplos cartões (inclui selecionar a coluna inteira com toggle) e barra bulk: mover coluna, mudar prioridade, arquivar, eliminar.
- **Visualização da tarefa em execução** — ao correr um card, um modal mostra o log do worker ao vivo (stream offset-based) com estado `a executar / concluído`; botões Brainstorm/DP com animação `running`.
- **Notificações de review** — avisos globais quando um card está pronto a rever.
- **Import roadmap** — um `.md` vira um card por tarefa + nota de detalhe, idempotente.
- **Export notas** — exporta notas não-arquivadas para markdown na vault (`docs/notas.md`).
- **Git headless por mundo** — cada mundo pode apontar para o seu repo (path) e correr merge `dev → main` ou resolver conflito, tudo em segundo plano.
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
  ui/                 # icons, palette, modal, toast, confirm, clock, text, theme (shift+estação), notifs, pomodoro, timezones
  views/              # shell, workspace, dashboard, notes, kanban, settings
  styles/             # tokens.css (cosmos/noite), base.css, components.css
public/icons/         # 60 orbs SVG (catálogo de icons por mundo)
```

## Rotas frontend

- `/` — **main dashboard**: visão geral de todos os mundos (projetos, notas, pipeline, sessões ativas)
- `/w/:slug` — workspace (tabs **Notas | Kanban**)
- `/w/:slug/settings` — editar mundo, tema, estação, colunas, icon, repo, notificações, eliminar

## Palette (`Ctrl+K`)

Command palette keyboard-first com secções **Workdirs**, **Notas**, **Cartões** e **Ações** (ex. *Novo mundo*). Introduzir texto filtra; `Enter` executa. Criar por aqui delega nos modais completos de criar (nota/cartão), para não duplicar lógica.

## API

Endpoints embutidos no Vite (prefixo `/api`):

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | `/api/workdirs` | listar / criar mundo (`{name, description?, repo?}`) |
| PUT | `/api/workdirs` | reordenar (bloco de todos) — `{order: [slug...]}` |
| PATCH/DELETE | `/api/workdirs/:slug` | editar (nome/descrição/icon/repo) / apagar mundo |
| GET | `/api/icons` | catálogo de icons disponíveis (órbitas SVG) |
| POST | `/api/orchestrator/start[/slug]` | passa TODO(s) não arquivados (de um mundo, se slug) para `doing` |
| GET/PUT | `/api/w/:slug/{notes,kanban,meta}` | ler / gravar dados do mundo (com optimistic concurrency via `ver`) |
| GET | `/api/w/:slug/templates` | templates (globais + do mundo) p/ criar notas/cartões |
| GET | `/api/w/:slug` | lê `meta.json` do mundo |
| POST | `/api/w/:slug/run` | **corre card kanban** — marca `doing`, abre WezTerm+Hermes (tarefa = `description`) |
| POST | `/api/w/:slug/brainstorm` | **brainstorm + SWOT** do mundo — escreve notas novas (headless) |
| POST | `/api/w/:slug/dp` | **gera/reescreve o DP** de um card (headless, não toca no código) |
| GET | `/api/w/:slug/output/:cardId` | stream do log do run/DP (offset-based, p/ a vista de execução) |
| POST | `/api/w/:slug/cleanup` | limpeza manual de runs/worktrees órfãs |
| POST | `/api/w/:slug/import-roadmap` | importa um roadmap `.md` → notas + cards (idempotente) |
| POST | `/api/w/:slug/export` | exporta notas não-arquivadas → markdown na vault (`docs/notas.md`) |
| POST | `/api/w/:slug/git/merge-main` | merge `dev → main` + push (headless, repo do mundo) |
| POST | `/api/w/:slug/git/resolve` | resolve conflito de merge em `dev` (headless, repo do mundo) |
| POST | `/api/w/:slug/review/approve` | Card em `review` → `done` + **`merge dev → main`** (com CI gate) |
| POST | `/api/w/:slug/review/reject` | Card → `doing` (refinamento) + re-corre a tarefa |

> `card.result` (resumo do que o worker fez) é gravado pelo worker no `kanban.json` e renderizado no card. `card.dp` guarda o Design Plan gerado por `/dp`. As rotas novas devem registar-se **acima** do bloco genérico `/api/w/:slug/{notes|kanban|meta}`.

## Workflow kanban (task-runner)

1. **Run** (`▶` no card) → card vai a **Em Curso** e abre uma janela WezTerm a correr Hermes autónomo numa **worktree isolada** da branch `dev` (`feature/<card-slug>`).
2. O worker faz commit localmente, e no fim move o card para **Review** (coluna `review`) com um campo `result`.
3. **`status`:** a view faz polling do board enquanto houver card em `doing`; o `result` é renderizado com destaque assim que aparece. O botão **Gerar DP** corre `/dp` em segundo plano e notifica ao concluir.
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

## Dados

`data/` é versionado no git — **backup = clone do repo**. `data/.wt/` (worktrees) nunca é commitado. `live-data/` (junction à vault) guarda cópia dos dados com auto-backup. Cada mundo pode ter `repo` (path absoluto do repositório) usado pelas ações git headless.

## Design

- Cosmos azul-noite → quase-preto; accents gold/mármore
- **Duas dimensões de tema**: *shift* dia (blue/sky) ↔ entardecer (cobre/âmbar) ↔ noite (gold), e *época do ano* Inverno→Primavera→Verão→Outono; cada uma com modo auto (hora/mês) ou manual. Paletas AA-safe.
- Automático: shift às 07h dia, 17h entardecer, 20h noite; estação pelo mês (Out–Dez Inverno, Jan–Mar Primavera, Abr–Jun Verão, Jul–Set Outono). Botões na sidebar: esquerdo = manual, direito = auto.
- icon próprio por mundo; relógio global com fuso horário selecionável; foco overlay (cronómetro + pomodoro)
- Acessível: contrastes AA, `prefers-reduced-motion`, focos visíveis

