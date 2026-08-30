import { api, Card } from '../api'
import { icon } from './icons'
import { navigate } from '../router'
import { launchRun } from '../views/kanban'
import { quickAdd, newWorkdir } from '../views/shell'
import { confirmDialog } from './confirm'
import { toast } from './toast'

// ponytail: palette keyboard-first (Ctrl+K). Overlay proprio (nao reusa openModal — obriga <form>
// + submit). Reutiliza: navigate (deep-link de workspace.ts p/ reabrir nota/cartao), quickAdd,
// newWorkdir e launchRun (o MESMO lançador dos botoes -> resultado identico ao clique).
type Item = { group: string; icon: string; title: string; sub?: string; search: string; run: () => void }

export function openPalette(slug: string | null) {
  if (document.querySelector('.palette-backdrop')) return
  const backdrop = document.createElement('div')
  backdrop.className = 'palette-backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')
  backdrop.setAttribute('aria-label', 'Palette de comandos')
  backdrop.innerHTML = `
    <div class="palette">
      <input class="palette-input" type="text" placeholder="Procurar workdir, nota, cartão ou ação…   (↑↓ navegar · Enter abrir · Esc fechar)" aria-label="Filtro da palette" autocomplete="off">
      <div class="palette-list"><div class="palette-empty">A carregar…</div></div>
    </div>`
  document.body.appendChild(backdrop)
  const input = backdrop.querySelector('.palette-input') as HTMLInputElement
  const list = backdrop.querySelector('.palette-list') as HTMLElement
  input.focus()

  let items: Item[] = []
  let active = 0
  let closed = false
  const close = () => { if (closed) return; closed = true; backdrop.remove() }

  const push = (g: string, iconName: string, title: string, search: string, run: () => void, sub?: string) =>
    items.push({ group: g, icon: iconName, title, sub, search, run })

  // Ações base — disponíveis mesmo sem workdir ativo (dashboard)
  push('Ações', 'sphere', 'Dashboard', 'dashboard inicio', () => { close(); navigate('/') })
  push('Ações', 'plus', 'Novo mundo', 'novo mundo criar', () => { close(); newWorkdir() })
  if (slug) {
    push('Ações', 'note', 'Novo nota ou cartão', 'novo nota cartao criar', () => { close(); quickAdd(slug) })
    push('Ações', 'gear', 'Definições', 'definicoes settings config', () => { close(); navigate('/w/' + slug + '/settings') })
    // ponytail: card terminal-control-v2 — abre wezterm no workdir ativo (palette Ctrl+K).
    push('Terminais', 'term', 'Abrir terminal WezTerm', 'abrir terminal wezterm cmd shell',
      () => { close()
        fetch('/api/terms/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'servidor stale — faz restart do vite' : ('HTTP ' + r.status))))
          .then((d: any) => toast(d.ok ? 'Terminal aberto' : ('Erro: ' + (d.error || 'desconhecido'))))
          .catch(e => toast('Erro: ' + e.message)) })
    // ponytail: card terminal-control-v2 — master kill cross-workdir. Confirm-dialog antes.
    push('Terminais', 'kill', 'Matar todos os terminais do ATLAS', 'matar terminais atlas kill all cross',
      async () => { close()
        const ok = await confirmDialog({ title: 'Matar todos os terminais ATLAS', message: 'Fecha todos os WezTerm abertos por qualquer workdir. Cards em doing passam a todo. Continuar?' })
        if (!ok) return
        try {
          const r = await fetch('/api/terms/kill-all-atlas', { method: 'POST' }).then(r => r.json())
          const k = (r && typeof r.killed === 'number') ? r.killed : 0
          const w = (r && typeof r.worlds === 'number') ? r.worlds : 0
          toast(k > 0 ? `${k} terminais fechados em ${w} mundo${w !== 1 ? 's' : ''}` : 'Nenhum terminal aberto')
        } catch (e: any) { toast('Erro: ' + (e?.message || e)) } })
  }

  const visible = () => {
    const q = input.value.trim().toLowerCase()
    return q ? items.filter(it => it.search.toLowerCase().includes(q)) : items
  }
  const render = () => {
    const vis = visible()
    if (!vis.length) { list.innerHTML = '<div class="palette-empty">Sem resultados</div>'; return }
    active = Math.min(active, vis.length - 1)
    let html = ''
    let last = ''
    vis.forEach((it, i) => {
      if (it.group !== last) { html += `<div class="palette-group">${esc(it.group)}</div>`; last = it.group }
      html += `<div class="palette-item${i === active ? ' active' : ''}" data-i="${i}" role="option" aria-selected="${i === active}">
        <span class="picon">${icon(it.icon as any, 16)}</span><span class="ptitle">${esc(it.title)}</span>${it.sub ? `<span class="psub">${esc(it.sub)}</span>` : ''}</div>`
    })
    list.innerHTML = html
    list.querySelector('[data-i="' + active + '"]')?.scrollIntoView({ block: 'nearest' })
    list.querySelectorAll<HTMLElement>('.palette-item').forEach(el =>
      el.addEventListener('click', () => visible()[parseInt(el.getAttribute('data-i')!, 10)]?.run()))
  }

  input.addEventListener('input', () => { active = 0; render() })
  input.addEventListener('keydown', e => {
    const vis = visible()
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, vis.length - 1); render() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render() }
    else if (e.key === 'Enter') { e.preventDefault(); vis[active]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  })
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close() })

  // carga assincrona dos dados: workdirs todos (navegação) + notas/cards do workdir ativo
  ;(async () => {
    const workdirs: Array<{ slug: string; name: string }> = await api.workdirs().catch(() => [])
    workdirs.forEach(w => push('Workdirs', 'sphere', w.name, 'workdir ' + w.name + ' ' + w.slug,
      () => { close(); navigate('/w/' + w.slug) }, w.slug))
    if (slug) {
      const [notes, board] = await Promise.all([
        api.notes.get(slug).catch(() => null), api.kanban.get(slug).catch(() => null),
      ])
      notes?.items.forEach(n => { if (!n.archived) push('Notas', 'note', n.title, 'nota ' + n.title,
        () => { close(); navigate('/w/' + slug + '?tab=notes&open=' + n.id) }, 'Nota') })
      board?.cards.forEach(c => { if (c.archived) return
        push('Cartões', 'board', c.title, 'cartao ' + c.title,
          () => { close(); navigate('/w/' + slug + '?tab=kanban&open=' + c.id) }, 'Cartão')
        if (c.colId === 'todo' || c.colId === 'doing')
          push('Ações', 'play', 'Correr: ' + c.title, 'correr executar ' + c.title,
            () => { close(); runPaletteCard(slug, board, c) },
            c.colId === 'doing' ? 'reiniciar' : 'executar')
      })
    }
    render()
  })()
}

// ponytail: espelha o runCard da vista kanban p/ o resultado ser identico ao clique nos botoes
// (lança o run + move o card para 'doing' + PUT). Usa o board ja carregado (tem a etag `ver`).
async function runPaletteCard(slug: string, board: { ver: number; cards: Card[] }, c: Card) {
  if (!(await launchRun(slug, c))) return
  c.colId = 'doing'; c.startedAt = Date.now()
  await api.kanban.put(slug, board as any).catch(() => {})
  navigate('/w/' + slug + '?tab=kanban')
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
