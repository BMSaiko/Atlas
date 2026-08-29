# Changelog

Todas as mudanças notáveis do Atlas. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-PT/1.1.0/), versionamento em `0.x`.

## [Unreleased]

### Added
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

### Changed
- Cards com **2 tamanhos** (conteúdo vs output `.has-output`): limita o título do resultado (line-clamp 2 no card, completo no modal).
- Review agora é **coluna por default** em todos os kanban (garante no load + no default ao criar workdir).
- `run`: terminal WezTerm abre com o título do cartão (set-tab-title); auto-cleanup do worktree mais robusto (junction node_modules partilhado, retry remove+rm vs EBUSY, `worktree remove --force`, kill de panes lockers).
- `merge dev → main` resolve o tip real de `main` (local‖remote) antes do fast-forward.
- DP/resultado do card renderizam **Markdown legível** (`renderMd`, classe `.md-view`) no modal (`kdp-body`/`kresult-body`), substituindo o colapso CSS cru.

### Fixed
- Notificações: poll com um único `setInterval` (sem duplicar em review), notif global funciona fora do kanban.
- Re-run de card: worktree "já existe" — retry remove+rm + prune após o dir sumir; limpa `result`/`reviewed` ao voltar a `doing`.
- Foco: overlay fecha com Esc/clique-fora; botões/durações visíveis (z-index do modal pomodoro corrigido).
- Contagens (10.2.1): arquivar a última nota ativa atualiza a badge (early-return).
- Notas: em `renderMd`, a linha de **task/checkbox** (`- [ ]`) casa **antes** da lista genérica — o checkbox só renderizava após o `- ` genérico cair no `<li>` morto (DI 29/08).
- `launchHermes`: base branch do task-runner passou a ser a **branch default real do repo do mundo** (não hardcode `dev`) — repos sem `dev` (ex. só `master`) deixam de falhar no `worktree add`.

## [0.1.0] — app-shell + workdirs + kanban

### Added
- Vite+TS SPA: shell com sidebar workdirs (keybind `Ctrl+Alt+1..9`, item activo gold) + painel.
- Workdirs isolados (`data/<slug>/{meta,notes,kanban}.json`), hub `/`, workspace `/w/:slug`, settings.
- Quicknotes com busca; kanban (To Do / Em Curso / Review / Done), prioridade, drag & drop nativo.
- Design cosmos/noite com auto-shift dia↔dusk↔noite, acessibilidade AA, links gold, counts.

### Added (task-runner)
- Card kanban → `POST /api/w/:slug/run`: WezTerm + Hermes oneshot em worktree git própria; `doing` automático, `result` gravado no card, polling no front.
- Fluxo Review `/api/w/:slug/review/{approve|reject}`: `done` manual (BMS) com `merge dev → main` no approve; reject volta a `doing`.
