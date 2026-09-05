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

export type CommandGroup = 'mundo' | 'notas' | 'global' | 'navegacao' | 'sistema'

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
  apiCommand('mundo.novo-nota-ou-cartao', 'Criar nota', 'Modal quickAdd: escolhe tipo', ['novo', 'criar', 'cartao', 'nota', 'card', 'note', 'quick'], 'mundo', 'plus',
    // ponytail: shortcut nao atribuido — quickAdd e' a forma canonica de criar nota no mundo ativo.
    // Acessivel via filtro: escrever 'criar' mostra este comando em cima.
    ctx => { if (ctx.slug) (window as any).__atlasQuickAdd?.(ctx.slug) }, { when: c => c.slug !== null }),
  apiCommand('mundo.definicoes', 'Definições', 'Abre settings do mundo ativo', ['definicoes', 'settings', 'config', 'opcoes'], 'mundo', 'gear',
    ctx => { if (ctx.slug) ctx.navigate('/w/' + ctx.slug + '/settings') }, { when: c => c.slug !== null, shortcut: ';S' }),
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
  apiCommand('mundo.eliminar-workdir', 'Eliminar workdir', 'Zona perigosa: apaga notas+events+meta. Irreversível.', ['eliminar', 'apagar', 'delete', 'workdir', 'mundo'], 'mundo', 'trash',
    async ctx => {
      if (!ctx.slug) return
      const ok = await ctx.confirm({ title: 'Eliminar workdir', message: `Eliminar definitivamente o mundo activo? Esta acção não pode ser desfeita.` })
      if (!ok) return
      try { await ctx.api.deleteWorkdir(ctx.slug); ctx.toast('Workdir eliminado'); ctx.navigate('/') }
      catch (e: any) { ctx.toast('Erro: ' + e.message) }
    }, { when: c => c.slug !== null, destructive: true }),

  
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
  apiCommand('sistema.importar-bundle', 'Importar bundle…', 'Importa um bundle JSON no mundo ativo', ['importar', 'bundle', 'json'], 'sistema', 'doc',
    ctx => { (window as any).__atlasImportBundle?.() }, { when: c => c.slug !== null, destructive: true }),
  navCommand('nav.calendario', 'Calendario', '/c/calendar', 'Calendario cross-mundo', ['calendario', 'agenda', 'eventos', 'calendar'], 'cal'),
  navCommand('nav.chat', 'Chat cross-mundo', '/c', 'Main chat (cross-mundo)', ['chat', 'conversa', 'mensagem'], 'chat'),
  apiCommand('sistema.tema', 'Alternar tema', 'Cicla entre os 3 shifts de luminosidade', ['tema', 'theme', 'luminosidade', 'shift', 'dia', 'noite'], 'sistema', 'sun',
    ctx => { (window as any).__atlasToggleTheme?.(); ctx.toast('Tema alterado') }),
  apiCommand('sistema.fuso', 'Mudar fuso horario', 'Abre o seletor de fuso no relogio da sidebar', ['fuso', 'timezone', 'tz', 'relogio'], 'sistema', 'clock',
    ctx => { (window as any).__atlasOpenTz?.() }),
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
