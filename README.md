# ATLAS

> O titã que sustenta os céus — hub pessoal de produtividade com **workdirs isolados** (quicknotes + kanban por projecto).

Cada projecto é um **workdir** independente: ao entrar vês apenas as quicknotes e o kanban desse workdir. Trocar de workdir = trocar de contexto, nunca misturar.

## Stack

- **Vite + TypeScript** (vanilla, zero framework de UI pesado) — SPA com shell/sidebar + painel
- Persistência local em **ficheiros JSON** por workdir (`data/<slug>/{meta,notes,kanban}.json`), servida por uma **mini-API embutida** no Vite dev/preview
- **Drag & Drop nativo** (HTML5), zero libs de runtime
- Task-runner: cada card kanban pode disparar uma **tarefa autónoma** (WezTerm + Hermes oneshot), com branch git própria por card

## Correr

```bash
npm install
npm run dev      # http://localhost:5173 (dev server + API)
npm run build    # build de produção -> dist/
npm run preview  # serve o build + API (persistência funciona igual)
```

## Estrutura

```
data/                 # persistência (versionada no git) — fronteira dura por slug
  index.json          #   lista de workdirs
  <slug>/{meta,notes,kanban}.json
server/
  api.ts              # mini-API embutida (rotas /api) + task-runner de cards
src/
  main.ts             # entrada; importa tokens/base/components
  router.ts           # `/` e `/w/:slug(/settings)`; renderShell sempre
  store.ts, api.ts    # state partilhado e cliente HTTP da API
  ui/                 # icons, modal, toast, confirm, clock, text
  views/              # shell, workspace, notes, kanban, settings
  styles/             # tokens.css (cosmos/noite), base.css, components.css
data/.wt/             # worktrees git isoladas por card em execução (NUNCA commitar)
```

## Rotas frontend

- `/` — hub: cards dos workdirs + contagens + criar
- `/w/:slug` — workspace (tabs **Notas | Kanban**)
- `/w/:slug/settings` — editar trabalho, colunas, eliminar

## API

Endpoints embutidos no Vite dev/preview (prefixo `/api`):

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | `/api/workdirs` | listar / criar workdir (`{name, description?}`) |
| PATCH/DELETE | `/api/workdirs/:slug` | editar / apagar trabalho |
| GET/PUT | `/api/w/:slug/{notes,kanban,meta}` | ler / gravar dados do workdir |
| GET | `/api/w/:slug` | lê `meta.json` do workdir |
| POST | `/api/w/:slug/run` | **corre card kanban** — marca `doing`, abre WezTerm+Hermes (tarefa = `description`) |
| POST | `/api/w/:slug/review/approve` | Card em `review` → `done` + **`merge dev → main`** |
| POST | `/api/w/:slug/review/reject` | Card → `doing` (refinamento) + re-corre a tarefa |

> `card.result` (resumo do que o worker fez) é gravado pelo worker no `kanban.json` e renderizado no card.

## Workflow kanban (task-runner)

1. **Run** (`▶` no card) → card vai a **Em Curso** e abre uma janela WezTerm a correr Hermes autónomo numa **worktree isolada** da branch `dev` (`feature/<card-slug>`).
2. O worker commita localmente, e no fim move o card para **Review** (coluna `review`) com um campo `result`.
3. **`status`:** a view faz polling do board enquanto houver card em `doing`; o `result` é renderizado com destaque assim que aparece.
4. **Review (só BMS):** `approve` → mergem `dev → main` e card para **done**; `reject` → volta a `doing` com nota de refinamento e re-corre. **`done` é sempre manual** (validação BMS), nunca automático.

### Task-runner interno (as titular)

`server/api.ts::launchHermes`:
- Cria **uma worktree por card**: `git worktree add -B feature/<slug>-<cardId> <code>/data/.wt/<slug>/<cardId> dev`.
- `cwd` do spawn = a worktree do card (nunca o repo raiz).
- Spawn não-bloqueante: `WEZTERM start -- <python> -m hermes_cli.main -z "<prompt>"` com `{detached:true, stdio:'ignore'}` e `p.unref()`.
- Qualquer falha escreve `card.result` (ex. `ERRO: …`) — **nunca** `return` silencioso.

### Variáveis de ambiente do server

| Var | Default | Uso |
|-----|---------|-----|
| `WEZTERM` | `...\WezTerm\wezterm.exe` | CLI usado pelo wrapper de autoclose da pane |
| `VENV_PY` | `.venv\Scripts\python.exe` | Python do Hermes oneshot |
| `HERMES_HOME` | `AppData\Local\hermes` | home do Hermes |
| `ATLAS_REPO` | repo do Atlas | `cwd` dos spawns + worktrees |

> As rotas novas devem ser registadas **acima** do bloco genérico `/api/w/:slug/{notes|kanban|meta}` (o handler genérico rejeita com 400 `bad request` se colidir com o padrão).

## Dados

`data/` é versionado no git — **backup = clone do repo**. `data/.wt/` (worktrees) nunca é commitado.

## Design

- Cosmos azul-noite → quase-preto; accents gold/mármore
- Auto-shift dia (blue/sky) ↔ entardecer/noite (gold/crepúsculo) por hora
- Workdir activo em cor-cheia; restantes desaturados
- Prioridade kanban = só cor semântica (gold/âmbar/vermelho-aurora)
- acessível: contrastes AA, `prefers-reduced-motion`, focos visíveis
