import { api, Card, Nota } from '../api'
import { icon } from '../ui/icons'
import { navigate } from '../router'

interface Wd { slug: string; name: string; description?: string; icon?: string }
interface Row { wd: Wd; notes: Nota[]; board: { columns: { id: string; name: string }[]; cards: Card[] } }
interface Tally {
  notes: number; notesArch: number
  todo: number; doing: number; review: number; done: number; arch: number
}
const COL_LABEL: Record<string, string> = { todo: 'To Do', doing: 'Em Curso', review: 'Review', done: 'Concluído' }
const COL_ORDER: Array<'todo' | 'doing' | 'review' | 'done'> = ['todo', 'doing', 'review', 'done']

function tally(rows: Row[]): { total: Tally; byWd: Map<string, Tally> } {
  const total: Tally = { notes: 0, notesArch: 0, todo: 0, doing: 0, review: 0, done: 0, arch: 0 }
  const byWd = new Map<string, Tally>()
  for (const r of rows) {
    const t: Tally = { notes: 0, notesArch: 0, todo: 0, doing: 0, review: 0, done: 0, arch: 0 }
    t.notes = r.notes.length
    t.notesArch = r.notes.filter(n => n.archived).length
    for (const c of r.board.cards) {
      if (c.archived) t.arch++
      else if (c.colId === 'todo') t.todo++
      else if (c.colId === 'doing') t.doing++
      else if (c.colId === 'review') t.review++
      else if (c.colId === 'done') t.done++
    }
    total.notes += t.notes; total.notesArch += t.notesArch
    total.todo += t.todo; total.doing += t.doing; total.review += t.review; total.done += t.done; total.arch += t.arch
    byWd.set(r.wd.slug, t)
  }
  return { total, byWd }
}

function openCards(t: Tally) { return t.todo + t.doing + t.review }

function pipeline(total: Tally): string {
  const segs = COL_ORDER.map(id => ({ id, n: total[id] }))
  const grand = segs.reduce((a, s) => a + s.n, 0)
  const denom = grand || 1
  const bar = segs.map(s => `<span class="pipe-seg pipe-${s.id}" style="width:${(s.n / denom) * 100}%" title="${COL_LABEL[s.id]}: ${s.n}"></span>`).join('')
  const pctOf = (n: number) => (grand ? Math.round((n / grand) * 100) : 0)
  const steps = segs.map((s, i) => `
    <div class="pleg p-${s.id}" title="${COL_LABEL[s.id]}: ${s.n}">
      <span class="pleg-dot" aria-hidden="true"></span>
      <span class="pleg-n"><b>${s.n}</b><em>${pctOf(s.n)}%</em></span>
      <span class="pleg-l">${COL_LABEL[s.id]}</span>
    </div>${i < segs.length - 1 ? '<span class="pleg-flow" aria-hidden="true"></span>' : ''}`).join('')
  return `
    <div class="pipe">
      <div class="pipe-track">${bar}</div>
      <div class="pipe-legend">${steps}
        <span class="pleg-flow" aria-hidden="true"></span>
        <div class="pleg p-arch" title="Arquivados: ${total.arch}">
          <span class="pleg-dot" aria-hidden="true"></span>
          <span class="pleg-n"><b>${total.arch}</b><em>··</em></span>
          <span class="pleg-l">Arquivados</span>
        </div>
      </div>
    </div>`
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}
// ponytail: ticker de 1s atualiza os tempos das sessões ativas sem re-render do dashboard
setInterval(() => {
  const now = Date.now()
  document.querySelectorAll<HTMLElement>('[data-elapsed]').forEach(el => {
    const start = parseInt(el.dataset.elapsed || '0', 10)
    if (!start) return
    el.textContent = fmtElapsed(now - start)
  })
}, 1000)

function sessions(rows: Row[]): string {
  const act = rows.flatMap(r => r.board.cards.filter(c => !c.archived && c.colId === 'doing').map(c => ({ wd: r.wd, c })))
  if (!act.length) return `<div class="dash-none">${icon('pause', 16)} Sem sessões ativas — as tarefas em «Em Curso» são terminais a correr.</div>`
  return `
    <span class="sess-count">${act.length} a decorrer</span>
    <ul class="sess-list">
      ${act.map(a => `
        <li class="sess">
          <span class="sess-dot" aria-hidden="true"></span>
          ${a.wd.icon ? `<img class="sess-orb" src="/icons/${a.wd.icon}" alt="">` : ''}
          <a class="sess-card" href="/w/${a.wd.slug}" data-nav="/w/${a.wd.slug}">${esc(a.c.title)}</a>
          <span class="sess-time" data-elapsed="${a.c.startedAt || a.c.ts}">${fmtElapsed(Date.now() - (a.c.startedAt || a.c.ts))}</span>
          <span class="sess-wd">${esc(a.wd.name)}</span>
        </li>`).join('')}
    </ul>`
}

function projCard(wd: Wd, t: Tally): string {
  const tg = t.todo + t.doing + t.review + t.done
  const doneFrac = tg ? t.done / tg : 0
  const C = 2 * Math.PI * 20
  const dash = `${(doneFrac * C).toFixed(1)} ${(C).toFixed(1)}`
  const orb = wd.icon ? `<img class="proj-orb" src="/icons/${wd.icon}" alt="">` : icon('sphere', 26)
  return `
    <a class="proj" href="/w/${wd.slug}" data-nav="/w/${wd.slug}">
      <div class="proj-top">
        <div class="proj-orbit" title="${Math.round(doneFrac * 100)}% concluído">
          <svg class="proj-ring" viewBox="0 0 48 48" aria-hidden="true">
            <circle class="pr-track" cx="24" cy="24" r="20"/>
            <circle class="pr-fill" cx="24" cy="24" r="20" style="stroke-dasharray:${dash}" transform="rotate(-90 24 24)"/>
          </svg>
          <span class="proj-orb-wrap">${orb}</span>
        </div>
        <div class="proj-body">
          <div class="proj-name">${esc(wd.name)}</div>
          ${wd.description ? `<div class="proj-desc">${esc(wd.description)}</div>` : ''}
        </div>
      </div>
      <div class="proj-stats">
        <span><b>${t.notes - t.notesArch}</b> notas</span>
        ${t.notesArch ? `<span><b>${t.notesArch}</b> arq.</span>` : ''}
        <span><b>${openCards(t)}</b> em aberto</span>
        <span class="proj-pct">${Math.round(doneFrac * 100)}%</span>
      </div>
    </a>`
}

function stat(label: string, val: string, sub: string, ico: Parameters<typeof icon>[0], hue?: string) {
  return `
    <div class="stat" style="--accent:${hue || 'var(--gold)'}">
      <div class="stat-ico" style="color:${hue || 'var(--gold)'};border-color:color-mix(in srgb,${hue || 'var(--gold)'} 45%,transparent);background:color-mix(in srgb,${hue || 'var(--gold)'} 13%,transparent)">${icon(ico, 18)}</div>
      <div class="stat-body"><div class="stat-val" style="color:${hue || 'var(--gold)'}">${val}</div><div class="stat-lbl">${label}</div><div class="stat-sub">${sub}</div></div>
    </div>
  `
}

function searchResults(rows: Row[], q: string): { html: string; count: number } {
  const ql = q.trim().toLowerCase()
  if (!ql) return { html: '', count: 0 }
  const hitsOf = (s?: string) => (s || '').toLowerCase().includes(ql)
  const groups = rows.map(r => {
    const nh = r.notes.filter(n => !n.archived && (hitsOf(n.title) || hitsOf(n.text) || (n.tags || []).some(t => t.includes(ql))))
      .map(n => ({ kind: 'nota', icon: 'note', title: n.title, text: n.text }))
    const ch = r.board.cards.filter(c => !c.archived && (hitsOf(c.title) || hitsOf(c.description)))
      .map(c => ({ kind: 'card', icon: 'board', title: c.title, text: c.description }))
    const hits = [...nh, ...ch]
    return hits.length ? { wd: r.wd, hits } : null
  }).filter((g): g is NonNullable<typeof g> => !!g)
  const count = groups.reduce((a, g) => a + g.hits.length, 0)
  if (!groups.length) return { html: `<div class="glob-none">Sem resultados para «${esc(q)}»</div>`, count }
  // ponytail: filtro em memória sobre `rows` já carregado; endpoint agregado só se N crescer
  return {
    html: groups.map(g => `
      <div class="glob-group">
        <div class="glob-wd">${g.wd.icon ? `<img class="glob-orb" src="/icons/${g.wd.icon}" alt="">` : icon('sphere', 14)} <a href="/w/${g.wd.slug}" data-nav="/w/${g.wd.slug}">${esc(g.wd.name)}</a><em>${g.hits.length}</em></div>
        <ul>${g.hits.map(h => `
          <li><a class="glob-hit" href="/w/${g.wd.slug}" data-nav="/w/${g.wd.slug}">
            ${icon(h.icon as Parameters<typeof icon>[0], 14)}<b>${esc(h.title)}</b><span class="glob-kind">${h.kind}</span>
            ${h.text ? `<span class="glob-text">${esc(h.text.slice(0, 140))}</span>` : ''}
          </a></li>`).join('')}</ul>
      </div>`).join(''),
    count,
  }
}

export async function renderDashboard(panel: HTMLElement, items: Wd[]) {
  const rows: Row[] = []
  for (const wd of items) {
    const [notes, board] = await Promise.all([
      api.notes.get(wd.slug).catch(() => [] as Nota[]),
      api.kanban.get(wd.slug).catch(() => ({ columns: [], cards: [] } as Row['board'])),
    ])
    rows.push({ wd, notes, board })
  }
  const { total, byWd } = tally(rows)
  const first = items[0]



  panel.innerHTML = `
    <div class="dash">
      <header class="dash-head">
        <div class="dash-stars" aria-hidden="true"></div>
        <div class="orb-rings" aria-hidden="true"><span class="ring ring-a"></span><span class="ring ring-b"></span></div>
        <div class="dash-head-title">
          <span class="dash-kicker">${icon('sphere', 13)} Atlas · o ombro do céu</span>
          <h1>Visão geral</h1>
          <p class="dash-sub">Cada projeto, o seu próprio mundo — todos sob o mesmo céu.</p>
        </div>
        <div class="dash-actions">
          <div class="glob-search-wrap">
            <input class="glob-search" id="globQ" type="search" placeholder="Buscar em todos os mundos…" aria-label="Buscar notas e cartões em todos os mundos" autocomplete="off">
            <div id="globResults" class="glob-results" hidden></div>
          </div>
          ${first ? `<a class="btn btn-ghost" href="/w/${first.slug}" data-nav="/w/${first.slug}">${icon('sphere', 16)} Ir para o mundo ativo</a>` : ''}
        </div>
      </header>

      <div class="stat-grid">
        ${stat('Projetos', String(items.length), items.length ? 'mundos criados' : 'sem projetos', 'sphere', 'var(--gold)')}
        ${stat('Notas', String(total.notes), total.notesArch ? `${total.notesArch} arquivadas · ${total.notes - total.notesArch} ativas` : 'nenhuma arquivada', 'note', 'var(--pipe-done)')}
        ${stat('Cartões em aberto', String(openCards(total)), 'a percorrer o céu', 'board', 'var(--pipe-todo)')}
        ${stat('Concluídos', String(total.done), total.done ? 'estrelas fixas no firmamento' : 'ainda a orbitar', 'check', 'var(--pipe-done)')}
      </div>

      <section class="dash-sec">
        <h2>${icon('forward', 16)} Pipeline de trabalho</h2>
        ${pipeline(total)}
      </section>

      <section class="dash-sec">
        <h2>${icon('sphere', 16)} Projetos</h2>
        <div class="proj-grid">${items.map(wd => projCard(wd, byWd.get(wd.slug)!)).join('')}</div>
      </section>

      <section class="dash-sec">
        <h2>${icon('aura', 16)} Sessões / terminais ativos</h2>
        ${sessions(rows)}
      </section>
    </div>`

  panel.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigate(a.getAttribute('data-nav')!) }))

  const gq = panel.querySelector<HTMLInputElement>('#globQ')!
  const gres = panel.querySelector<HTMLElement>('#globResults')!
  let timer = 0
  // ponytail: debounce curto + filtro em memória em `rows`; zero fetch por tecla
  let sel = -1
  const results = () => Array.from(gres.querySelectorAll<HTMLAnchorElement>('a.glob-hit'))
  const paint = () => {
    results().forEach((a, i) => a.classList.toggle('active', i === sel))
    const cur = results()[sel]
    if (cur) cur.scrollIntoView({ block: 'nearest' })
  }
  const runSearch = (val: string) => {
    sel = -1
    const q = val.trim()
    if (!q) { gres.hidden = true; gres.innerHTML = ''; return }
    const { html, count } = searchResults(rows, q)
    gres.innerHTML = html
    gres.hidden = false
    gres.setAttribute('role', 'status')
    gres.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigate(a.getAttribute('data-nav')!) }))
  }
  gq.addEventListener('input', () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => runSearch(gq.value), 150)
  })
  gq.addEventListener('keydown', e => {
    const as = results()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!as.length) return
      e.preventDefault()
      sel = e.key === 'ArrowDown' ? (sel + 1) % as.length : (sel - 1 + as.length) % as.length
      paint()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cur = as[sel]
      if (cur) cur.click()
      else runSearch(gq.value)
    }
  })
}


export async function renderWorldDashboard(panel: HTMLElement, wd: Wd) {
  const [notes, board] = await Promise.all([
    api.notes.get(wd.slug).catch(() => [] as Nota[]),
    api.kanban.get(wd.slug).catch(() => ({ columns: [], cards: [] } as Row['board'])),
  ])
  const rows: Row[] = [{ wd, notes, board }]
  const { byWd } = tally(rows)
  const t = byWd.get(wd.slug)!
  panel.innerHTML = `
    <div class="dash dash-world">
      <header class="dash-head">
        <div class="dash-head-title">
          <span class="dash-kicker">${icon(wd.icon ? 'sphere' : 'sphere', 13)} ${esc(wd.name)} · o seu mundo</span>
          <h1>Dashboard</h1>
          ${wd.description ? `<p class="dash-sub">${esc(wd.description)}</p>` : ''}
        </div>
      </header>

      <div class="stat-grid">
        ${stat('Notas ativas', String(t.notes - t.notesArch), t.notesArch ? `${t.notesArch} arquivadas` : 'neste mundo', 'note', 'var(--pipe-done)')}
        ${stat('Em curso', String(t.doing), 'tarefas a decorrer', 'aura', 'var(--pipe-doing)')}
        ${stat('Em aberto', String(openCards(t)), 'todo · doing · review', 'board', 'var(--pipe-todo)')}
        ${stat('Concluídos', String(t.done), 'feitos neste mundo', 'check', 'var(--pipe-done)')}
      </div>

      <section class="dash-sec">
        <h2>${icon('forward', 16)} Pipeline de trabalho</h2>
        ${pipeline(t)}
      </section>

      <section class="dash-sec">
        <h2>${icon('aura', 16)} Sessões / terminais ativos neste mundo</h2>
        ${sessions(rows)}
      </section>
    </div>`
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
