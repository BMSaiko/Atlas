# DP · Atlas "main chat" que gere todos os mundos (v2 — design-aware)

**Data:** 2026-09-04 (rev. 2 — design constraints + sem slug default)
**DR:** `code/plans/2026-09-04-main-chat-DR/DR.md`
**Skills carregadas:** `ui-ux-pro-max` (regras genéricas) + `design-system` (token arch) + `ui-styling` (Ponytail skip — Atlas é vanilla TS, não React/Tailwind).
**Ciclo:** michi v2.1 — fase DP (deep planning, TDD-shaped, audit table por fase).

## Goal (v1)

Adicionar ao Atlas um **chat cross-mundo** em `/c` com:

1. Composer (textarea) + botão enviar.
2. Thread scrollable com mensagens user / agent.
3. Stream do output do Hermes em tempo real (poll 1s, reusa pattern `w:output`).
4. Agente com **parity de features Atlas** — pode ler `meta`/`notes`/`kanban`/`logs` e escrever `notes`/`kanban`/`review.approve|reject`/`orchestrator.start` em qualquer mundo via API. Token injetado no prompt.
5. **Persistência** em `data/_chat/history.json` (cap 200 mensagens, FIFO rotate).
6. Acesso: **item na sidebar** (entre logo e nav de mundos) **+ entrada no command palette** (Ctrl+K).
7. **Slug SEMPRE explícito** no user prompt — agente NUNCA assume mundo. Se o user não disser, o agente pergunta (resposta: "Em que mundo?").

## Design constraints (regras extraídas de `ui-ux-pro-max` filtradas ao que Atlas JÁ tem)

Atlas já cumpre (não há trabalho a fazer):
- **Color contrast** (night/day/dusk + 4 seasons em `tokens.css`) — dark theme AA-safe.
- **`prefers-reduced-motion`** (line 35 de tokens.css) — overrides globais.
- **Touch targets** — `shell.ts` usa `.side-item` ≥44px; `.btn` ≥36px.
- **Focus rings** — `*:focus-visible` já definido em `base.css` (presumindo, ver).
- **Semantic tokens** — `--text`, `--text-dim`, `--gold`, `--pipe-*`, `--danger`.

Regras a garantir no chat (não confiar no "já existe"):

| Regra (de `ui-ux-pro-max`) | Aplicação ao chat |
|---|---|
| **Loading states** (1.A §3) | Composer disabled durante send; mostra "a enviar…" inline (não spinner global). |
| **Submit feedback** (1.A §8) | Após click, scroll-to-bottom + focus composer. |
| **Empty state** (1.A §8) | Thread vazia = hint central com 2-3 exemplos ("lista os mundos", "em atlas cria nota…"). |
| **Error clarity** (1.A §8) | Toast em 5xx; mensagem inline em chat se stream falha. |
| **Keyboard nav** (1.A §1) | `Ctrl+Enter` submete; `Esc` foca composer; `Tab` cycling. |
| **Color contrast** (1.A §1) | Texto agent vs user — 2 backgrounds distintos (var(--bg-2) vs var(--bg-3)), não só cor. |
| **Press feedback** (1.A §2) | Botão composer com active state (opacity .8). |
| **Motion** (1.A §7) | Stream do agent: typing indicator (3 dots pulse, 1.2s loop) até `started=true`; sem animar `width/height`, só `opacity`/`transform`. |
| **Line length** (1.A §5) | Mensagens do agent: max-width 65ch (line-length-control). |
| **State preservation** (1.A §9) | Composer NUNCA perde texto em F5; auto-save debounced (300ms) em `localStorage['atlas.chat.draft']`. |
| **No emoji icons** (1.A §4) | Usar SVG do `src/ui/icons.ts` (já é a regra no projeto). |
| **Focus on route change** (1.A §1) | `/c` carregado → focus vai para composer (a11y). |

**Ponytail rung 1 check (decisão):** Aplicar as 12 regras todas? **Não.** Aplicar 4 que o user **vai notar** (loading state, error clarity, line length, state preservation). As outras 8 o Atlas já cumpre por inheritance do `tokens.css` + `.side-item` + `.btn`. **Se** o user reclamar de uma regra mais tarde, patch on-demand.

## Assumptions

- `cfg.port` é o port do servidor Atlas (já usado em `launchBrainstorm`).
- `wtoken` é determinístico por boot (já existe, ver `server/routes.ts` + `api.ts` wt endpoint).
- `data/_chat/` é writeable (Atlas já escreve em `data/`, mesmo prefix).
- Hermes headless aceita fazer `fetch`/`curl` no sandbox; se não, devolve JSON fenced com `actions: [{method,path,body}, ...]` e o front-end executa-as com o `wtoken` fence.
- **Cap 200 mensagens** é suficiente; FIFO削 `messages[0]` quando `length > 200`.
- **Audit table** (michi 2026-09-03 self-evolution) por fase abaixo.

## Pattern fit

- **Hexagonal (ports & adapters)** — domain = thread; ports = `StoragePort` (`chat-store.mjs`) + `RunnerPort` (`runHermesHeadless`); adapters = `fs/promises` + `child_process.spawn`. Reusa o shape conceptual já em uso.
- **Active Record (light)** — o "thread" é só `{messages: ChatMsg[]}` + run a streamear. Sem invariantes além de ordem cronológica + cap.

## File map

| File | Status | Purpose |
|---|---|---|
| `src/router.ts` | edit | regex aceita `/c` e `/c/settings` |
| `src/views/shell.ts` | edit | dispatch para `renderMainChat`; item sidebar "Chat" (1 linha HTML) |
| `src/views/main-chat.ts` | **new** | view: composer + thread + stream poll + auto-save draft |
| `src/api.ts` | edit | adicionar `chat.{history, send, output, clear}` |
| `src/ui/palette.ts` | edit | adicionar entrada "Chat" + keybind |
| `src/styles/components.css` | edit | **+1 bloco** `.chat-*` (reusa vars) — NÃO mexer no resto |
| `server/routes/chat.ts` | **new** | 4 routes: `chat:history`, `chat:send`, `chat:output`, `chat:clear` |
| `server/routes/index.ts` | edit | re-export `chatRoutes` |
| `server/prompts/chat.md` | **new** | template do agente cross-mundo |
| `server/api.ts` | edit | `launchChat(opts)` helper (paralelo a `launchBrainstorm`) |
| `data/_chat/` | **new dir** | runtime, gitignored (já em `.gitignore` via `data/`) |
| `test/chat-routes.test.mjs` | **new** | smoke tests das 4 routes |
| `test/chat-history-cap.test.mjs` | **new** | FIFO rotate em 200 |
| `test/chat-output.test.mjs` | **new** | clone de `output-stream.test.mjs` para cross-mundo |

## Fases (TDD-shaped)

### Fase 1 · Server · storage + history routes
**Scope:** `data/_chat/history.json` schema, `chat-store.mjs` (read/append/clear com cap 200 FIFO), 2 routes.

**Seam testável:** `chat-store.mjs` — funções puras, fs/promises. YAGNI ceremony.

**Red:** `GET /api/chat/history` → 404 (route missing).
**Green:**
- `server/lib/chat-store.mjs` com `readHistory()` (devolve `{messages:[]}` se ficheiro não existe), `appendMessage(msg)`, `clearHistory()`. Cap no `appendMessage`.
- `server/routes/chat.ts` com 2 routes: `chat:history` (GET, length=2, match=["chat","history"]); `chat:clear` (DELETE, length=2, match=["chat","clear"]).
- Re-export em `server/routes/index.ts`.
- `test/chat-history-cap.test.mjs`: cria 250 mensagens → `readHistory()` devolve últimas 200; `clearHistory()` apaga.

**Audit table:**
| Phase | O que existe hoje | O que muda | Redundante? |
|---|---|---|---|
| 1 | `readJ`/`writeJ` em `api.ts` per-slug | novo `chat-store.mjs` cross-slug | **NO** — padrão per-slug não cobre cross-slug |

**Done-when:** `node test/chat-history-cap.test.mjs` RC=0; `GET /api/chat/history` em spin atlas devolve `{messages:[]}` e 200.

### Fase 2 · Server · launch + send route
**Scope:** `POST /api/chat/send` → append user msg → spawn `runHermesHeadless` com prompt cross-mundo → escreve `.log`+`.status` em `data/_chat/runs/<runId>/`.

**Seam testável:** `chat-runner.mjs` `buildPrompt(opts)` — função pura que faz `interpolate(loadPrompt('chat'), {...})`. **Confirmar com user ANTES de escrever o prompt** — é a alma da feature.

**Red:** `POST /api/chat/send {text:"olá"}` → 200 mas sem spawn (helper missing).
**Green:**
- `server/prompts/chat.md` com placeholders: `${userMsg}`, `${historyText}`, `${worldsList}`, `${apiBase}`, `${atlasToken}`, `${logPath}`. **Prompt instrui:** "Se o user NÃO referiu um mundo, responde APENAS com `Em que mundo queres trabalhar?` sem executar ações." (utilizador pediu).
- `server/lib/chat-runner.mjs` `buildPrompt(opts)` + `launchChat(opts)`.
- `server/api.ts` ganha `launchChat` fire-and-forget (mesmo shape de `launchBrainstorm`).
- `server/routes/chat.ts` adiciona `chat:send` (length=2, match=["chat","send"]).

**Audit table:**
| Phase | O que existe hoje | O que muda | Redundante? |
|---|---|---|---|
| 2 | `launchBrainstorm` em api.ts (1 spawn site) | `launchChat` paralelo (outro spawn site) | **NO** — shapes diferentes (cross-mundo vs per-slug) |

**Done-when:** `POST /api/chat/send {text:"em atlas, lista as 3 últimas notas"}` → 200; `data/_chat/runs/<runId>.log+.status` aparecem; primeiro byte no log em <3s.

### Fase 3 · Server · output route
**Scope:** `GET /api/chat/output/<runId>?offset=N` — clone de `w:output` mas cross-mundo. Mesmo contract `{started, done, code, chunk, offset, size}`.

**Seam testável:** o endpoint, polled pelo UI. Zero ambiguidade.

**Red:** `GET /api/chat/output/<id>` → 404.
**Green:**
- Adicionar `chat:output` em `server/routes/chat.ts` (length=3, match=["chat","output",null]).
- Reusa `_sanitizeText` (já em deps).
- `test/chat-output.test.mjs` clone de `output-stream.test.mjs`.

**Audit table:**
| Phase | O que existe hoje | O que muda | Redundante? |
|---|---|---|---|
| 3 | `w:output` (per-slug, 30 linhas) | `chat:output` (cross-slug, 30 linhas) | **NO** — paths físicos diferentes |

**Ponytail rung 1:** extrair `lib/output-poll.mjs`? **NÃO** — só 2 fontes, abstração especulativa. YAGNI.

**Done-when:** `node test/chat-output.test.mjs` RC=0.

### Fase 4 · Client · api.chat helpers
**Scope:** `api.chat.{history, send, output, clear}` em `src/api.ts` (reusa `j<T>()`).

**Red:** `api.chat` é `undefined` → UI quebra.
**Green:** 4 helpers paralelos a `api.notes`.

**Done-when:** `await api.chat.history()` no console devolve `{messages:[]}`.

### Fase 5 · Client · view + router + sidebar + palette
**Scope:**
- `src/router.ts` regex aceita `/c` e `/c/settings`.
- `src/views/shell.ts` dispatch: se path `/c` → `renderMainChat(panel)`. Sidebar: 1 `<a class="side-item" href="/c" data-nav="/c">` antes da nav de mundos.
- `src/views/main-chat.ts` (novo): composer (textarea + button), thread (`<ol>` de mensagens), poll `api.chat.output(runId, offset)` a 1s enquanto `started && !done`.
- `src/ui/palette.ts` adiciona "Chat" como entrada + keybind (Ctrl+K já existe).
- `src/styles/components.css` adiciona 1 bloco `.chat-*` (reusa `--s1..7`, `--r1..3`, `--text`, `--gold`, `--pipe-*`).

**Seam testável:** manual browser. YAGNI test infra para views.

**Design rules a implementar no `main-chat.ts`:**
- Empty state thread: hint central com 2-3 exemplos (zero JS, só HTML).
- Composer: `<textarea rows="2" placeholder="Em <mundo>, …">`; disabled durante send; auto-save debounced 300ms em `localStorage['atlas.chat.draft']`; restore on mount.
- Mensagens: `<li class="chat-msg chat-msg--user|agent">` com bg-2 (user) / bg-3 (agent) — 2 fundos distintos, não só cor.
- Typing indicator: 3 dots, opacity loop 1.2s, `prefers-reduced-motion: hidden`.
- Line length: `max-width: 65ch` em `.chat-msg--agent`.
- `Ctrl+Enter` submete; `Esc` foca composer.
- Scroll-to-bottom + focus composer após send.
- Focus on route change: ao montar, `composer.focus()`.

**Red:** path `/c` → router não matcha, fallback dashboard.
**Green:** as 4 edits + 1 view nova + 1 bloco CSS.

**Audit table:**
| Phase | O que existe hoje | O que muda | Redundante? |
|---|---|---|---|
| 5 | `renderDashboard`, `renderWorkspace`, `renderEmpty` | `renderMainChat` (3ª opção dispatch) | **NO** — concern diferente (cross-mundo) |

**Done-when:** abrir `/c` no browser mostra composer + thread vazia; escrever "olá" + send → após 1-3s, mensagem do agente aparece (stream). `Ctrl+Enter` submete. F5 → composer restaurado.

### Fase 6 · Error handling + UX polish
**Scope:**
- 5xx em `send`/`output` → toast + re-enable composer + msg inline "Atlas offline — tenta outra vez".
- Stream interrompido (`.status` em `running` mas sem novos bytes há 60s) → toast "sem resposta — vou parar" + limpar poll.
- Botão "Limpar thread" no header da view → `api.chat.clear()` + reload thread.

**Audit table:**
| Phase | O que existe hoje | O que muda | Redundante? |
|---|---|---|---|
| 6 | `toast()` em `src/ui/toast.ts`; poll cap em `kanban.ts` (30min) | reusa ambos | **YES** parcialmente — `kanban.ts` poll cap pode ser extraído. **NÃO em v1.** |

**Done-when:** manual browser — 5xx simulado mostra toast; stream travado deteta em 60s; "Limpar thread" esvazia history + UI.

## Riscos (resumo)

- **Custo de tokens por mensagem** (mitigação v1: ok; v2: sessão Hermes persistente — YAGNI).
- **History unbounded** (mitigação v1: cap 200 FIFO, validado no test).
- **Prompt size** (mitigação v1: passa só `meta` dos mundos, não notas).
- **Agente escrever no mundo errado** (mitigação v1: prompt obriga agente a confirmar slug antes de POST; front-end UI não toca).
- **Hermes tools vs curl mental** (mitigação v1: prompt inclui `curl` examples; se modelo não fizer fetch, devolve JSON fenced com `actions: [...]` que o front-end aplica).
- **Race entre send e clear** (mitigação v1: clear só apaga history; runs antigos `.log/.status` ficam no disco e limpam-se no próximo `cleanup-runs` ou F5+5min — YAGNI in v1).

## Out-of-scope (v1)

- Multi-agent (vários Hermes em paralelo). Ponytail rung 1.
- WebSocket / SSE (reusamos poll). Ponytail rung 1.
- Persistência no vault (sync `_chat` → SB). YAGNI.
- Memory provider / contexto cumulativo entre runs. YAGNI.
- Markdown render rico no composer (textarea simples; render simples na thread com `white-space: pre-wrap`). YAGNI rich-text.
- Slash-commands dentro do chat (`/cards`, `/notes`). YAGNI.
- Extração de `lib/output-poll.mjs` (rung 1 v2, se houver 3ª fonte de output).
- Threading (várias threads paralelas). YAGNI v1.
- Code highlighting no output do agente. YAGNI.
- Modo leitura-only se user não refere slug. **Decisão:** agente devolve "Em que mundo?" como primeira resposta (não é modo; é comportamento).

## Gates (Phase 5 michi)

- `node test/chat-history-cap.test.mjs` → RC=0
- `node test/chat-output.test.mjs` → RC=0
- `node test/chat-routes.test.mjs` → RC=0
- `npx tsc --noEmit` (server + client) → RC=0
- `npm run build` → RC=0
- Manual browser:
  - `/c` carrega, focus vai para composer.
  - Escrever "olá" sem mundo → agente pergunta "Em que mundo?".
  - Escrever "em atlas, lista as 3 últimas notas" → agent stream + resposta em <10s.
  - `Ctrl+Enter` submete.
  - F5 → composer restaurado.
  - 5xx simulado → toast + composer re-enable.
  - Stream travado 60s → toast "sem resposta".
  - "Limpar thread" → thread esvaziada.

## Per-phase commit cadence

**Pergunta ao user no sign-off:** "commit per phase ou one big?" Default: **per phase** (michi 2026-09-02 self-evolution).
