import { api } from '../api'
import { icon } from './icons'
import { navigate } from '../router'
import { quickAdd, newWorkdir } from '../views/shell-vanilla'
import { confirmDialog } from './confirm'
import { toast } from './toast'
import { openModal, readForm } from './modal'
import { renderMd } from './text'
import { REGISTRY, runCommand, recordUse, getRecent, useCommandsWith, getShortcutOverlay } from '../lib/commands'

// ponytail: palette keyboard-first (Ctrl+K). Overlay proprio (nao reusa openModal — obriga <form>
// + submit). Reutiliza: navigate (deep-link de workspace para reabrir nota), quickAdd + newWorkdir
// (fontes unicas para criar).
type Item = { group: string; icon: string; title: string; sub?: string; search: string; run: () => void }

// ponytail: bridges do registry (commands.ts) -> funcoes ja implementadas aqui em palette.
// O registry chama `window.__atlas*` em vez de importar diretamente para evitar ciclo.
// As funcoes sao exportadas e registradas pelo openPalette() uma vez (idempotente via flag).
function installBridges(slug: string | null, ctxRef: { current: any }) {
  const w = window as any
  if (w.__atlasBridgesInstalled) return
  w.__atlasBridgesInstalled = true
  w.__atlasNewWorkdir = () => newWorkdir()
  w.__atlasQuickAdd = (s: string) => quickAdd(s)
  w.__atlasNewNote = (s: string) => openNewNoteFromPalette(s)
  w.__atlasImportBundle = () => importBundleFromPalette(slug!)
  w.__atlasExportBundle = () => exportBundleFromPalette(slug!)
  w.__atlasToggleTheme = () => toggleTheme()
  w.__atlasToggleShift = () => toggleShift()
  w.__atlasToggleSeason = () => toggleSeason()
  w.__atlasOpenTz = () => openTz()
  w.__atlasRequestNotifs = () => requestBrowserNotifs()
  w.__atlasOpenHelp = (title: string, md: string) => showHelpModal(title, md)
  // Chat bridges — clicam nos botões pelo id (não há modal aberto, é a vista principal).
  w.__atlasChatNew = () => (document.getElementById('chat-new') as HTMLButtonElement | null)?.click()
  w.__atlasChatClear = () => (document.getElementById('chat-clear') as HTMLButtonElement | null)?.click()
  w.__atlasChatSend = () => (document.querySelector<HTMLFormElement>('#chat-composer') as HTMLFormElement | null)?.requestSubmit()
  void ctxRef
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// --- bridge implementations ---

async function openNewNoteFromPalette(slug: string) {
  const { openNewNoteModal } = await import('../views/notes-vanilla')
  openNewNoteModal(slug)
}

function toggleTheme() {
  // alterna theme/shift via indicador da sidebar (shift-ind click handler)
  const ind = document.getElementById('shift-ind')
  ind?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function toggleShift() { toggleTheme() }  // alias — shift-ind e' o toggle de luminosidade

function toggleSeason() {
  const ind = document.getElementById('season-ind')
  ind?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function openTz() {
  const el = document.getElementById('clock-tz')
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

async function requestBrowserNotifs() {
  const { requestNotifs } = await import('./notifs')
  const st = await requestNotifs()
  if (st === 'granted') toast('Notificações ativadas')
  else if (st === 'denied') toast('Notificações bloqueadas no navegador')
}

async function exportBundleFromPalette(slug: string) {
  try {
    const b = await api.bundle.get(slug)
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ymd = new Date().toISOString().slice(0, 10)
    a.href = url; a.download = `atlas-${slug}-${ymd}.json`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast('Bundle exportado')
  } catch (err: any) { toast('Erro a exportar: ' + err.message) }
}

async function importBundleFromPalette(slug: string) {
  navigate('/w/' + slug + '/settings')
  toast('Importa bundle na vista de Definições')
}

// --- main openPalette ---

export function openPalette(slug: string | null) {
  if (document.querySelector('.palette-backdrop')) return
  const backdrop = document.createElement('div')
  backdrop.className = 'palette-backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')
  backdrop.setAttribute('aria-label', 'Palette de comandos')
  backdrop.innerHTML = `
    <div class="palette">
      <input class="palette-input" type="text" placeholder="Procurar workdir, nota ou ação…   (↑↓ navegar · Enter abrir · Esc fechar · ? atalhos · ; letra · ç também)" aria-label="Filtro da palette" autocomplete="off">
      <div class="palette-list"><div class="palette-empty">A carregar…</div></div>
    </div>`
  document.body.appendChild(backdrop)
  const input = backdrop.querySelector('.palette-input') as HTMLInputElement
  const list = backdrop.querySelector('.palette-list') as HTMLElement
  input.focus()

  let items: Item[] = []
  let active = 0
  let closed = false
  const close = () => { if (closed) return; closed = true; backdrop.remove(); (window as any).__atlasPaletteOpen = false }

  // state hook para shell-vanilla (per-group shortcuts)
  ;(window as any).__atlasPaletteOpen = true

  // install bridges (once)
  const ctxRef = { current: null as any }
  installBridges(slug, ctxRef)

  const push = (g: string, iconName: string, title: string, search: string, run: () => void, sub?: string) =>
    items.push({ group: g, icon: iconName, title, sub, search, run })

  // ===== registry → items =====
  // SP §3: replace the inline push() block (lines 41-95 of the old file) with one loop over
  // useCommands(slug). All existing palette capabilities preserved through the registry.
  const recent = getRecent()
  const buildCtx = (): any => ({
    slug,
    theme: (document.documentElement.classList.contains('dark') ? 'dark' : 'light') as 'light' | 'dark',
    shift: (document.documentElement.dataset.shift || 'night') as 'day' | 'dusk' | 'night',
    season: document.documentElement.dataset.season || 'winter',
    navigate,
    toast,
    confirm: confirmDialog,
    api,
    recordUse,
  })

  function loadRegistry() {
    const ctx = buildCtx()
    const cmds = useCommandsWith(ctx)
    cmds.forEach(c => {
      const sub = c.shortcut ? undefined : c.sub  // atalho aparece à direita; sub fica PT-PT descritor
      push(groupLabel(c.group), c.icon, c.label, c.label + ' ' + c.keywords.join(' '),
        () => { close(); runCommand(c.id, ctx) }, sub)
    })
  }
  loadRegistry()

  // ===== async load (workdirs + notes do ativo) — dynamic, nao registry =====
  ;(async () => {
    const workdirs: Array<{ slug: string; name: string }> = await api.workdirs().catch(() => [] as any)
    workdirs.forEach(w => push('Workdirs', 'sphere', w.name, 'workdir ' + w.name + ' ' + w.slug,
      () => { close(); navigate('/w/' + w.slug) }, w.slug))
    if (slug) {
      const notes = await api.notes.get(slug).catch(() => null)
      notes?.items.forEach(n => { if (!n.archived) push('Notas', 'note', n.title, 'nota ' + n.title,
        () => { close(); navigate('/w/' + slug + '?tab=notes&open=' + n.id) }, 'Nota') })
    }

    // ===== recent items header (top, empty state) =====
    // SP §4: after running a command once, it appears at the top with a "Recentes" header.
    if (recent.length && !input.value.trim()) {
      const ctx = buildCtx()
      const recentItems: Item[] = []
      recent.forEach(rid => {
        const c = REGISTRY.find(x => x.id === rid)
        if (!c) return
        recentItems.push({ group: 'Recentes', icon: c.icon, title: c.label, search: c.label + ' ' + c.keywords.join(' '),
          run: () => { close(); runCommand(c.id, ctx) } })
      })
      // prepend Recentes block (will be visually grouped below)
      items = [...recentItems, ...items]
    }

    render()
  })()

  const visible = () => {
    const q = input.value.trim().toLowerCase()
    return q ? items.filter(it => it.search.toLowerCase().includes(q)) : items
  }
  // ponytail: `render` é uma function declaration — é hoisted, e o IIFE async pode chamar
  // sem problemas de TDZ. Mais limpo do que o padrao let+reassign.
  function render() {
    const vis = visible()
    if (!vis.length) { list.innerHTML = '<div class="palette-empty">Sem resultados</div>'; return }
    active = Math.min(active, vis.length - 1)
    let html = ''
    let last = ''
    vis.forEach((it, i) => {
      if (it.group !== last) { html += `<div class="palette-group">${esc(it.group)}</div>`; last = it.group }
      // SP §4: per-group shortcut hint rendered as <kbd> on the right.
      // We tag the originating command id via dataset; shortcut string comes from REGISTRY.
      const cmd = REGISTRY.find(c => c.label === it.title && c.icon === it.icon)
      const kbd = cmd?.shortcut
        ? `<kbd class="palette-kbd">${esc(cmd.shortcut.split(' ').map(k => `<kbd>${esc(k)}</kbd>`).join(' '))}</kbd>`
        : ''
      html += `<div class="palette-item${i === active ? ' active' : ''}" data-i="${i}" role="option" aria-selected="${i === active}">
        <span class="picon">${icon(it.icon as any, 16)}</span><span class="ptitle">${esc(it.title)}</span>${it.sub ? `<span class="psub">${esc(it.sub)}</span>` : ''}${kbd}</div>`
    })
    list.innerHTML = html
    list.querySelector('[data-i="' + active + '"]')?.scrollIntoView({ block: 'nearest' })
    list.querySelectorAll<HTMLElement>('.palette-item').forEach(el =>
      el.addEventListener('click', () => visible()[parseInt(el.getAttribute('data-i')!, 10)]?.run()))
  }

  input.addEventListener('input', () => { active = 0; render() })
  input.addEventListener('keydown', e => {
    const vis = visible()
    // SP §4 + §5 (ajustes 2026-09-05):
    // Bare-letter shortcuts colidem com PT-PT no filtro ("cartao", "criar", "git", "tema").
    // Ctrl+Alt + letra colide com OS (AltGr=@ em PT, Ctrl+Alt+M=Win+M, etc.).
    // Leader escolhido: tecla física Semicolon (à direita do L no QWERTY) — independente
    // do layout do user:
    //   - PT-PT: ';'/':' (semicolon key) — e.key === ';' ou ':'
    //   - US:    ';'/':' (mesma tecla) — e.key === ';' ou ':'
    //   - Outras: caem no e.code === 'Semicolon'
    // Match por physical code (e.code) cobre todos. e.key como fallback para PT-PT onde
    // a tecla pode produzir ç mas o user quer leader.
    if ((e.code === 'Semicolon' || e.key === ';' || e.key === ':')
        && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      const next = (e2: KeyboardEvent) => {
        input.removeEventListener('keydown', next as any)
        if (e2.ctrlKey || e2.metaKey || e2.altKey) return
        const k = e2.key.toUpperCase()
        const seq = ';' + k
        if (REGISTRY.find(c => c.shortcut === seq)) {
          e2.preventDefault(); close(); runShortcut(seq, buildCtx())
        }
        // se nao e' nenhum atalho registado, ignora (deixa o user continuar a escrever)
      }
      input.addEventListener('keydown', next as any)
      return
    }
    // `?` continua a ser o unico bare shortcut — e' um simbolo, nao uma letra, impossivel de
    // escrever "acidentalmente" como filtragem (e aparece no placeholder).
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') {
      e.preventDefault(); close(); showShortcutOverlay(); return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, vis.length - 1); render() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render() }
    else if (e.key === 'Enter') { e.preventDefault(); vis[active]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  })
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close() })

  function runShortcut(keys: string, ctx: any) {
    const cmd = REGISTRY.find(c => c.shortcut === keys)
    if (cmd) runCommand(cmd.id, ctx)
    else toast('Sem atalho para ' + keys)
  }

  function showShortcutOverlay() {
    const rows = getShortcutOverlay()
    const body = `<table class="help-overlay" style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left;padding:.4rem">Atalho</th><th style="text-align:left;padding:.4rem">Acção</th></tr>
      ${rows.map(r => `<tr><td style="padding:.3rem .4rem"><kbd>${esc(r.keys)}</kbd></td><td style="padding:.3rem .4rem">${esc(r.desc)}</td></tr>`).join('')}
    </table>`
    openModal({ title: 'Atalhos da palette · Ctrl+K', submitText: 'Fechar', cancelText: 'Fechar', body: () => body })
  }
}

// SP §6: group label PT-PT (já são labels dos comandos — usamos o id do grupo capitalizado).
function groupLabel(g: string): string {
  return { mundo: 'Mundo', notas: 'Notas', global: 'Global', navegacao: 'Navegação', sistema: 'Sistema' }[g] || g
}

// ponytail: help-and-how-to — abre modal com markdown renderizado. openModal ja tem scroll
// interno (.modal-body overflow-y:auto) + Esc/Ctrl+Enter — nao precisamos de chrome proprio.
function showHelpModal(title: string, md: string) {
  // SP §4: FAQ/HOWTO content lives in REGISTRY via modalCommand returning a sentinel;
  // resolve to the real markdown here. (sentinel = '__FAQ__' / '__HOWTO__')
  const real = md === '__FAQ__' ? FAQ_MD : md === '__HOWTO__' ? HOWTO_MD : md
  openModal({
    title,
    body: () => `<div class="md-view help-doc">${renderMd(real)}</div>`,
    submitText: 'Fechar',
    cancelText: 'Fechar',
  })
}

// FAQ — 6 Q&A curtas, sem rodeios. Texto honesto, alinhado com o codebase (palette, notas, settings).
const FAQ_MD = [
  '## FAQ — perguntas frequentes',
  '',
  '**1. O que é o ATLAS?**',
  ' Atlas é um dashboard para gerir **mundos** (workdirs). Cada mundo tem notas + calendário + git isolados.',
  '',
  '**2. Como abro o common palette?**',
  ' Ctrl+K em qualquer vista. Pesquisa workdirs, notas ou ações.',
  '',
  '**3. Como crio uma nota nova?**',
  ' Ctrl+K → "Criar nota ou cartão" (ou escreve "novo"). Funciona dentro de um mundo.',
  '',
  '**4. Onde ficam guardados os dados?**',
  ' Em `data/atlas/<slug>/` dentro deste repo: `notes.json` + `events.json` + `meta.json`. Tudo em git, versionado.',
  '',
  '**5. Posso ter vários mundos ao mesmo tempo?**',
  ' Sim. Sidebar esquerda lista todos. Cada um com as suas notas/calendário/git independentes.',
  '',
  '**6. Como sincronizo com a vault?**',
  ' As escritas em notes.json disparam um commit de 2s (debounce trailing) para `knowledge/projects/atlas/live-data`.',
  '',
].join('\n')

// HOWTO — passos numerados, fluxo real: criar mundo → nota → calendário → bundle.
const HOWTO_MD = [
  '## How to use — guia rápido',
  '',
  '### 1. Criar um mundo novo',
  '- Sidebar esquerda → **+ Novo mundo** (ou Ctrl+K → "Novo mundo").',
  '- Dá um nome + descrição curta. Aparece na sidebar com a sua orb.',
  '',
  '### 2. Adicionar uma nota',
  '- Abre o mundo → separador **Notas**.',
  '- Ctrl+K → "Criar nota ou cartão" (ou clica no header).',
  '- Escreve título + texto (markdown é renderizado).',
  '',
  '### 3. Calendário',
  '- Sidebar → **Calendário** (cross-mundo).',
  '- Vê os teus eventos num sotaque + pomodoro.',
  '',
  '### 4. Bundle (export/import)',
  '- Ctrl+K → "Exportar bundle" / "Importar bundle" (dentro de um mundo).',
  '- JSON com meta + notes + events para backup/restore.',
  '',
  '### 5. Atalhos úteis',
  '- **Ctrl+K** — common palette',
  '- **Esc** — fechar modal/palette',
  '- **Ctrl+Enter** — submeter modal',
  '',
].join('\n')
