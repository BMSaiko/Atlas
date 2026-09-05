import { api, Card } from '../api'
import { icon } from './icons'
import { navigate } from '../router'
import { launchRun } from '../views/kanban-vanilla'
import { quickAdd, newWorkdir } from '../views/shell-vanilla'
import { confirmDialog } from './confirm'
import { toast } from './toast'
import { openModal, readForm } from './modal'
import { renderMd } from './text'
import { REGISTRY, runCommand, recordUse, getRecent, useCommandsWith, getShortcutOverlay } from '../lib/commands'

// ponytail: palette keyboard-first (Ctrl+K). Overlay proprio (nao reusa openModal — obriga <form>
// + submit). Reutiliza: navigate (deep-link de workspace.ts p/ reabrir nota/cartao), quickAdd,
// newWorkdir e launchRun (o MESMO lançador dos botoes -> resultado identico ao clique).
type Item = { group: string; icon: string; title: string; sub?: string; search: string; run: () => void }

// ponytail: bridges do registry (commands.ts) -> funcoes ja implementadas aqui em palette.ts.
// O registry chama `window.__atlas*` em vez de importar diretamente para evitar ciclo
// (palette -> views -> kanban-vanilla -> palette). As funcoes sao exportadas e registradas
// pelo openPalette() uma vez (idempotente via flag).
function installBridges(slug: string | null, boardRef: { current: { ver: number; cards: Card[] } | null }, ctxRef: { current: any }) {
  const w = window as any
  if (w.__atlasBridgesInstalled) return
  w.__atlasBridgesInstalled = true
  w.__atlasNewWorkdir = () => newWorkdir()
  w.__atlasQuickAdd = (s: string) => quickAdd(s)
  w.__atlasNewNote = (s: string) => openNewNoteFromPalette(s)
  w.__atlasNewCard = (s: string) => openNewCardFromPalette(s)
  w.__atlasBrainstorm = () => runSkillCard(slug!, 'grill-me', SKILL_PROMPT_GRILL_ME)  // brainstorm = grill-me (UI reusa a skill)
  w.__atlasImportRoadmap = () => openImportRoadmap(slug!)
  w.__atlasShowArchived = () => (document.getElementById('karch') as HTMLButtonElement | null)?.click()
  w.__atlasToggleNotesArchived = () => toggleNotesArchived()
  w.__atlasToggleNotesBulk = () => toggleNotesBulk()
  w.__atlasToggleKanbanBulk = () => toggleKanbanBulk()
  w.__atlasAddColumn = () => addColumnFromPalette(slug!)
  w.__atlasSaveColumns = () => saveColumnsFromPalette(slug!)
  w.__atlasExportBundle = () => exportBundleFromPalette(slug!)
  w.__atlasImportBundle = () => importBundleFromPalette(slug!)
  w.__atlasToggleTheme = () => toggleTheme()
  w.__atlasToggleShift = () => toggleShift()
  w.__atlasToggleSeason = () => toggleSeason()
  w.__atlasOpenTz = () => openTz()
  w.__atlasRequestNotifs = () => requestBrowserNotifs()
  w.__atlasGitOp = (s: string, op: string) => paletteGitOp(s, op)
  w.__atlasOpenHelp = (title: string, md: string) => showHelpModal(title, md)
  w.__atlasRunSkill = (s: string, skill: string, tpl: string) => runSkillCard(s, skill, tpl)
  w.__atlasRunPaletteCard = (s: string, c: Card) => runPaletteCard(s, boardRef.current!, c)
  // Per-card dispatchers — encontram o botão contextual no card aberto e clicam-no.
  // O card aberto tem `data-card-act="..."` em cada botão (kanban-vanilla pinta-os).
  w.__atlasCorrerCardFocus = (s: string | null) => focusAndClick(s, '[data-card-act="run"]', 'Executar')
  w.__atlasReiniciarCardFocus = (s: string | null) => focusAndClick(s, '[data-card-act="run"]', 'Reiniciar')
  w.__atlasGerarDpFocus = (s: string | null) => focusAndClick(s, '[data-card-act="dp"]', 'Gerar DP')
  w.__atlasVerTerminalFocus = (s: string | null) => focusAndClick(s, '[data-card-act="term"]', 'Ver terminal')
  w.__atlasReplyCardFocus = (s: string | null) => focusAndClick(s, '[data-card-act="reply"]', 'Reply')
  // Chat bridges — clicam nos botões pelo id (não há modal aberto, é a vista principal).
  w.__atlasChatNew = () => (document.getElementById('chat-new') as HTMLButtonElement | null)?.click()
  w.__atlasChatClear = () => (document.getElementById('chat-clear') as HTMLButtonElement | null)?.click()
  w.__atlasChatSend = () => (document.querySelector<HTMLFormElement>('#chat-composer') as HTMLFormElement | null)?.requestSubmit()
  void ctxRef
}

function focusAndClick(_slug: string | null, sel: string, fallback: string) {
  // procura o botão dentro do card aberto (modais `.kcard.open` / `.kmodal`)
  const root = document.querySelector('.kcard.open, .kmodal, .kdetail, .modal .kcard') as HTMLElement | null
  const btn = root?.querySelector<HTMLButtonElement>(sel)
  if (btn) { btn.click(); return }
  // fallback: toast informativo + navigate p/ tab kanban (sem card aberto, não faz nada)
  toast('Abre o cartão primeiro para ' + fallback)
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// --- bridge implementations ---

async function openNewNoteFromPalette(slug: string) {
  const { openNewNoteModal } = await import('../views/notes-vanilla')
  openNewNoteModal(slug)
}

async function openNewCardFromPalette(slug: string) {
  const { openNewCardModal } = await import('../views/kanban-vanilla')
  openNewCardModal(slug)
}

function toggleNotesArchived() {
  const btn = document.getElementById('narch') as HTMLButtonElement | null
  btn?.click()
}

function toggleNotesBulk() {
  const btn = document.getElementById('nsel') as HTMLButtonElement | null
  btn?.click()
}

function toggleKanbanBulk() {
  const btn = document.getElementById('ksel') as HTMLButtonElement | null
  btn?.click()
}

async function openImportRoadmap(slug: string) {
  // ponytail: importa o handler direto do kanban-vanilla (lazy)
  const m = openModal({
    title: 'Importar roadmap', submitText: 'Importar',
    body: () => `<div class="field"><label for="ir-path">Caminho do .md</label><input id="ir-path" name="path" placeholder="C:\\path\\roadmap.md" required autofocus></div>`,
  })
  const form = m.root.querySelector('form')!
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const path = readForm(form).path?.trim()
    if (!path) return
    m.close()
    try {
      const r = await api.importRoadmap(slug, path)
      toast(`Roadmap importado — +${r.addedCards} cartões, +${r.addedNotes} notas (${r.skipped} ignorados)`)
    } catch (e: any) { toast('Erro: ' + e.message) }
  })
}

async function addColumnFromPalette(slug: string) {
  // delega ao settings (que tem a fonte de verdade do board.columns).
  navigate('/w/' + slug + '/settings')
  toast('Adiciona coluna na vista de Definições')
}

async function saveColumnsFromPalette(slug: string) {
  navigate('/w/' + slug + '/settings')
  toast('Guarda colunas na vista de Definições')
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
      <input class="palette-input" type="text" placeholder="Procurar workdir, nota, cartão ou ação…   (↑↓ navegar · Enter abrir · Esc fechar · ? atalhos · ; letra · ç também)" aria-label="Filtro da palette" autocomplete="off">
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
  const boardRef = { current: null as { ver: number; cards: Card[] } | null }
  const ctxRef = { current: null as any }
  installBridges(slug, boardRef, ctxRef)

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

  // ===== async load (workdirs + notes/cards do ativo) — dynamic, nao registry =====
  ;(async () => {
    const workdirs: Array<{ slug: string; name: string }> = await api.workdirs().catch(() => [] as any)
    workdirs.forEach(w => push('Workdirs', 'sphere', w.name, 'workdir ' + w.name + ' ' + w.slug,
      () => { close(); navigate('/w/' + w.slug) }, w.slug))
    if (slug) {
      const [notes, board] = await Promise.all([
        api.notes.get(slug).catch(() => null), api.kanban.get(slug).catch(() => null),
      ])
      if (board) boardRef.current = board
      notes?.items.forEach(n => { if (!n.archived) push('Notas', 'note', n.title, 'nota ' + n.title,
        () => { close(); navigate('/w/' + slug + '?tab=notes&open=' + n.id) }, 'Nota') })
      board?.cards.forEach(c => { if (c.archived) return
        push('Cartões', 'board', c.title, 'cartao ' + c.title,
          () => { close(); navigate('/w/' + slug + '?tab=kanban&open=' + c.id) }, 'Cartão')
        if (c.colId === 'todo' || c.colId === 'doing')
          push('Ações', 'play', 'Correr: ' + c.title, 'correr executar ' + c.title,
            () => { close(); runPaletteCard(slug, board!, c) },
            c.colId === 'doing' ? 'reiniciar' : 'executar')
      })
    }

    // ===== recent items header (top, empty state) =====
    // SP §4: after running "Criar cartão ou nota" once, it appears at the top with a "Recentes" header.
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
  return { mundo: 'Mundo', notas: 'Notas', kanban: 'Kanban', global: 'Global', navegacao: 'Navegação', sistema: 'Sistema' }[g] || g
}

// ponytail: espelha o runCard da vista kanban p/ o resultado ser identico ao clique nos botoes
// (lança o run + move o card para 'doing' + PUT). Usa o board ja carregado (tem a etag `ver`).
async function runPaletteCard(slug: string, board: { ver: number; cards: Card[] }, c: Card) {
  if (!(await launchRun(slug, c))) return
  c.colId = 'doing'; c.startedAt = Date.now()
  await api.kanban.put(slug, board as any).catch(() => {})
  navigate('/w/' + slug + '?tab=kanban')
}

// paletteGitOp: handler partilhado para items "Merge to main" / "Resolve conflito" da palette.
// POST arranca headless; abre modal com stream offset-based do log (viewGitTerm). op 'resolve'
// mapeia para log id 'resolve-conflict' (route != log). Duplicado de workspace.ts (gitOp/viewGitTerm)
// porque mover para módulo neutro é mais código que esta cópia — YAGNI.
function paletteGitOp(slug: string, op: string) {
  const opId = op === 'resolve' ? 'resolve-conflict' : op
  const label = op === 'resolve' ? 'Resolve merge conflito' : 'Merge dev → main'
  fetch(`/api/w/${slug}/git/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    .then(r => r.json()).then((d: any) => {
      if (d && d.ok) { toast('A ' + label + ' em segundo plano (headless)'); viewGitTerm(slug, opId, label) }
      else toast((d && d.error) || 'Erro ao iniciar ' + label)
    }).catch(() => toast('Falha ao iniciar ' + label))
}

function viewGitTerm(slug: string, opId: string, label: string) {
  let offset = 0
  let pre = document.createElement('pre')
  pre.className = 'term-view'
  pre.textContent = ''
  let timer: ReturnType<typeof setInterval> | undefined
  const body = () => `<div class="term-wrap">${pre.outerHTML}<div class="term-status" id="${opId}-gstatus">ainda não lançada</div></div>`
  const m = openModal({ title: label + ' · ' + slug, submitText: 'Fechar', cancelText: 'Fechar', body, onSubmit: () => { if (timer) clearInterval(timer) } })
  pre = m.root.querySelector('.term-view') as HTMLPreElement
  const statusEl = m.root.querySelector('.term-status') as HTMLElement
  const tick = async () => {
    try {
      const d = await api.run.output(slug, opId, offset)
      if (d) {
        if (d.chunk) { pre.textContent += d.chunk; pre.scrollTop = pre.scrollHeight }
        offset = d.offset
        if (d.done) {
          if (timer) clearInterval(timer)
          statusEl.textContent = d.code === 0 ? 'concluído ✓' : ('terminou com erro (código ' + d.code + ') — vê o log acima')
          statusEl.classList.toggle('err', !!(d.code !== 0))
          return
        }
        if (d.started === false && !pre.textContent) { statusEl.textContent = 'ainda não lançada'; return }
        statusEl.textContent = '● a trabalhar (update 1s)'
      }
    } catch { /* aguenta — server pode reiniciar */ }
  }
  timer = setInterval(tick, 1000)
  tick()
  const obs = new MutationObserver(() => { if (!m.root.isConnected) { if (timer) clearInterval(timer); obs.disconnect() } })
  obs.observe(document.body, { childList: true })
}

// ponytail: card grill-me-palette — cria card com skills[] pré-preenchido, prompt template
// do mundo (nome+descrição do workdir), e corre. Idêntico ao runPaletteCard mas cria o card.
async function runSkillCard(slug: string, skill: string, promptTemplate: string) {
  try {
    const [board, wdm] = await Promise.all([
      api.kanban.get(slug).catch(() => null),
      api.meta(slug).catch(() => null),
    ])
    if (!board) { toast('Kanban nao carregou'); return false }
    const ctx = {
      slug,
      name: (wdm && wdm.name) || slug,
      description: (wdm && wdm.description) || '',
    }
    // ponytail: input do objetivo/decisão antes de criar o card (reusa openModal — rung 2)
    const goal = await new Promise<string | null>(resolve => {
      const m = openModal({
        title: skill === 'grill-me' ? 'Grill-me: qual o plano?' : 'Grilling: qual a decisão?',
        body: () => '<div class="field"><label for="grill-q">Objetivo / decisão</label>' +
          '<textarea id="grill-q" name="goal" rows="6" autofocus placeholder="Descreve em 2-5 linhas…"></textarea></div>',
        submitText: 'Iniciar grilling',
        cancelText: 'Cancelar',
      })
      const form = m.root.querySelector('form')!
      form.addEventListener('submit', e => { e.preventDefault(); resolve(readForm(form).goal?.trim() || null); m.close() })
      m.root.querySelector('[data-act=cancel]')!.addEventListener('click', () => { resolve(null); m.close() })
    })
    if (goal === null) { return false }  // ponytail: cancel = no-op
    const desc = promptTemplate
      .replace(/\${{slug}}/g, ctx.slug)
      .replace(/\${{wdm\.name}}/g, ctx.name)
      .replace(/\${{wdm\.description}}/g, ctx.description || '(sem descricao)')
      .replace(/<descreve[\s\S]*?>/i, goal)  // ponytail: substitui placeholder pelo input
    const newCard: Card = {
      id: Math.random().toString(36).slice(2, 10),
      colId: 'todo',
      title: skill === 'grill-me' ? 'Grill-me: plano' : 'Grilling: decisao',
      description: desc,
      priority: 'medium' as const,
      ts: Date.now(),
      archived: false,
      // ponytail: headless (sem skills) — terminal do wezterm-gui é desnecessário. Reply é via modal da UI.
    }
    board.cards.push(newCard)
    const saved = await api.kanban.put(slug, board)
    if (saved && saved.ver) board.ver = saved.ver
    const ok = await launchRun(slug, newCard)
    if (!ok) return false
    newCard.colId = 'doing'; newCard.startedAt = Date.now()
    await api.kanban.put(slug, board).catch(() => {})
    navigate('/w/' + slug + '?tab=kanban')
    return true
  } catch (e) {
    toast('Erro skill: ' + ((e as any)?.message || String(e)))
    return false
  }
}

// ponytail: card FAQ-and-how-to — abre modal com markdown renderizado. openModal ja tem scroll
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

// FAQ — 6 Q&A curtas, sem rodeios. Texto honesto, alinhado com o codebase (palette, kanban, notes).
const FAQ_MD = [
  '## FAQ — perguntas frequentes',
  '',
  '**1. O que é o ATLAS?**',
  'Atlas é um dashboard para gerir **mundos** (workdirs). Cada mundo tem kanban + notas + terminais + git isolados.',
  '',
  '**2. Como abro o common palette?**',
  'Ctrl+K em qualquer vista. Pesquisa workdirs, notas, cartões ou ações.',
  '',
  '**3. Como crio um cartão novo?**',
  'Ctrl+K → "Novo nota ou cartão" (ou no palette, escreve "novo"). Funciona dentro de um mundo.',
  '',
  '**4. Onde ficam guardados os dados?**',
  'Em `data/atlas/<slug>/` dentro deste repo: `kanban.json` + `notes/`. Tudo em git, versionado.',
  '',
  '**5. Como corro um agente (DR/DP/DA) num cartão?**',
  'Botão ▶ no cartão ou Ctrl+K → "Correr: <título>". Abre WezTerm headless e stream do log fica no card.',
  '',
  '**6. E se um cartão fica preso em "doing"?**',
  'Ctrl+K → "Matar terminais deste mundo". Limpa WezTerm órfão. Cartão passa a `todo` na próxima ação.',
  '',
  '**7. Como vejo o histórico de runs?**',
  'Cartão aberto → secção `kresult` (resultado). Cada run fica como bloco com output markdown.',
  '',
  '**8. Posso ter vários mundos ao mesmo tempo?**',
  'Sim. Sidebar esquerda lista todos. Cada um com o seu kanban/notas/git independentes.',
  '',
].join('\n')

// HOWTO — passos numerados, fluxo real: criar mundo -> cartão -> correr -> review -> done.
const HOWTO_MD = [
  '## How to use — guia rápido',
  '',
  '### 1. Criar um mundo novo',
  '- Sidebar esquerda → **+ Novo mundo** (ou Ctrl+K → "Novo mundo").',
  '- Dá um nome + descrição curta. Aparece na sidebar com a sua orb.',
  '',
  '### 2. Adicionar um cartão',
  '- Abre o mundo → separador **Kanban**.',
  '- Ctrl+K → "Novo nota ou cartão" (ou clica no header).',
  '- Escreve título + descrição (markdown é renderizado).',
  '',
  '### 3. Correr o cartão (DR / DP / DA)',
  '- Cartão em `todo` → botão ▶ / Ctrl+K → "Correr: …".',
  '- Cartão passa para `doing` automaticamente.',
  '- Output chega como blocos `kresult` no próprio cartão (markdown).',
  '',
  '### 4. Rever e aprovar',
  '- Quando o run termina, cartão vai para **Revisão**.',
  '- Abre o cartão → botões **Aprovar** / **Refinar**.',
  '- Aprovar → `done`. Refinar → volta a `doing` com o teu feedback.',
  '',
  '### 5. Notas',
  '- Separador **Notas** dentro do mundo.',
  '- Markdown livre, links `[[wiki]]` entre notas (ver 4.5).',
  '- Atalhos: Ctrl+K → "Notas" filtra e abre.',
  '',
  '### 6. Git',
  '- Ctrl+K → "Merge to main" (merge dev → main headless).',
  '- Ctrl+K → "Resolve conflito" se o merge falhar.',
  '- Output abre em modal com stream do log.',
  '',
  '### 7. Atalhos úteis',
  '- **Ctrl+K** — common palette',
  '- **Esc** — fechar modal/palette',
  '- **Ctrl+Enter** — submeter modal',
  '',
].join('\n')

const SKILL_PROMPT_GRILL_ME = [
  '# Atlas world: ${{wdm.name}}',
  '',
  'Skill: grill-me (entry point). Carrega a skill "grilling" e interrogar-me sobre o plano/decisao que descrevo abaixo. Trabalha em rounds (frontier), nao shotgun. Quando a frontier esvaziar, confirma a compreensao partilhada e espera. NAO atues sem confirmacao.',
  '',
  '## Contexto',
  '- Mundo: ${{wdm.name}} (slug: ${{slug}})',
  '- Descricao: ${{wdm.description}}',
  '',
  '## O que quero grillar',
  '<descreve o plano / decisao / design que queres stress-test>',
  '',
  '## Notas no fim',
  'Quando acabares, cria notas em /api/w/${{slug}}/notes com cada decisao settled (1 nota por decisao; tags: grilled, decision).',
].join('\n')

const SKILL_PROMPT_GRILLING = [
  '# Atlas world: ${{wdm.name}}',
  '',
  'Skill grilling carregada. Stress-test continuo da decisao que descrevo abaixo. Mesmas regras da skill: design tree, rounds, frontier, nao atues sem confirmacao partilhada.',
  '',
  '## Contexto',
  '- Mundo: ${{wdm.name}} (slug: ${{slug}})',
  '- Descricao: ${{wdm.description}}',
  '',
  '## A decisao a stress-test',
  '<descreve a decisao>',
  '',
  '## Notas no fim',
  'Mesma convencao: 1 nota por decisao settled, tags grilled + decision.',
].join('\n')
