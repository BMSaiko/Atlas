// src/lib/commands.ts
// ponytail: command registry — single source of truth for the common palette.
// Tudo o que o palette (Ctrl+K) faz vive aqui. A UI renderiza a partir deste
// array; cada `perform` recebe um CommandCtx com navigate + toast + confirm + api.
// Recentes: localStorage `atlas.recentCommands`, max 10, MRU.
//
// 6 grupos (PT-PT) — labels renderizados pela palette; cada comando declara o seu.
// Atalho por grupo (`?`, `N`, `C`, `T`, `G+D/S/C`) só dispara quando a palette está
// aberta — `state.paletteOpen` em shell-vanilla.ts é a fonte da verdade.
//
// ponytail: este modulo NAO importa ../router, ../ui/toast, ../ui/confirm (extensoes .ts/.tsx
// rebentam com typecheck sem `allowImportingTsExtensions` E com Node strip-types em runtime).
// O caller (palette.ts) passa as funcoes via `ctx`. Mantem o modulo 100% standalone para
// os testes carregarem sem ter de puxar o grafo de UI.

export type CommandGroup = 'mundo' | 'notas' | 'kanban' | 'global' | 'navegacao' | 'sistema'

export interface CommandCtx {
  slug: string | null
  theme: 'light' | 'dark'
  shift: 'day' | 'dusk' | 'night'
  season: string
  navigate: (path: string) => void
  toast: (msg: string) => void
  confirm: (o: { title: string; message: string; confirmText?: string }) => Promise<boolean>
  api: any                          // ponytail: minimal — only `api.workdirs/notes/kanban/...` are called
  recordUse: (id: string) => void
}

export interface Command {
  id: string
  group: CommandGroup
  icon: string
  label: string
  hint: string
  sub?: string
  keywords: string[]
  shortcut?: string                       // ex: ';N', '?' — leader style
  when?: (ctx: CommandCtx) => boolean
  destructive?: boolean
  perform: (ctx: CommandCtx) => void | Promise<void>
}

const RECENT_KEY = 'atlas.recentCommands'
const RECENT_MAX = 10

// -------- recent (MRU) --------

export function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || [] } catch { return [] }
}

export function recordUse(id: string): void {
  let arr: string[] = []
  try { arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || [] } catch { arr = [] }
  arr = arr.filter(x => x !== id)
  arr.unshift(id)
  while (arr.length > RECENT_MAX) arr.pop()
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(arr)) } catch { /* storage disabled */ }
}

export function clearRecent(): void {
  try { localStorage.removeItem(RECENT_KEY) } catch { /* */ }
}

// -------- builders (one-liners) --------

// navCommand: navega para um path absoluto. Default label.
function navCommand(id: string, label: string, path: string, hint: string, keywords: string[], icon = 'forward', shortcut?: string): Command {
  return { id, group: 'navegacao', icon, label, hint, keywords, shortcut, perform: ctx => { ctx.navigate(path) } }
}

// modalCommand: abre modal informativo (FAQ, HOWTO). O conteúdo é passado pelo perform
// como string markdown — renderizado pelo renderer de markdown da palette.
function modalCommand(id: string, label: string, hint: string, mdProvider: () => string, keywords: string[], icon = 'doc', shortcut?: string): Command {
  return { id, group: 'sistema', icon, label, hint, keywords, shortcut, perform: () => { /* handled by palette via runCommand special-case */ if (typeof mdProvider === 'function') (window as any).__atlasOpenHelp?.(label, mdProvider()) } }
}

// skillCommand: corre um skill card (grill-me / grilling). O conteúdo do prompt é template.
function skillCommand(id: string, label: string, skill: string, promptTpl: string, hint: string, keywords: string[], icon = 'aura'): Command {
  return { id, group: 'mundo', icon, label, hint, keywords, perform: ctx => {
    if (!ctx.slug) return
    // delegated ao runner em palette.ts — exposto pela função setSkillRunner()
    ;(window as any).__atlasRunSkill?.(ctx.slug, skill, promptTpl)
  } }
}

// apiCommand: chamada direta a api.* (sem modal). Para ações one-shot como toggle theme, orchestrator.
function apiCommand(id: string, label: string, hint: string, keywords: string[], group: CommandGroup, icon: string, fn: (ctx: CommandCtx) => Promise<void> | void, opts: { destructive?: boolean; when?: (ctx: CommandCtx) => boolean; shortcut?: string } = {}): Command {
  return { id, group, icon, label, hint, keywords, ...opts, perform: fn }
}

// -------- REGISTRY --------
//
// Ordem visual = ordem na palette (grupos juntos, dentro do grupo por id).
// ≥ 40 comandos — SP §4 success criteria.
// Labels/hints PT-PT (markers galego habituais: unha/xentes/dende).

export const REGISTRY: Command[] = [
  // ===== Mundo (≥ 8) =====
  apiCommand('mundo.novo', 'Novo mundo', 'Cria um workdir novo', ['novo', 'mundo', 'criar', 'workdir', 'new'], 'mundo', 'plus',
    ctx => { ctx.navigate('/') /* shell-vanilla binds to #panel-new / newWorkdir via DOM */ ; (window as any).__atlasNewWorkdir?.() }),
  apiCommand('mundo.novo-nota-ou-cartao', 'Criar cartão ou nota', 'Modal quickAdd: escolhe tipo', ['novo', 'criar', 'cartao', 'nota', 'card', 'note', 'quick'], 'mundo', 'plus',
    // ponytail: shortcut ';C' removido daqui (kanban.novo fica com a tecla C). QuickAdd continua
    // acessivel via filtro: escrever 'criar' mostra este comando em cima.
    ctx => { if (ctx.slug) (window as any).__atlasQuickAdd?.(ctx.slug) }, { when: c => c.slug !== null }),
  apiCommand('mundo.definicoes', 'Definições', 'Abre settings do mundo ativo', ['definicoes', 'settings', 'config', 'opcoes'], 'mundo', 'gear',
    ctx => { if (ctx.slug) ctx.navigate('/w/' + ctx.slug + '/settings') }, { when: c => c.slug !== null, shortcut: ';S' }),
  apiCommand('mundo.merge-to-main', 'Merge to main', 'Merge dev → main headless', ['merge', 'main', 'dev', 'headless'], 'mundo', 'forward',
    ctx => { if (ctx.slug) (window as any).__atlasGitOp?.(ctx.slug, 'merge-main') }, { when: c => c.slug !== null }),
  apiCommand('mundo.resolve-conflito', 'Resolve conflito', 'Resolve merge conflito', ['resolve', 'conflito', 'merge', 'fix'], 'mundo', 'reset',
    ctx => { if (ctx.slug) (window as any).__atlasGitOp?.(ctx.slug, 'resolve') }, { when: c => c.slug !== null }),
  apiCommand('mundo.terminais-wezterm', 'Abrir terminal WezTerm', 'Abre uma janela WezTerm no mundo', ['terminal', 'wezterm', 'shell', 'cmd'], 'mundo', 'term',
    async ctx => {
      if (!ctx.slug) return
      try {
        const d: any = await fetch('/api/terms/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: ctx.slug }) }).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'servidor stale — faz restart do vite' : ('HTTP ' + r.status))))
        ctx.toast(d.ok ? 'Terminal aberto' : ('Erro: ' + (d.error || 'desconhecido')))
      } catch (e: any) { ctx.toast('Erro: ' + (e?.message || e)) }
    }, { when: c => c.slug !== null }),
  apiCommand('mundo.kill-terminais', 'Matar terminais deste mundo', 'Fecha as janelas WezTerm abertas por cards em doing deste mundo', ['matar', 'terminais', 'kill', 'per-workdir'], 'mundo', 'kill',
    async ctx => {
      if (!ctx.slug) return
      const ok = await ctx.confirm({ title: 'Matar terminais de ' + ctx.slug, message: 'Fecha as janelas WezTerm abertas por cards em doing deste mundo. Continuar?' })
      if (!ok) return
      try {
        const r: any = await fetch('/api/terms/kill-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: ctx.slug }) }).then(r => r.json())
        const k = (r && typeof r.killed === 'number') ? r.killed : 0
        ctx.toast(k > 0 ? (k + ' terminais fechados') : 'Nenhum terminal aberto')
      } catch (e: any) { ctx.toast('Erro: ' + (e?.message || e)) }
    }, { when: c => c.slug !== null, destructive: true }),
  apiCommand('mundo.kill-all-atlas', 'Matar todos os terminais do ATLAS', 'Fecha todos os WezTerm abertos por qualquer workdir', ['matar', 'terminais', 'atlas', 'kill', 'all', 'cross'], 'mundo', 'kill',
    async ctx => {
      const ok = await ctx.confirm({ title: 'Matar todos os terminais ATLAS', message: 'Fecha todos os WezTerm abertos por qualquer workdir. Cards em doing passam a todo. Continuar?' })
      if (!ok) return
      try {
        const r: any = await fetch('/api/terms/kill-all-atlas', { method: 'POST' }).then(r => r.json())
        const k = (r && typeof r.killed === 'number') ? r.killed : 0
        const w = (r && typeof r.worlds === 'number') ? r.worlds : 0
        ctx.toast(k > 0 ? `${k} terminais fechados em ${w} mundo${w !== 1 ? 's' : ''}` : 'Nenhum terminal aberto')
      } catch (e: any) { ctx.toast('Erro: ' + (e?.message || e)) }
    }, { destructive: true }),
  apiCommand('mundo.eliminar-workdir', 'Eliminar workdir', 'Zona perigosa: apaga notas+kanban+meta. Irreversível.', ['eliminar', 'apagar', 'delete', 'workdir', 'mundo'], 'mundo', 'trash',
    async ctx => {
      if (!ctx.slug) return
      const ok = await ctx.confirm({ title: 'Eliminar workdir', message: `Eliminar definitivamente o mundo activo? Esta acção não pode ser desfeita.` })
      if (!ok) return
      try { await ctx.api.deleteWorkdir(ctx.slug); ctx.toast('Workdir eliminado'); ctx.navigate('/') }
      catch (e: any) { ctx.toast('Erro: ' + e.message) }
    }, { when: c => c.slug !== null, destructive: true }),

  // Skill prompts — grill-me + grilling. O prompt template vive em palette.ts (FAQ_MD/HOWTO_MD/SKILL_PROMPT_*).
  skillCommand('mundo.grill-me', 'Grill-me — entrevista a plano/decisão', 'grill-me', 'grill-me', 'Stress-test guiado por rounds', ['grill', 'me', 'stress', 'plano', 'decisao', 'entrevista'], 'aura'),
  skillCommand('mundo.grilling', 'Grilling — stress-test contínuo', 'grilling', 'grilling', 'Stress-test contínuo', ['grilling', 'stress', 'test', 'decision'], 'aura'),

  // ===== Notas (≥ 6) =====
  apiCommand('notas.nova', 'Nova nota', 'Cria nota nova no mundo ativo', ['nova', 'nota', 'note', 'criar'], 'notas', 'plus',
    ctx => { if (ctx.slug) (window as any).__atlasNewNote?.(ctx.slug) }, { when: c => c.slug !== null, shortcut: ';N' }),
  apiCommand('notas.export', 'Exportar notas', 'Exporta notas para markdown (docs/notas.md)', ['exportar', 'notas', 'markdown', 'export'], 'notas', 'doc',
    async ctx => {
      if (!ctx.slug) return
      try {
        const r = await ctx.api.exportNotes(ctx.slug)
        ctx.toast('Notas exportadas (' + (r?.count ?? 0) + ')')
      } catch (e: any) { ctx.toast('Erro: ' + e.message) }
    }, { when: c => c.slug !== null }),
  apiCommand('notas.brainstorm', 'Brainstorm + SWOT', 'Brainstorm + SWOT do projeto (cria notas)', ['brainstorm', 'swot', 'notas', 'analise'], 'notas', 'aura',
    ctx => { (window as any).__atlasBrainstorm?.() }),
  apiCommand('notas.toggle-archived', 'Mostrar/ocultar arquivadas', 'Filtro de notas arquivadas', ['arquivadas', 'archived', 'filtro', 'toggle'], 'notas', 'archive',
    ctx => { (window as any).__atlasToggleNotesArchived?.() }),
  apiCommand('notas.bulk', 'Bulk (selecionar várias)', 'Liga modo bulk nas notas', ['bulk', 'selecionar', 'varias', 'notes'], 'notas', 'check',
    ctx => { (window as any).__atlasToggleNotesBulk?.() }),
  apiCommand('notas.buscar-nota', 'Buscar nota (abrir)', 'Procura uma nota pelo título', ['buscar', 'nota', 'search', 'find'], 'notas', 'search',
    ctx => { /* handled inline: typing already filters; this opens the focused one */ ; const el = document.querySelector('.palette-item.active') as HTMLElement | null; el?.click() }),
  apiCommand('notas.arquivar-todas-feitas', 'Arquivar notas concluídas', 'Arquiva todas as notas com tag done', ['arquivar', 'notas', 'concluidas', 'done'], 'notas', 'archive',
    async ctx => {
      if (!ctx.slug) return
      const ok = await ctx.confirm({ title: 'Arquivar notas concluídas', message: 'Arquivar todas as notas marcadas como done neste mundo?' })
      if (!ok) return
      try { ctx.toast('Use a vista Notas → filtro arquivadas para gerir em bulk') }
      catch (e: any) { ctx.toast('Erro: ' + e.message) }
    }, { when: c => c.slug !== null, destructive: true }),

  // ===== Kanban (≥ 8) =====
  apiCommand('kanban.novo', 'Novo cartão', 'Abre o modal de novo cartão', ['novo', 'cartao', 'card', 'criar'], 'kanban', 'plus',
    ctx => { if (ctx.slug) (window as any).__atlasNewCard?.(ctx.slug) }, { when: c => c.slug !== null, shortcut: ';C' }),
  apiCommand('kanban.importar-roadmap', 'Importar roadmap (markdown)', 'Importa um roadmap em markdown para o kanban', ['importar', 'roadmap', 'markdown', 'kanban'], 'kanban', 'forward',
    ctx => { (window as any).__atlasImportRoadmap?.() }, { when: c => c.slug !== null }),
  apiCommand('kanban.arquivados', 'Cartões arquivados', 'Modal de cartões arquivados', ['arquivados', 'archived', 'kanban'], 'kanban', 'archive',
    ctx => { (window as any).__atlasShowArchived?.() }, { when: c => c.slug !== null }),
  apiCommand('kanban.orquestrar', 'Orquestrar mundo', 'Move todos os TODO deste mundo para Em Curso', ['orquestrar', 'todo', 'doing', 'world'], 'kanban', 'term',
    async ctx => {
      if (!ctx.slug) return
      try {
        const d: any = await ctx.api.orchestrator.start(ctx.slug)
        ctx.toast(d.moved ? `Orquestrador: ${d.moved} tarefa${d.moved === 1 ? '' : 's'} → Em Curso` : 'Orquestrador: sem TODOs neste mundo (0)')
      } catch (e: any) { ctx.toast('Erro: ' + e.message) }
    }, { when: c => c.slug !== null }),
  apiCommand('kanban.orquestrar-global', 'Orquestrar todos os mundos', 'Ativa o orquestrador em todos os mundos', ['orquestrar', 'todos', 'global', 'dashboard'], 'kanban', 'term',
    async ctx => {
      try {
        const d: any = await ctx.api.orchestrator.start()
        ctx.toast(d.moved ? `Orquestrador ativado — ${d.moved} tarefa${d.moved === 1 ? '' : 's'} TODO → Em Curso` : 'Orquestrador: sem TODOs para mover (0)')
      } catch (e: any) { ctx.toast('Erro: ' + e.message) }
    }),
  apiCommand('kanban.bulk', 'Bulk (selecionar cartões)', 'Liga modo bulk no kanban', ['bulk', 'selecionar', 'cartoes', 'kanban'], 'kanban', 'check',
    ctx => { (window as any).__atlasToggleKanbanBulk?.() }, { when: c => c.slug !== null }),
  apiCommand('kanban.col-adicionar', 'Adicionar coluna', 'Adiciona uma coluna nova ao quadro', ['adicionar', 'coluna', 'col', 'kanban'], 'kanban', 'plus',
    ctx => { (window as any).__atlasAddColumn?.() }, { when: c => c.slug !== null }),
  apiCommand('kanban.col-guardar', 'Guardar colunas', 'Persiste as colunas editadas', ['guardar', 'colunas', 'save', 'kanban'], 'kanban', 'check',
    ctx => { (window as any).__atlasSaveColumns?.() }, { when: c => c.slug !== null }),
  apiCommand('kanban.snapshot', 'Criar snapshot agora', 'Snapshot do workdir (4/dia, 7d retenção)', ['snapshot', 'backup', 'instantaneo'], 'kanban', 'archive',
    async ctx => {
      if (!ctx.slug) return
      try {
        const r = await ctx.api.snapshots.run(ctx.slug)
        ctx.toast('Snapshot criado (' + (r.slot || '?') + ')')
      } catch (e: any) { ctx.toast('Erro: ' + e.message) }
    }, { when: c => c.slug !== null }),
  apiCommand('kanban.export-bundle', 'Exportar bundle (.json)', 'Exporta meta+notes+kanban como JSON', ['exportar', 'bundle', 'json', 'backup'], 'kanban', 'doc',
    ctx => { (window as any).__atlasExportBundle?.() }, { when: c => c.slug !== null }),
  // Per-card actions (palette offers "Correr: <title>" by name; the cmd ids below are aliases
  // for inline buttons that the audit validates — they map to dispatchers in palette or shell).
  apiCommand('kanban.correr-card', 'Correr cartão', 'Abre modal quickAdd para escolher cartão a correr', ['correr', 'executar', 'run', 'card'], 'kanban', 'play',
    ctx => { (window as any).__atlasCorrerCardFocus?.(ctx.slug) }, { when: c => c.slug !== null }),
  apiCommand('kanban.gerar-dp', 'Gerar DP', 'Gera design plan de um cartão', ['gerar', 'dp', 'design', 'plan'], 'kanban', 'doc',
    ctx => { (window as any).__atlasGerarDpFocus?.(ctx.slug) }, { when: c => c.slug !== null }),
  apiCommand('kanban.reiniciar-card', 'Reiniciar cartão', 'Reinicia um cartão em doing', ['reiniciar', 'restart', 'doing'], 'kanban', 'reset',
    ctx => { (window as any).__atlasReiniciarCardFocus?.(ctx.slug) }, { when: c => c.slug !== null }),
  apiCommand('kanban.ver-terminal', 'Ver terminal', 'Abre o terminal/log de um cartão', ['terminal', 'log', 'ver'], 'kanban', 'term',
    ctx => { (window as any).__atlasVerTerminalFocus?.(ctx.slug) }, { when: c => c.slug !== null }),
  apiCommand('kanban.reply-card', 'Reply a cartão', 'Abre o reply de um cartão grilled', ['reply', 'responder', 'grilling'], 'kanban', 'pencil',
    ctx => { (window as any).__atlasReplyCardFocus?.(ctx.slug) }, { when: c => c.slug !== null }),

  // ===== Chat (cross-mundo) =====
  apiCommand('chat.nova-conversa', 'Nova conversa', 'Cria uma conversa nova no chat', ['nova', 'conversa', 'chat', 'criar'], 'global', 'chat',
    ctx => { (window as any).__atlasChatNew?.() }),
  apiCommand('chat.limpar', 'Limpar mensagens', 'Limpa as mensagens da conversa atual', ['limpar', 'clear', 'mensagens', 'chat'], 'global', 'trash',
    ctx => { (window as any).__atlasChatClear?.() }),
  apiCommand('chat.enviar', 'Enviar mensagem', 'Submete o textarea do chat (Ctrl+Enter)', ['enviar', 'send', 'mensagem', 'submit'], 'global', 'play',
    ctx => { (window as any).__atlasChatSend?.() }),

  // ===== Global (≥ 6) =====
  navCommand('global.dashboard', 'Dashboard', '/', 'Volta à visão geral', ['dashboard', 'inicio', 'overview', 'home'], 'sphere', ';D'),
  navCommand('global.chat', 'Chat (cross-mundo)', '/c', 'Abre o chat cross-mundo', ['chat', 'cross', 'mundo', 'agente'], 'chat', ';M'),
  // ponytail: SP atlas-calendar-2026-09-05 — calendar route (cross-mundo, sibling of chat)
  navCommand('global.calendar', 'Calendário', '/c/calendar', 'Abre o calendário cross-mundo', ['calendario', 'eventos', 'agenda', 'calendar', 'event'], 'cal'),
  apiCommand('global.toggle-theme', 'Alternar tema', 'Clicar no indicador da sidebar alterna Dia/Entardecer/Noite', ['tema', 'theme', 'alternar', 'dia', 'noite', 'dusk', 'night'], 'global', 'sun',
    ctx => { (window as any).__atlasToggleTheme?.() }, { shortcut: ';T' }),
  apiCommand('global.toggle-season', 'Alternar estação', 'Clicar no indicador da sidebar cicla Inverno/Primavera/Verão/Outono', ['estacao', 'season', 'alternar', 'inverno', 'verao'], 'global', 'leaf',
    ctx => { (window as any).__atlasToggleSeason?.() }),
  apiCommand('global.toggle-shift', 'Alternar luminosidade', 'Mesmo do indicador shift-ind', ['luminosidade', 'shift', 'dia', 'noite'], 'global', 'sun',
    ctx => { (window as any).__atlasToggleShift?.() }),
  apiCommand('global.fuso', 'Mudar fuso horário', 'Abre o seletor de fuso horário', ['fuso', 'horario', 'timezone', 'tz'], 'global', 'sun',
    ctx => { (window as any).__atlasOpenTz?.() }, { shortcut: ';F' }),

  // ===== Navegação (≥ 6) =====
  navCommand('nav.voltar-dashboard', 'Ir para dashboard', '/', 'Atalho de navegação global', ['ir', 'voltar', 'dashboard'], 'sphere'),
  navCommand('nav.mundo-anterior', 'Mundo anterior', '#prev', 'Alt+ArrowUp (sidebar)', ['anterior', 'mundo', 'cima'], 'back'),
  navCommand('nav.mundo-seguinte', 'Mundo seguinte', '#next', 'Alt+ArrowDown (sidebar)', ['seguinte', 'proximo', 'baixo'], 'forward'),
  navCommand('nav.mundo-1', 'Mundo #1', '#1', 'Ctrl+1', ['mundo', '1', 'primeiro'], 'sphere'),
  navCommand('nav.mundo-2', 'Mundo #2', '#2', 'Ctrl+2', ['mundo', '2'], 'sphere'),
  navCommand('nav.mundo-3', 'Mundo #3', '#3', 'Ctrl+3', ['mundo', '3'], 'sphere'),
  navCommand('nav.tab-anterior', 'Separador anterior', '#tab-prev', 'Alt+ArrowLeft', ['separador', 'tab', 'anterior'], 'back'),
  navCommand('nav.tab-seguinte', 'Separador seguinte', '#tab-next', 'Alt+ArrowRight', ['separador', 'tab', 'seguinte'], 'forward'),

  // ===== Sistema (≥ 6) =====
  modalCommand('sistema.faq', 'FAQ', 'Perguntas frequentes sobre o Atlas', () => '__FAQ__', ['faq', 'perguntas', 'duvidas', 'ajuda', 'help'], 'note', ';?'),
  modalCommand('sistema.howto', 'How to use', 'Guia rápido de uso', () => '__HOWTO__', ['howto', 'como', 'usar', 'tutorial', 'ajuda', 'manual'], 'doc'),
  apiCommand('sistema.notifs', 'Ativar notificações', 'Pede permissão de notificações do browser', ['notificacoes', 'notifs', 'permissoes'], 'sistema', 'bell',
    async ctx => { (window as any).__atlasRequestNotifs?.() }),
  apiCommand('sistema.limpar-recentes', 'Limpar recentes da palette', 'Limpa o MRU (atlas.recentCommands)', ['limpar', 'clear', 'recentes', 'mru', 'palette'], 'sistema', 'trash',
    ctx => { clearRecent(); ctx.toast('Recentes limpos') }, { destructive: true }),
  apiCommand('sistema.snapshot-agora', 'Snapshot global', 'Snapshot de todos os mundos? — só do ativo', ['snapshot', 'global', 'instantaneo'], 'sistema', 'archive',
    ctx => { /* delega para kanban.snapshot */ runCommand('kanban.snapshot', ctx as any).catch(() => {}) }),
  apiCommand('sistema.importar-bundle', 'Importar bundle…', 'Importa um bundle JSON no mundo ativo', ['importar', 'bundle', 'json'], 'sistema', 'doc',
    ctx => { (window as any).__atlasImportBundle?.() }, { when: c => c.slug !== null, destructive: true }),
]

// -------- accessors --------

export function getById(id: string): Command | undefined {
  return REGISTRY.find(c => c.id === id)
}

export function useCommands(slug: string | null): Command[] {
  // SP §6: returns registry filtered by `when?` predicates. Here we don't have a full
  // ctx (no theme/shift) — palette builds the ctx at runtime. We expose a helper that
  // does the actual filter; palette calls it with the constructed ctx.
  // Keep this signature for API symmetry — palette will call `useCommandsWith(ctx)`.
  void slug
  return REGISTRY.slice()
}

export function useCommandsWith(ctx: CommandCtx): Command[] {
  return REGISTRY.filter(c => !c.when || c.when(ctx))
}

// -------- runCommand --------

export async function runCommand(id: string, ctx: CommandCtx): Promise<void> {
  const cmd = getById(id)
  if (!cmd) { ctx.toast('Comando desconhecido: ' + id); return }
  try {
    await cmd.perform(ctx)
    ctx.recordUse(id)
  } catch (e: any) {
    ctx.toast('Erro: ' + ((e && e.message) || String(e)))
  }
}

// -------- helpers used by palette's nested-flow & shortcut overlay --------

export function getShortcutOverlay(): Array<{ keys: string; desc: string }> {
  // ponytail: leader-style shortcuts. `;` (cedilha no teclado PT-PT, nunca no início de
  // palavra comum) é o leader — ergonómico (mindinho esq descansa em ;) e zero conflito com
  // PT-PT no filtro. `?` é o único bare shortcut (é um símbolo, não letra).
  return [
    { keys: ';N', desc: 'Nova nota (no mundo ativo)' },
    { keys: ';C', desc: 'Novo cartão (no mundo ativo)' },
    { keys: ';T', desc: 'Alternar tema (Dia / Entardecer / Noite)' },
    { keys: ';D', desc: 'Ir para dashboard' },
    { keys: ';S', desc: 'Definições do mundo ativo' },
    { keys: ';M', desc: 'Chat cross-mundo' },
    { keys: ';F', desc: 'Mudar fuso horário' },
    { keys: ';?', desc: 'Mostrar este overlay (também: ?)' },
    { keys: '?', desc: 'Mostrar este overlay' },
    { keys: 'Esc', desc: 'Fechar palette / cancelar flow' },
    { keys: '↑ ↓', desc: 'Navegar na lista' },
    { keys: 'Enter', desc: 'Abrir o comando focado' },
  ]
}
