import { api, Card, Nota, HermesKey, HermesUsage, HermesUsageKey } from '../api'
import { icon } from '../ui/icons'
import { navigate } from '../router'
import { toast } from '../ui/toast'
import { today, week } from '../ui/stats'
import { fetchWeather, weatherAgeLabel } from '../ui/weather'

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
  // ponytail: defloat kejap87w — copy flavorado→copy denso
  if (!act.length) return `<div class="dash-none">${icon('pause', 16)} Nenhuma tarefa em curso.</div>`
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

function focusSection(): string {
  const t = today(), w = week()
  const blank = !t.sessions && !w.sessions
  return `
    <div class="focus" role="region" aria-label="Relatório de foco">
      <div class="focus-head">${icon('timer', 15)} <span>Foco de hoje</span></div>
      <div class="focus-metrics">
        <div class="fm"><b>${t.sessions}</b><span>Sessões</span><small>${w.sessions} na semana</small></div>
        <div class="fm fm-pomo"><b>${t.pomodoros}</b><span>Pomodoros</span><small>concluídos</small></div>
        <div class="fm fm-time"><b>${fmtElapsed(t.focusMs)}</b><span>Tempo em foco</span><small>hoje</small></div>
      </div>
      <div class="focus-week"><span>${icon('aura', 12)} Esta semana</span><b>${blank ? '—' : fmtElapsed(w.focusMs)}</b></div>
    </div>`
}
function statusPill(s: string): string {
  const hue = ({ active: 'var(--pipe-done)', exhausted: 'var(--pipe-todo)', error: 'var(--pipe-doing)', unknown: 'var(--text-dim)' } as Record<string, string>)[s] || 'var(--text-dim)'
  const lbl = ({ active: 'ok', exhausted: 'esgotada', error: 'erro', unknown: '—' } as Record<string, string>)[s] || s
  return `<span class="keys-pill" style="--pill:${hue}">${esc(lbl)}</span>`
}
function fmtNum(n: number | null | undefined): string {
  if (n == null || !isFinite(n as number)) return '—'
  return (n as number).toLocaleString('pt-PT')
}
// card ebvqt746 (v2 = Passo 3 leitura): junta colunas "hoje / tokens / custo" agregadas do JSONL.
// Fonte: GET /api/hermes/usage (HEIMDALL grava 1 linha por pedido em HERMES_HOME/logs/atlas/usage.jsonl).
// Quando usage e null/vazio, todas as colunas novas mostram '—' (estado pre-hook) — sem erro visivel.
// ponytail: o que NAO sabemos aparece como '—'; secret_fingerprint vem do server (access_token nunca sai).
function keysSection(keys: HermesKey[] | null, usage: HermesUsage | null): string {
  const list = keys ?? []
  const totals = (usage && usage.totals_by_key) || {}
  const hasUsage = Object.keys(totals).length > 0
  const active = list.filter(k => k.status === 'active').length
  const exhausted = list.filter(k => k.status === 'exhausted').length
  const totalReqs = list.reduce((a, k) => a + (k.request_count || 0), 0)
  const costToday = Object.values(totals).reduce((a, k) => a + (k.cost_usd || 0), 0)
  const costCell = hasUsage ? `$${costToday.toFixed(4)}` : '—'
  const costSub = hasUsage ? 'hoje (USD)' : 'captura por request ainda não ligada'
  const uFor = (k: HermesKey): HermesUsageKey | null => {
    if (!k.id) return null
    return totals[k.id] || null
  }
  return `
    <section class="dash-sec">
      <h2>${icon('tag', 16)} API keys &amp; uso</h2>
      <div class="stat-grid">
        ${stat('Keys activas', String(active), list.length ? `${list.length} configuradas` : '—', 'check', 'var(--pipe-done)')}
        ${stat('Esgotadas', String(exhausted), exhausted ? 'free tier queimado' : '—', 'bell', 'var(--pipe-todo)')}
        ${stat('Requests totais', fmtNum(totalReqs), 'lifetime (auth.json)', 'forward', 'var(--gold)')}
        ${stat('Custo estimado', costCell, costSub, 'tag', hasUsage ? 'var(--gold)' : 'var(--text-dim)')}
      </div>
      ${list.length ? `
        <table class="keys-table">
          <thead><tr>
            <th>label</th><th>provider</th><th>origem</th>
            <th>estado</th><th class="num">hoje</th><th class="num">tokens hoje</th><th class="num">custo hoje</th><th>último erro</th>
          </tr></thead>
          <tbody>${list.map(k => {
            const u = uFor(k)
            const reqs = u ? u.requests : 0
            const tok = u ? u.prompt_tokens + u.completion_tokens : 0
            const cost = u ? u.cost_usd : 0
            const reqsCell = u ? fmtNum(reqs) : '<span class="col-uso">—</span>'
            const tokCell = u ? `${fmtNum(u.prompt_tokens)} / ${fmtNum(u.completion_tokens)}` : '<span class="col-uso">—</span>'
            const costCellRow = u && cost > 0 ? `$${cost.toFixed(4)}` : (u ? '$0.0000' : '<span class="col-uso">—</span>')
            return `
            <tr>
              <td>${esc(k.label || k.id || '—')}</td>
              <td><code>${esc(k.provider)}</code></td>
              <td>${esc(k.source || '—')}</td>
              <td>${statusPill(k.status)}</td>
              <td class="num">${reqsCell}</td>
              <td class="num">${tokCell}</td>
              <td class="num usd">${costCellRow}</td>
              <td>${k.last_error_code ? `${k.last_error_code} ${esc(k.last_error_reason || '')}` : '—'}</td>
            </tr>`
          }).join('')}
          </tbody>
        </table>
      ` : `<div class="keys-empty">${icon('tag', 14)} Sem keys configuradas em auth.json.</div>`}
    </section>`
}


// card qoukodvd: widget Open-Meteo (Porto). DR — free, sem chave, 10k/dia, CORS OK.
// Attribution CC BY 4.0 obrigatoria: "Weather by Open-Meteo.com".
// ponytail: cache em memoria 15min em fetchWeather() — sem re-fetch por render.
function weatherSection(w: Awaited<ReturnType<typeof fetchWeather>> | null, err: string | null): string {
  const attribution = `<div class="weather-attr"><a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather by Open-Meteo.com (CC BY 4.0)</a></div>`
  if (err) return `
    <section class="dash-sec">
      <h2>${icon('cloud', 16)} Meteorologia</h2>
      <div class="dash-none">${icon('cloud', 14)} Meteorologia indisponivel — ${esc(err)}</div>
      ${attribution}
    </section>`
  if (!w) return `
    <section class="dash-sec">
      <h2>${icon('cloud', 16)} Meteorologia</h2>
      <div class="dash-none">${icon('cloud', 14)} A carregar meteorologia…</div>
      ${attribution}
    </section>`
  const t = `${Math.round(w.tempC)}°C`
  return `
    <section class="dash-sec">
      <h2>${icon('cloud', 16)} Meteorologia</h2>
      <div class="stat-grid">
        ${stat('Temperatura', t, 'Porto · agora', w.icon, 'var(--gold)')}
        ${stat('Condicao', w.label, `Atualizado as ${weatherAgeLabel(w.time)}`, 'aura', 'var(--pipe-doing)')}
      </div>
      ${attribution}
    </section>`
}

function searchResults(rows: Row[], q: string): { html: string; count: number } {
  const ql = q.trim().toLowerCase()
  if (!ql) return { html: '', count: 0 }
  const hitsOf = (s?: string) => (s || '').toLowerCase().includes(ql)
  const groups = rows.map(r => {
    const nh = r.notes.filter(n => !n.archived && (hitsOf(n.title) || hitsOf(n.text) || (n.tags || []).some(t => t.includes(ql))))
      .map(n => ({ kind: 'nota', icon: 'note', title: n.title, text: n.text, id: n.id }))
    const ch = r.board.cards.filter(c => !c.archived && (hitsOf(c.title) || hitsOf(c.description)))
      .map(c => ({ kind: 'card', icon: 'board', title: c.title, text: c.description, id: c.id }))
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
          <li><a class="glob-hit" href="/w/${g.wd.slug}?tab=${h.kind==='card'?'kanban':'notes'}&open=${h.id}" data-nav="/w/${g.wd.slug}?tab=${h.kind==='card'?'kanban':'notes'}&open=${h.id}">
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
      api.notes.get(wd.slug).catch(() => null),
      api.kanban.get(wd.slug).catch(() => null),
    ])
    rows.push({ wd, notes: notes?.items ?? [] as Nota[], board: board ?? { columns: [], cards: [] } })
  }
  const { total, byWd } = tally(rows)
  // API keys + uso: 2 chamadas globais, paralelas (auth.json + usage.jsonl do hermes).
  // card ebvqt746: usage complementa "hoje / tokens / custo" — sem ficheiro = '—' (v1 intacta).
  const [[keys, usage], wx] = await Promise.all([
    Promise.all([api.hermes.keys().catch(() => null), api.hermes.usage().catch(() => null)]),
    fetchWeather().then(w => ({ ok: true as const, w })).catch(e => ({ ok: false as const, err: e.message as string })),
  ])
  const weather = wx.ok ? wx.w : null
  const weatherErr = wx.ok ? null : wx.err
  const first = items[0]



  panel.innerHTML = `
    <div class="dash">
      <header class="dash-head">
        <div class="dash-stars" aria-hidden="true"></div>
        <div class="orb-rings" aria-hidden="true"><span class="ring ring-a"></span><span class="ring ring-b"></span></div>
        <div class="dash-head-title">
          <span class="dash-kicker">${icon('sphere', 13)} Atlas</span>
          <h1>Visão geral</h1>
          <p class="dash-sub">${items.length} mundos · ${openCards(total)} tarefas em aberto</p>
        </div>
        <div class="dash-actions">
          <div class="glob-search-wrap">
            <input class="glob-search" id="globQ" type="search" placeholder="Buscar em todos os mundos…" aria-label="Buscar notas e cartões em todos os mundos" autocomplete="off">
            <div id="globResults" class="glob-results" hidden></div>
          </div>
          ${first ? `<a class="btn btn-ghost" href="/w/${first.slug}" data-nav="/w/${first.slug}">${icon('sphere', 16)} Ir para o mundo ativo</a>` : ''}
          <button class="btn btn-ghost" id="orch-btn" title="Move todos os cartões TODO (não arquivados) de todos os mundos para Em Curso e lança os agentes">${icon('term', 16)} Ativar orquestrador</button>
        </div>
      </header>

      <div class="stat-grid">
        ${stat('Projetos', String(items.length), items.length ? 'mundos criados' : 'sem projetos', 'sphere', 'var(--gold)')}
        ${stat('Notas', String(total.notes), total.notesArch ? `${total.notesArch} arquivadas · ${total.notes - total.notesArch} ativas` : 'nenhuma arquivada', 'note', 'var(--pipe-done)')}
        ${stat('Cartões em aberto', String(openCards(total)), 'a percorrer o céu', 'board', 'var(--pipe-todo)')}
        ${stat('Concluídos', String(total.done), total.done ? 'estrelas fixas no firmamento' : 'ainda a orbitar', 'check', 'var(--pipe-done)')}
      </div>

      ${weatherSection(weather, weatherErr)}

      <section class="dash-sec">
        <h2>${icon('forward', 16)} Pipeline de trabalho</h2>
        <div class="dash-pipe-row">
          <div class="pipe-col">${pipeline(total)}</div>
          ${focusSection()}
        </div>
      </section>

      ${keysSection(keys, usage)}

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

  // ponytail: orquestrador = gatilho; move TODO->doing em todos os mundos e re-render p/ atualizar counts
  const orch = panel.querySelector<HTMLButtonElement>('#orch-btn')
  orch?.addEventListener('click', () => {
    const b = orch
    b.disabled = true
    api.orchestrator.start()
      .then(d => {
        toast(d.moved ? `Orquestrador ativado — ${d.moved} tarefa${d.moved === 1 ? '' : 's'} TODO → Em Curso` : 'Orquestrador: sem TODOs para mover (0)')
        return renderDashboard(panel, items)
      })
      .catch(e => toast('Orquestrador: ' + e.message))
      .finally(() => { b.disabled = false })
  })
}


export async function renderWorldDashboard(panel: HTMLElement, wd: Wd) {
  const [notes, board, keys, usage, wx] = await Promise.all([
    api.notes.get(wd.slug).catch(() => null),
    api.kanban.get(wd.slug).catch(() => null),
    api.hermes.keys().catch(() => null),
    api.hermes.usage().catch(() => null),
    fetchWeather().then(w => ({ ok: true as const, w })).catch(e => ({ ok: false as const, err: e.message as string })),
  ])
  const weather = wx.ok ? wx.w : null
  const weatherErr = wx.ok ? null : wx.err
  const rows: Row[] = [{ wd, notes: notes?.items ?? [] as Nota[], board: board ?? { columns: [], cards: [] } }]
  const { byWd } = tally(rows)
  const t = byWd.get(wd.slug)!
  panel.innerHTML = `
    <div class="dash dash-world">
      <header class="dash-head">
        <div class="dash-head-title">
          <span class="dash-kicker">${icon(wd.icon ? 'sphere' : 'sphere', 13)} ${esc(wd.name)}</span>
          <h1>Dashboard</h1>
          ${wd.description ? `<p class="dash-sub">${esc(wd.description)}</p>` : ''}
        </div>
        <div class="dash-actions">
          <button class="btn btn-ghost" id="orch-wd-btn" title="Move todos os cartões TODO (não arquivados) deste mundo para Em Curso e lança os agentes">${icon('term', 16)} Ativar orquestrador</button>
        </div>
      </header>

      <div class="stat-grid">
        ${stat('Notas ativas', String(t.notes - t.notesArch), t.notesArch ? `${t.notesArch} arquivadas` : 'neste mundo', 'note', 'var(--pipe-done)')}
        ${stat('Em curso', String(t.doing), 'tarefas a decorrer', 'aura', 'var(--pipe-doing)')}
        ${stat('Em aberto', String(openCards(t)), 'todo · doing · review', 'board', 'var(--pipe-todo)')}
        ${stat('Concluídos', String(t.done), 'feitos neste mundo', 'check', 'var(--pipe-done)')}
      </div>

      ${weatherSection(weather, weatherErr)}

      <section class="dash-sec">
        <h2>${icon('forward', 16)} Pipeline de trabalho</h2>
        <div class="dash-pipe-row">
          <div class="pipe-col">${pipeline(t)}</div>
          ${focusSection()}
        </div>
      </section>

      ${keysSection(keys, usage)}

      <section class="dash-sec">
        <h2>${icon('aura', 16)} Sessões / terminais ativos neste mundo</h2>
        ${sessions(rows)}
      </section>
    </div>
  `

  // ponytail: orquestrador do mundo = gatilho; move TODO->doing deste mundo e lança os agentes, re-render a seguir
  const orch = panel.querySelector<HTMLButtonElement>('#orch-wd-btn')
  orch?.addEventListener('click', () => {
    const b = orch
    b.disabled = true
    api.orchestrator.start(wd.slug)
      .then(d => {
        toast(d.moved ? `Orquestrador: ${d.moved} tarefa${d.moved === 1 ? '' : 's'} deste mundo → Em Curso` : 'Orquestrador: sem TODOs neste mundo (0)')
        return renderWorldDashboard(panel, wd)
      })
      .catch(e => toast('Orquestrador: ' + e.message))
      .finally(() => { b.disabled = false })
  })
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
