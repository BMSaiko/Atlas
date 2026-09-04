# DR · Atlas "main chat" que gere todos os mundos

**Data:** 2026-09-04
**Ciclo:** michi v2.1 — fase DR (deep research antes do grill, conforme self-evolution 2026-09-03).
**Pergunta:** Como adicionar um "main chat" cross-mundo, integrado no app-shell do Atlas?

## O que EXISTE hoje (mapeado por DR)

- **App-shell** (`src/views/shell.ts`) — sidebar com mundos, painel central; `renderShell()` dispatch para `renderWorkspace` (mundo ativo) / `renderDashboard` (raiz `/`) / `renderEmpty`.
- **Router** (`src/router.ts`) — regex `^/w/([a-z0-9-]+)(/settings)?$` — só 2 caminhos: raiz e `/w/<slug>`. **Sem rota `/c` ou `/chat`.**
- **Dashboard** (`src/views/dashboard.ts`) — stat-grid, pipeline, secção "Projetos", secção "Sessões / terminais ativos", **glob-search cross-mundo** (input no header, filtro client-side de `rows` já carregados — sem fetch por tecla).
- **API client** (`src/api.ts`) — `j<T>()` com `wtoken` fence, helpers: `workdirs`, `notes.{get,put}`, `kanban.{get,put}`, `run.output`, `hermes.{keys,usage}`, `orchestrator.start`, `review.*`, `snapshots.*`. **Sem `chat.*` namespace.**
- **API server** (`server/routes/`) — 20 routes `w:*` (todas workdir-scoped: `w/<slug>/...`), `workdirs:*`, `hermes:*`, `icons:`, `orchestrator:*`, `terms:*`. **Zero routes cross-mundo.**
- **Streaming pattern já em uso** (`w:output` em `server/routes/w.ts`) — `GET /api/w/<slug>/output/<cardId>?offset=N` devolve `{started, done, code, chunk, offset, size}`. **Já testado em `test/output-stream.test.mjs`.** Poll = `setInterval(1000)` no frontend (vê `kanban.ts` — pattern `tick()`).
- **Headless run infra** (`launchBrainstorm` / `launchDp` / `launchHermes` em `server/api.ts`) — `runs/<slug>/<cardId>.log` + `<cardId>.status`. Log/status **workdir-scoped** em `<wtRoot(repo)>/runs/<slug>/`. Já há `cardId` fictício `"brainstorm"` partilhado por todos os mundos (mesmo mecanismo) — **prova de que o pattern aceita IDs não-card.**
- **Prompts** (`server/prompts/`) — `brainstorm.md`, `dp.md`, `run-card.md`, `merge-approve.md`, `git-op.md`. Templates markdown com `${interpolate(...)}` placeholders.
- **Hermes headless** — `runHermesHeadless({exe: VENV_PY, args: ['-m', 'hermes_cli.main', '-z', prompt], env: HERMES_HOME, logWs})`. Cada run = 1 sessão Hermes isolada com prompt full inline.
- **Workdir scoping** — `repoDir(slug)` resolve o repo; tudo é `per-slug`.

## Onde aterra a mudança

| Componente | O que entra | Porquê |
|---|---|---|
| `src/router.ts` | regex aceita `/c(/settings)?` | rota para o main chat |
| `src/views/shell.ts` | dispatch `renderMainChat(panel)` quando path `/c` | já há dispatch dashboard/workspace — 3ª opção |
| `src/views/main-chat.ts` (novo) | view com composer + thread | análoga a `workspace.ts` |
| `src/api.ts` | `chat.send`, `chat.output`, `chat.history` | reusa `j<T>()` |
| `server/routes/chat.ts` (novo) | `chat:send`, `chat:output`, `chat:history` | paralelo a `routes/w.ts` |
| `server/prompts/chat.md` (novo) | template cross-mundo | paralelo a `brainstorm.md` |
| `server/lib/run-chat.mjs` (novo) | spawn headless com prompt cross-mundo | paralelo a `launchBrainstorm` |
| `shell/sidebar` | item "Chat" entre o logo e a nav de mundos | 1 link `href="/c"` |

## O que tem de respeitar (invariantes)

1. **wtoken fence** — `POST /api/chat/send` exige `X-Atlas-Token` (igual a todos os PUTs). Sem token → 401.
2. **Streaming = reusar pattern `w:output`** — `{started, done, code, chunk, offset, size}` + poll 1s. NAO inventar SSE/WebSocket novo (overkill).
3. **Cross-mundo scoping** — o chat é a única coisa que não é per-slug. `runs/_chat/` em vez de `runs/<slug>/`. NAO poluir `runs/<slug>/` com ficheiros cross-mundo.
4. **Hermes headless** — reusar `runHermesHeadless` (já está em `server/api.ts`), com `logWs` + `.status` file (mesma fence). NAO spawnar com mecanismo diferente.
5. **History = notas especiais no Atlas** — opção natural: gravar cada mensagem trocada como **Nota** num workdir virtual "chat" (slug = `_chat`). Evita criar novo conceito "thread"; reusa `notes.json` + `meta.json`. **OU:** novo `chat-history.json` em `data/_chat/`. Trade-off a perguntar.
6. **Server = 1 processo Node já com tudo** — não precisa de novo port/service. Não precisa de Docker. Não precisa de MCP. **Footprint ladder rung 1-2.**
7. **UI = reusar tokens/tema/componentes** — `tokens.css`, dark theme auto-shift, mesma palette de ícones SVG (`src/ui/icons.ts`). NAO introduzir deps novas.

## Padrão de design (picks informadas)

- **Hexagonal (ports & adapters)** — domain = "thread de chat cross-mundo"; adapters = spawn Hermes headless (`runHermesHeadless`), store = notas-no-mundo-`_chat` ou ficheiro `chat-history.json`. **Reusa-se o ABC conceptual do prompt/launch/run que já existe.**
- **Active Record (light)** — o "thread" é só a lista de mensagens + o run a streamear. Sem aggregate complexo, sem invariantes além da ordem cronológica.

## Riscos

- **Custo de tokens** — cada mensagem vira 1 sessão Hermes nova (cold start). Se o user fizer 30 perguntas/hora, é 30 sessões. **Mitigação v1:** ok (já é o padrão brainstorm). **Mitigação v2:** manter sessão Hermes persistente por chat (overkill, YAGNI).
- **History unbounded** — sem trim, `chat-history.json` cresce para sempre. **Mitigação v1:** cap 1000 mensagens (rotate FIFO). **Mitigação v2:** vault-notes (rotate por data). A definir no DP.
- **Prompt size** — `chat.md` recebe `messages[]` + contexto de todos os mundos. Se houver muitas notas, prompt estoura. **Mitigação v1:** passar só lista de mundos + meta (nome, descrição), não notas. Se user quiser fundo, vai ao mundo.
- **Cross-mundo concurrency** — se user escreve "cria nota X em foo e Y em bar", o agente precisa de saber fazer 2 API calls. O prompt pode instruir. **Mitigação v1:** v1 do prompt diz "para cada ação num mundo, descreve-a no formato {slug, action, ...}; o agente fará as chamadas via API notes." (sem multi-mundo write em v1).
- **Race write no mundo errado** — se user troca de mundo enquanto o agente escreve, escreve no mundo errado. **Mitigação v1:** o agente lê `meta.json` no momento do write, não assume cache.

## O que NAO entra em v1 (out-of-scope)

- Multi-agent (vários Hermes por thread). Ponytail rung 1.
- WebSocket / SSE (já temos poll). Ponytail rung 1.
- Persistência no vault (sync `_chat` → SB). YAGNI.
- Memory provider / contexto cumulativo. YAGNI.
- Markdown render no composer (textarea simples + render simples na thread). YAGNI rich-text.
- Slash-commands dentro do chat (`/cards`, `/notes`). YAGNI.

## Fricção do próprio DR

- O pattern `runs/<slug>/<cardId>.log` + `.status` é **workdir-scoped**. Para o chat preciso decidir se crio `runs/_chat/` ou se meto no `runs/<slug>/<slug-current>/`. **Decisão no grill.**
- `glob-search` cross-mundo já existe no dashboard. O chat pode reusar isso como **sidebar de "notas encontradas"?** **Decisão no grill.**
- `orchestrator.start` move todos os TODO→DOING + spawn agents. **Não é o mesmo que chat** — chat é user-driven. Mas há overlap conceitual.

## Verificação do DR

- Li `src/router.ts`, `src/main.ts`, `src/api.ts`, `src/views/shell.ts`, `src/views/dashboard.ts`, `src/views/kanban.ts` (output stream pattern).
- Li `server/routes.ts` (dispatcher), `server/routes/index.ts`, `server/routes/w.ts` (extract), `server/api.ts` (launch helpers).
- Li `server/prompts/brainstorm.md` (template pattern).
- Identifiquei o streaming contract `{started, done, code, chunk, offset, size}`.
- Confirmei wtoken fence ativo em todos os POSTs.
- Confirmei zero routes cross-mundo no router (server).
