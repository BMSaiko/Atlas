import { api, type HermesKey, type HermesUsage, type HermesUsageKey, type Nota } from '../api'
import { icon } from '../ui/icons'
import { fetchWeather, openWeatherWeekModal } from '../ui/weather'
import { toast } from '../ui/toast'
import { navigate } from '../router'
import { today, week } from '../ui/stats'

// ponytail: dashboard (2026-09-05). Mostra stats de notas por mundo +
// meteorologia (Porto via Open-Meteo) + API keys/uso do Hermes.
// removidos — feature descontinuada.

interface Wd { slug: string; name: string; description?: string; icon?: string }
interface Row { wd: Wd; notes: Nota[] }
interface Tally { notes: number; notesArch: number }

// ponytail: dashboard (2026-09-05). Mostra stats de notas por mundo +
// meteorologia (Porto via Open-Meteo) + API keys/uso do Hermes.
// removidos — feature descontinuada.

function tally(rows: Row[]): { total: Tally; byWd: Map<string, Tally> } {
  const total: Tally = { notes: 0, notesArch: 0 }
  const byWd = new Map<string, Tally>()
  for (const r of rows) {
    const t: Tally = { notes: r.notes.length, notesArch: r.notes.filter(n => n.archived).length }
    total.notes += t.notes; total.notesArch += t.notesArch
    byWd.set(r.wd.slug, t)
  }
  return { total, byWd }
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

function stat(label: string, val: string, sub: string, ico: Parameters<typeof icon>[0], hue?: string, role?: 'button', ariaLabel?: string) {
  const a = role === 'button' ? ` role="button" tabindex="0" data-weather-card aria-label="${ariaLabel || label}"` : ''
  return `
    <div class="stat"${a} style="--accent:${hue || 'var(--gold)'}">
      <div class="stat-ico" style="color:${hue || 'var(--gold)'};border-color:color-mix(in srgb,${hue || 'var(--gold)'} 45%,transparent);background:color-mix(in srgb,${hue || 'var(--gold)'} 12%,transparent)">${icon(ico, 16)}</div>
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
function keysSection(keys: HermesKey[] | null, usage: HermesUsage | null): string {
  const list = keys ?? []
  const totals = (usage && usage.totals_by_key) || {}
  const hasUsage = Object.keys(totals).length > 0
  const active = list.filter(k => k.status === 'active').length
  const exhausted = list.filter(k => k.status === 'exhausted').length
  const totalReqs = list.reduce((a, k) => a + (k.request_count || 0), 0)
  const costToday = Object.values(totals).reduce((a, k) => { const x = (k as any); return a + (x.cost_usd || 0) }, 0)
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

// card qoukodvd: widget Open-Meteo (Porto).
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
        ${stat('Temperatura', t, 'Porto · agora', w.icon, 'var(--gold)', 'button', 'Ver previsão da semana')}
        ${stat('Condicao', w.label, `Atualizado as ${weatherAgeLabel(w.time)}`, 'aura', 'var(--pipe-doing)', 'button', 'Ver previsão da semana')}
      </div>
      ${attribution}
    </section>`
}

function weatherAgeLabel(t: string): string {
  try { return new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) } catch { return '—' }
}

function searchResults(rows: Row[], q: string): { html: string; count: number } {
  const ql = q.trim().toLowerCase()
  if (!ql) return { html: '', count: 0 }
  const hitsOf = (s?: string) => (s || '').toLowerCase().includes(ql)
  const groups = rows.map(r => {
    const nh = r.notes.filter(n => !n.archived && (hitsOf(n.title) || hitsOf(n.text) || (n.tags || []).some(t => t.includes(ql))))
      .map(n => ({ kind: 'nota', icon: 'note', title: n.title, text: n.text, id: n.id }))
    return nh.length ? { wd: r.wd, hits: nh } : null
  }).filter((g): g is NonNullable<typeof g> => !!g)
  const count = groups.reduce((a, g) => a + g.hits.length, 0)
  if (!groups.length) return { html: `<div class="glob-none">Sem resultados para «${esc(q)}»</div>`, count }
  return {
    html: groups.map(g => `
      <div class="glob-group">
        <div class="glob-wd">${g.wd.icon ? `<img class="glob-orb" src="/icons/${g.wd.icon}" alt="">` : icon('sphere', 14)} <a href="/w/${g.wd.slug}" data-nav="/w/${g.wd.slug}">${esc(g.wd.name)}</a></div>
        <ul>${g.hits.map(h => `
          <li><a class="glob-hit" href="/w/${g.wd.slug}?tab=notes&open=${h.id}" data-nav="/w/${g.wd.slug}?tab=notes&open=${h.id}">
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
    const notes = await api.notes.get(wd.slug).catch(() => null)
    rows.push({ wd, notes: notes?.items ?? [] as Nota[] })
  }
  const { total, byWd } = tally(rows)
  const [[keys, usage], wx] = await Promise.all([
    Promise.all([api.hermes.keys().catch(() => null), api.hermes.usage().catch(() => null)]),
    fetchWeather().then(w => ({ ok: true as const, w })).catch(e => ({ ok: false as const, err: e.message as string })),
  ])
  const weather = wx.ok ? wx.w : null
  const weatherErr = wx.ok ? null : wx.err
  const first = items[0]

  const activeNotes = total.notes - total.notesArch

  panel.innerHTML = `
    <div class="dash">
      <header class="dash-head">
        <div class="dash-stars" aria-hidden="true"></div>
        <div class="orb-rings" aria-hidden="true"><span class="ring ring-a"></span><span class="ring ring-b"></span></div>
        <div class="dash-head-title">
          <span class="dash-kicker">${icon('sphere', 13)} Atlas</span>
          <h1>Visão geral</h1>
          <p class="dash-sub">${items.length} mundos · ${activeNotes} notas ativas</p>
        </div>
        <div class="dash-actions">
          <div class="glob-search-wrap">
            <input class="glob-search" id="globQ" type="search" placeholder="Buscar em todos os mundos…" aria-label="Buscar notas em todos os mundos" autocomplete="off">
            <div id="globResults" class="glob-results" hidden></div>
          </div>
          ${first ? `<a class="btn btn-ghost" href="/w/${first.slug}" data-nav="/w/${first.slug}">${icon('sphere', 16)} Ir para o mundo ativo</a>` : ''}
        </div>
      </header>

      <div class="stat-grid">
        ${stat('Projetos', String(items.length), items.length ? 'mundos criados' : 'sem projetos', 'sphere', 'var(--gold)')}
        ${stat('Notas ativas', String(activeNotes), total.notesArch ? `${total.notesArch} arquivadas · ${activeNotes} ativas` : 'nenhuma arquivada', 'note', 'var(--pipe-done)')}
      </div>

      ${weatherSection(weather, weatherErr)}

      ${focusSection()}

      ${keysSection(keys, usage)}
    </div>`

  bindWeatherCards(panel)

  panel.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigate(a.getAttribute('data-nav')!) }))

  const gq = panel.querySelector<HTMLInputElement>('#globQ')!
  const gres = panel.querySelector<HTMLElement>('#globResults')!
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
  gq.addEventListener('input', () => runSearch(gq.value))
  gq.addEventListener('keydown', e => {
    const rs = results()
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, rs.length - 1); paint() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint() }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); rs[sel]?.click() }
    else if (e.key === 'Escape') { gres.hidden = true; gq.blur() }
  })
}

export async function renderWorldDashboard(panel: HTMLElement, wd: Wd) {
  const notes = await api.notes.get(wd.slug).catch(() => null)
  const [[keys, usage], wx] = await Promise.all([
    Promise.all([api.hermes.keys().catch(() => null), api.hermes.usage().catch(() => null)]),
    fetchWeather().then(w => ({ ok: true as const, w })).catch(e => ({ ok: false as const, err: e.message as string })),
  ])
  const weather = wx.ok ? wx.w : null
  const weatherErr = wx.ok ? null : wx.err
  const t: Tally = { notes: notes?.items?.length ?? 0, notesArch: (notes?.items ?? []).filter(n => n.archived).length }
  panel.innerHTML = `
    <div class="dash dash-world">
      <header class="dash-head">
        <div class="dash-head-title">
          <span class="dash-kicker">${icon('sphere', 13)} ${esc(wd.name)}</span>
          <h1>Dashboard</h1>
          ${wd.description ? `<p class="dash-sub">${esc(wd.description)}</p>` : ''}
        </div>
      </header>

      <div class="stat-grid">
        ${stat('Notas ativas', String(t.notes - t.notesArch), t.notesArch ? `${t.notesArch} arquivadas` : 'neste mundo', 'note', 'var(--pipe-done)')}
        ${stat('Total notas', String(t.notes), 'neste mundo', 'forward', 'var(--gold)')}
      </div>

      ${weatherSection(weather, weatherErr)}

      ${focusSection()}

      ${keysSection(keys, usage)}
    </div>
  `
  bindWeatherCards(panel)
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

function bindWeatherCards(panel: HTMLElement) {
  if ((panel as any).__weatherBound) return
  ;(panel as any).__weatherBound = true
  const fire = (target: HTMLElement) => { if (panel.contains(target)) openWeatherWeekModal() }
  panel.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-weather-card]')
    if (t) fire(t)
  })
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-weather-card]')
    if (t) { e.preventDefault(); fire(t) }
  })
}
