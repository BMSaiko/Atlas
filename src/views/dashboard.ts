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
const COL_ORDER = ['todo', 'doing', 'review', 'done']

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
  const segs = COL_ORDER.map(id => ({ id, n: total[id as 'todo'] }))
  const grand = segs.reduce((a, s) => a + s.n, 0) || 1
  const bar = segs.map(s => `<span class="pipe-seg pipe-${s.id}" style="width:${(s.n / grand) * 100}%" title="${COL_LABEL[s.id]}: ${s.n}"></span>`).join('')
  const cells = segs.map(s => `
    <span class="pipe-cell pipe-${s.id}">
      <span class="pipe-n">${s.n}</span>
      <span class="pipe-l">${COL_LABEL[s.id]}</span>
    </span>`).join('')
  return `
    <div class="pipe">
      <div class="pipe-bar">${bar}</div>
      <div class="pipe-cols">${cells}
        <span class="pipe-cell pipe-arch"><span class="pipe-n">${total.arch}</span><span class="pipe-l">Arquivados</span></span>
      </div>
    </div>`
}

function sessions(rows: Row[]): string {
  const act = rows.flatMap(r => r.board.cards.filter(c => !c.archived && c.colId === 'doing').map(c => ({ wd: r.wd, c })))
  if (!act.length) return `<div class="dash-none">${icon('pause', 16)} Sem sessões ativas — as tarefas em «Em Curso» são terminais a correr.</div>`
  return `<ul class="sess-list">
    ${act.map(a => `
      <li class="sess">
        <span class="sess-dot" aria-hidden="true"></span>
        ${a.wd.icon ? `<img class="sess-orb" src="/icons/${a.wd.icon}" alt="">` : ''}
        <a class="sess-card" href="/w/${a.wd.slug}" data-nav="/w/${a.wd.slug}">${esc(a.c.title)}</a>
        <span class="sess-wd">${esc(a.wd.name)}</span>
      </li>`).join('')}
  </ul>`
}

export async function renderDashboard(panel: HTMLElement, items: Wd[]) {
  const rows: Row[] = []
  for (const wd of items) {
    const [notes, board] = await Promise.all([
      api.notes.get(wd.slug).catch(() => [] as Nota[]),
      api.kanban.get(wd.slug).catch(() => ({ columns: [], cards: [] })),
    ])
    rows.push({ wd, notes, board })
  }
  const { total, byWd } = tally(rows)

  const stat = (label: string, val: string, sub: string, ico: Parameters<typeof icon>[0]) => `
    <div class="stat">
      <div class="stat-ico">${icon(ico, 18)}</div>
      <div class="stat-body"><div class="stat-val">${val}</div><div class="stat-lbl">${label}</div><div class="stat-sub">${sub}</div></div>
    </div>`

  const projCards = items.map(wd => {
    const t = byWd.get(wd.slug)!
    const open = openCards(t)
    const g = (t.todo + t.doing + t.review + t.done) || 1
    const mb = COL_ORDER.map(id => `<span class="mini-seg mini-${id}" style="width:${(t[id as 'todo'] / g) * 100}%"></span>`).join('')
    return `
      <a class="proj" href="/w/${wd.slug}" data-nav="/w/${wd.slug}">
        <div class="proj-top">${wd.icon ? `<img class="proj-orb" src="/icons/${wd.icon}" alt="">` : icon('sphere', 20)}<div class="proj-name">${esc(wd.name)}</div></div>
        ${wd.description ? `<div class="proj-desc">${esc(wd.description)}</div>` : ''}
        <div class="mini-bar">${mb}</div>
        <div class="proj-stats">
          <span><b>${t.notes - t.notesArch}</b> notas</span>
          ${t.notesArch ? `<span><b>${t.notesArch}</b> arq.</span>` : ''}
          <span><b>${open}</b> em aberto</span>
        </div>
      </a>`
  }).join('')

  panel.innerHTML = `
    <div class="dash">
      <header class="dash-head">
        <h1>Visão Geral</h1>
        <p class="dash-sub">O cosmos do Atlas — todos os mundos, num só olhar.</p>
        <div class="dash-actions">
          <a class="btn btn-ghost" href="/w/${items[0]?.slug || ''}">${icon('sphere', 16)} Ir para o mundo ativo</a>
        </div>
      </header>

      <div class="stat-grid">
        ${stat('Projetos', String(items.length), items.length ? 'mundos criados' : 'sem projetos', 'sphere')}
        ${stat('Notas', String(total.notes), total.notesArch ? `${total.notesArch} arquivadas` : 'nenhuma arquivada', 'note')}
        ${stat('Cartões em aberto', String(openCards(total)), `${total.todo} todo · ${total.doing} a decorrer`, 'board')}
        ${stat('Sessões ativas', String(total.doing), total.doing ? 'terminais a correr' : 'nenhuma a correr', 'aura')}
      </div>

      <section class="dash-sec">
        <h2>Pipeline de trabalho</h2>
        ${pipeline(total)}
      </section>

      <section class="dash-sec">
        <h2>Projetos</h2>
        <div class="proj-grid">${projCards}</div>
      </section>

      <section class="dash-sec">
        <h2>Sessões / terminais ativos</h2>
        ${sessions(rows)}
      </section>
    </div>`

  panel.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigate(a.getAttribute('data-nav')!) }))
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
