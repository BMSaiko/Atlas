# DP — Feature: logs (tab de logs por mundo)

**Card:** q49x3w24 · **Coluna:** doing · **Branch sugerida:** `feature/atlas-q49x3w24` (de `dev` — merge SEMPRE para dev, nunca main)

## Objetivo
Adicionar uma **4ª tab "Logs"** no workspace de cada mundo, ao lado de Dashboard / Notas / Kanban, que mostra as entradas de log de notificações já tipadas no projeto (`LogEntry`). O card diz "a tab de logs não existe" — a tab e a sua leitura existem como stub mas nunca foram ligadas à UI; o **mínimo** que faz a tab aparecer com dados reais (vazia se não houver writers ainda).

## Contexto / estado atual
- `src/api.ts:21` já define `LogEntry { id, ts, kind:'review'|'brainstorm'|'due', slug, title, body, ref, level }` e exporta `api.logs.get/put(slug)` — **schema e cliente existem, mas zero consumidores**.
- `data/atlas/logs.json` existe no disco: `{ ver:0, items:[] }` (vazio). Mesmo formato de `notes.json`.
- **`server/api.ts` NÃO tem endpoint `/api/w/:slug/logs`**: o dispatcher em `if (parts[0]==='w' && parts.length===3)` aceita apenas `kind ∈ {notes, kanban, meta, templates}` (linha `if (!['notes','kanban','meta'].includes(kind))` — `templates` é tratado antes do guard), e a fence de token PUT em `if (m==='PUT' && /^\/api\/w\/[^/]+\/(notes|kanban|bundle)$/.test(p))` rejeita `logs`. Por isso `api.logs.put` falharia hoje com 400/401.
- A estrutura de tabs vive em `src/views/workspace.ts:42-46`: `<nav class="ws-tabs"><button data-tab="dash|notes|kanban">...</button></nav>` + array `TAB_ORDER = ['dash','notes','kanban']` para Alt+←/→.
- O contador de tabs vive em `src/ui/counts.ts` (atualiza badges nas tabs Notes/Kanban); Logs pode usar o mesmo helper.
- `src/ui/icons.ts` tem `bell` (inline SVG) — encaixa semanticamente.
- **Nenhum writer** cria `LogEntry` no código atual; esse trabalho pertence a outros cards (review approve/reject, due snooze, brainstorm). Este card NÃO os cria — só **consome o que vier**.

## Abordagem proposta (mínima, lazy)
Quatro mudanças cirúrgicas, todas no caminho "GET /api/w/:slug/logs + tab UI":

### Passos
1. **Server — adicionar `kind === 'logs'` no dispatcher** (`server/api.ts`):
   - Inserir um branch `if (kind === 'logs') { ... }` **antes** da linha `if (!['notes','kanban','meta'].includes(kind))` (mesmo padrão do `kind === 'templates'` já existente). Comportamento: `GET` → `readJ(join(DATA, slug, 'logs.json')) ?? { ver:0, items:[] }`; `PUT` → validar shape (`items` array), otimistic concurrency igual a notes/kanban (reusa o bloco PUT existente), escreve `data/<slug>/logs.json`. Notas vazias (`items=[]`) é válido (é o estado atual).
   - **Estender a fence de token PUT** em `if (m==='PUT' && /.../.test(p))`: adicionar `|logs` ao regex, para `api.logs.put` deixar de 401.
2. **Cliente — `src/views/logs.ts` (NOVO ficheiro)**: `export async function renderLogs(root: HTMLElement, slug: string)` (mesma assinatura de `renderNotes`/`renderKanban`). Faz `api.logs.get(slug).catch(()=>null)`, devolve `{ ver, items }`. Render: empty state amigável se vazio; lista virtualizada simples (mais que ~50 faz scroll, sem dependência nova). Cada item mostra `level` (badge cor), `title`, `body` (sanitizado via `esc()` existente), `ts` (humano relativo, helper já existe em `ui/text.ts`/`ui/stats.ts`).
3. **Cliente — `src/views/workspace.ts`**:
   - Adicionar `<button class="ws-tab" data-tab="logs" id="tab-logs" title="Alt+← / Alt+→">${icon('bell',16)} Logs</button>` na `<nav class="ws-tabs">`.
   - Estender `TAB_ORDER` para `['dash','notes','kanban','logs']`; estender `tab` type para incluir `'logs'`; estender a branch do `show()`: `else if (tab === 'logs') await renderLogs(content, slug)`.
   - Adicionar `'logs'` à lista aceite do `localStorage.getItem(tabKey)` (default cai em `'dash'` se valor inválido).
   - **Ponytail:** o ciclo de Alt+←/→ é trivial; o deep-link `?tab=` apenas lê — nenhuma das duas precisa de mudar além do que já está.
4. **Cliente — `src/ui/counts.ts`**: chamar `api.logs.get(slug).catch(()=>null)` em paralelo com notes/kanban e setar `#tab-logs .side-count` com `items.length` (badge opcional; zero = sem badge, mesmo padrão dos outros).

### Ficheiros afetados
- **ALTERAR** `server/api.ts` (1 branch novo no dispatcher + 1 char no regex da fence).
- **CRIAR** `src/views/logs.ts` (novo view, ~80 linhas, mesmo esqueleto de `renderNotes`).
- **ALTERAR** `src/views/workspace.ts` (botão + `TAB_ORDER` + branch no `show()` + aceitar valor no LS).
- **ALTERAR** `src/ui/counts.ts` (1 fetch + 1 `set('tab-logs', n)`).
- **NÃO toca**: `src/api.ts` (cliente já tem `api.logs.*`), `src/styles/*` (reusa `.ws-tab`/`.empty` existentes), `data/atlas/logs.json` (vazio já está OK).

### Fora de scope (anotação, não implementar já)
- **Writers** (criar `LogEntry` em review approve/reject, due-soon, brainstorm, orchestrator) — outros cards.
- **Filtros** por `kind`/`level`/texto — YAGNI até o volume justificar.
- **Purge/clear UI** — `api.logs.put` aceita `{ items: [] }` (reusa a rota), mas botão "limpar tudo" é trabalho de um card separado.
- **Streaming** de novos logs (SSE/polling) — UI faz `api.logs.get` on-mount; refresh é manual via troca de tab.

## Critérios de aceite
- `GET /api/w/atlas/logs` → 200 com `{ ver:0, items:[] }` (já é o estado em disco).
- `PUT /api/w/atlas/logs` com token válido + `{ ver:0, items:[<LogEntry válido>] }` → 200, ficheiro escrito, `ver` incrementado (igual a notes/kanban).
- `PUT` **sem** token → 401 (fence preservada); sem `items` ou `items` não-array → 400.
- UI: abrir qualquer mundo → **4 tabs visíveis** (Dashboard / Notas / Kanban / Logs); clicar "Logs" mostra a lista (vazia por agora) e o empty state amigável quando não há items.
- `Alt+→` da tab Kanban salta para Logs; `Alt+←` da Logs volta para Kanban; ciclo cobre as 4.
- Refresh da tab atualiza o badge (se >0).
- `npm run typecheck` verde (sem `any` novo); `npm run build` verde.
- Vacuum: `grep -c '<<<<<<<'` = 0 antes do merge.
- Idempotência: rodar o card 2× no mesmo mundo produz o mesmo estado (sem duplicar botão, sem duplicar branch).

## Riscos / considerações
- **Sem writers, a tab fica vazia por design** — isso é o pretendido ("a tab não existe" → fazer existir; conteúdo vem dos próximos cards). Documentar no commit que o card só **liga a infraestrutura**, não a popula.
- **PUT concurrency**: reusa o padrão notes/kanban (etag `ver`). Cliente que PUT sem ler primeiro arranca `ver=0`; dois clientes a escrever ao mesmo tempo → um leva 409 e re-faz GET. Igual ao resto da app.
- **Tamanho de `logs.json`**: sem purge nem rotação, cresce monotonicamente. Aceitável até ~10k items; depois precisa de compaction (card separado, YAGNI agora).
- **XSS**: `body`/`title` em `LogEntry` vêm de writers — sanitizar sempre via `esc()` no render (mesma regra que notas).
- **Schema aberto**: `kind`/`level` são unions em TS; um writer futuro pode inventar um valor novo → `renderLogs` cai em "other" sem crash.
- **Não regista writer nenhum**: se alguém quiser testar com dados, pode `PUT` manual via `/api/w/atlas/logs` com `items:[{...}]` — fica documentado no critério de aceite.
