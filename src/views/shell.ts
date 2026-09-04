import { api, uid } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { toast } from '../ui/toast'
import { navigate } from '../router'
import { renderWorkspace } from './workspace'
import { openPalette } from '../ui/palette'
import { parseTags, bindTagAutocomplete, openNewNoteModal } from './notes'
import { openNewCardModal } from './kanban'
import { renderDashboard } from './dashboard'
import { startClockWidget } from '../ui/clock'
import { fetchWeather, openWeatherWeekModal } from '../ui/weather'
import { getTheme, setManual, setSeason, setAuto, setSeasonMode, autoShift, autoSeason, Shift, Season, SEASON_NAMES } from '../ui/theme'
import { TZ_LIST, getTz, setTz } from '../ui/timezones'
import { mountFocus } from '../ui/pomodoro'

const ACTIVE_KEY = 'atlas.active'
const active = () => { try { return localStorage.getItem(ACTIVE_KEY) || '' } catch { return '' } }
const setActive = (s: string) => { try { localStorage.setItem(ACTIVE_KEY, s) } catch {} }

async function counts(slug: string) {
  try {
    const [notes, board] = await Promise.all([api.notes.get(slug), api.kanban.get(slug)])
    return { notes: notes.items.length, open: board.cards.filter(c => !c.archived && c.colId !== 'done').length }
  } catch { return { notes: 0, open: 0 } }
}

export async function renderShell(root: HTMLElement, slug: string | null, isSettings: boolean) {
  const workdirs = await api.workdirs()
  let activeSlug = slug && workdirs.some(w => w.slug === slug) ? slug : null
  const catalog = await api.icons().catch(() => [] as string[])
  const items = await Promise.all(workdirs.map(async (w, i) => ({ ...w, icon: w.icon || catalog[i % Math.max(catalog.length, 1)], open: (await counts(w.slug)).open })))
  state.slug = activeSlug; state.items = items

  root.innerHTML = `
    <div class="orb-bg"></div>
    <div class="shell" id="shell">
      <aside class="side" id="side">
        <div class="side-head"><a class="logo logo-sm" href="/" data-nav="/">ATLAS</a><span class="shift-ind" id="shift-ind" title="Luminosidade do dia"></span><span class="shift-ind" id="season-ind" title="Estação do ano"></span></div>
        <nav class="side-nav" aria-label="Workdirs"></nav>
        <div class="side-clock" id="clock">
          <div class="clock-time" data-clock="time">--:--:--</div>
          <div class="clock-sub"><span class="clock-date" data-clock="date"></span> · <span class="clock-tz" data-clock="tz" id="clock-tz" role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-label="Fuso horário">PT</span> · <span class="clock-wx" data-clock="wx" role="button" tabindex="0" aria-label="Previsão meteorológica — 7 dias" title="Meteorologia — Open-Meteo"><span class="wx-icon" data-clock="wx-icon"></span><span class="wx-temp" data-clock="wx-temp">--°</span></span></div>
          <div class="tz-pop" id="tz-pop" hidden><label for="tz-select">Fuso horário</label><select id="tz-select" aria-label="Escolher fuso horário"></select></div>
        </div>
        <div class="side-focus" id="foco"></div>
        <div class="side-foot"><button class="btn btn-primary btn-block" id="side-new">${icon('plus', 16)} Novo mundo</button></div>
      </aside>
      <button class="hamb" id="hamb" aria-label="Abrir menu workdirs">${icon('menu', 22)}</button>
      <main class="panel" id="panel"></main>
    </div>`

  const shell = root.querySelector('#shell') as HTMLElement
  const nav = root.querySelector('.side-nav') as HTMLElement
  let dragSlug: string | null = null
  const renderNav = () => {
    nav.innerHTML = items.map(w => `<a class="side-item${w.slug === activeSlug ? ' active' : ''}" data-slug="${w.slug}" draggable="true" href="/w/${w.slug}">
      <img class="side-orb" src="/icons/${w.icon}" alt="" aria-hidden="true" ${w.icon ? '' : 'hidden'}>
      <span class="side-label">${esc(w.name)}</span>
      ${w.open ? `<span class="side-count">${w.open}</span>` : ''}</a>`).join('')
    nav.querySelectorAll<HTMLElement>('.side-item').forEach(el => el.addEventListener('click', e => {
      e.preventDefault(); setActive(el.getAttribute('data-slug')!); shell.classList.remove('side-open'); navigate('/w/' + el.getAttribute('data-slug'))
    }))
    nav.querySelectorAll<HTMLElement>('.side-item').forEach(el => el.addEventListener('dragstart', (e: DragEvent) => {
      dragSlug = el.getAttribute('data-slug'); el.classList.add('dragging')
      try { e.dataTransfer?.setData('text/plain', dragSlug || '') } catch {}
    }))
    nav.querySelectorAll<HTMLElement>('.side-item').forEach(el => {
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); nav.querySelectorAll<HTMLElement>('.side-item').forEach(x => x.classList.remove('dragover')); dragSlug = null })
      el.addEventListener('dragover', e => { if (dragSlug && el.getAttribute('data-slug') !== dragSlug) { e.preventDefault(); el.classList.add('dragover') } })
      el.addEventListener('dragleave', () => el.classList.remove('dragover'))
      el.addEventListener('drop', e => {
        e.preventDefault(); el.classList.remove('dragover')
        if (!dragSlug) return
        const from = items.findIndex(w => w.slug === dragSlug)
        const to = items.findIndex(w => w.slug === el.getAttribute('data-slug'))
        if (from < 0 || to < 0 || from === to) { dragSlug = null; return }
        const [moved] = items.splice(from, 1)
        items.splice(to, 0, moved)
        dragSlug = null
        state.items = [...items]
        renderNav()
        api.reorderWorkdirs(items.map(w => w.slug)).catch(() => toast('Erro ao guardar ordem'))
      })
    })
  }
  renderNav()
  const panel = root.querySelector('#panel') as HTMLElement
  if (activeSlug) { setActive(activeSlug); await renderWorkspace(panel, activeSlug, isSettings) }
  else if (items.length) await renderDashboard(panel, items)
  else renderEmpty(panel, items, root)

  root.querySelector('#hamb')!.addEventListener('click', () => shell.classList.toggle('side-open'))
  root.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); navigate(el.getAttribute('data-nav')!) }))
  root.querySelector('#side-new')!.addEventListener('click', () => newWorkdir())
  bindKeydown()
  watchShift()
  watchSeason()
  startClockWidget(shell)
  bindClockTz(shell)
  bindClockWeather(shell)
  mountFocus(root.querySelector('#foco') as HTMLElement)
}


const SHIFT_ICON: Record<string, 'sun'|'dusk'|'moon'> = { day: 'sun', dusk: 'dusk', night: 'moon' }
const SHIFT_LABEL: Record<string, string> = { day: 'Dia', dusk: 'Entardecer', night: 'Noite' }
// Clicar no indicador cicla Dia -> Entardecer -> Noite (escolha manual de tema).
// Modo auto é definido nas Definições; enquanto estiver ativo o botão sai da barra lateral.
const CYCLE: Array<Shift> = ['day', 'dusk', 'night']
function renderShift() {
  const el = document.getElementById('shift-ind')
  if (!el) return
  const t = getTheme()
  const auto = t.mode === 'auto'
  const s: Shift = auto ? autoShift() : t.shift
  el.innerHTML = (auto ? icon('timer', 16) : icon(SHIFT_ICON[s] || 'moon', 16)) +
    `<span class="shift-label">${auto ? 'Auto' : (SHIFT_LABEL[s] || 'Noite')}</span>` +
    `<span class="kbdhint-tip">Esquerdo: mudar tema à mão · Direito: voltar a automático (segue a hora)</span>`
  el.setAttribute('data-shift', s)
  el.title = auto ? 'Tema automático — esquerdo põe manual, direito mantém auto' : 'Tema manual — esquerdo alterna tema, direito volta a auto'
}
function watchShift() {
  renderShift()
  const el = document.getElementById('shift-ind')
  // Botão clicável sempre: em auto muda para manual, em manual cicla o tema.
  el?.addEventListener('click', () => {
    const t = getTheme()
    if (t.mode === 'auto') { setManual(((document.documentElement.dataset.shift) as Shift) || autoShift()); return }
    const next = CYCLE[(CYCLE.indexOf(t.shift) + 1) % CYCLE.length]
    setManual(next)
  })
  // Direito = automático (volta a seguir a hora); esquerdo já faz manual (pin / ciclo).
  el?.addEventListener('contextmenu', e => { e.preventDefault(); setAuto() })
  const mo = new MutationObserver(renderShift)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-shift'] })
}

const SEASON_CYCLE: Array<Season> = ['winter', 'spring', 'summer', 'autumn']
function renderSeason() {
  const el = document.getElementById('season-ind')
  if (!el) return
  const t = getTheme()
  const auto = t.seasonMode === 'auto'
  const s: Season = auto ? autoSeason() : t.season
  el.innerHTML = (auto ? icon('timer', 16) : icon('leaf', 16)) +
    `<span class="shift-label">${auto ? 'Auto' : (SEASON_NAMES[s] || 'Inverno')}</span>` +
    `<span class="kbdhint-tip">Esquerdo: mudar estação à mão · Direito: voltar a automático (segue o mês)</span>`
  el.setAttribute('data-season', s)
  el.title = auto ? 'Estação automática — esquerdo põe manual, direito mantém auto' : 'Estação manual — esquerdo altera estação, direito volta a auto'
}
function watchSeason() {
  renderSeason()
  const el = document.getElementById('season-ind')
  el?.addEventListener('click', () => {
    const t = getTheme()
    if (t.seasonMode === 'auto') { setSeason(((document.documentElement.dataset.season) as Season) || autoSeason()); return }
    const next = SEASON_CYCLE[(SEASON_CYCLE.indexOf(t.season) + 1) % SEASON_CYCLE.length]
    setSeason(next)
  })
  // Direito = automático; esquerdo já faz manual (pin / ciclo).
  el?.addEventListener('contextmenu', e => { e.preventDefault(); setSeasonMode('auto') })
  const mo = new MutationObserver(renderSeason)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-season'] })
}

let state: { slug: string | null; items: Array<{ slug: string; icon?: string }> } = { slug: null, items: [] }
let keydownBound = false
function bindKeydown() {
  if (keydownBound) return
  keydownBound = true
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
    if (document.querySelector('.modal-backdrop')) return
    if (e.ctrlKey) {
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); openPalette(state.slug); return }
      const n = parseInt(e.key); if (n >= 1 && n <= 9 && state.items[n - 1]) {
        e.preventDefault(); setActive(state.items[n - 1].slug); navigate('/w/' + state.items[n - 1].slug)
      }
      return
    }
    if (e.altKey) {
      const nav = [null, ...state.items.map(it => it.slug)]  // dashboard (null) + mundos, ordem da sidebar
      const cur = state.slug
      let i = cur ? nav.indexOf(cur) : 0
      if (i < 0) i = 0
      const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      if (delta) {
        e.preventDefault()
        const next = nav[(i + delta + nav.length) % nav.length]
        if (next) { setActive(next); navigate('/w/' + next) }
        else { setActive(''); navigate('/') }
      }
    }
  })
}

// ponytail: quickAdd (palette ctrl+K) DELEGA nos modais completos de criar (openNewCardModal /
// openNewNoteModal) em vez do mini-form proprio — fonte unica do "novo cartão/nota". Range type fica a escolher.
export function quickAdd(slug: string | null) {
  if (!slug) return
  const m = openModal({
    title: 'Criar cartão ou nota', submitText: 'Seguinte',
    body: () => `<div class="field"><label for="qa-type">Tipo</label>
      <select id="qa-type" name="type">
        <option value="card">Cartão</option>
        <option value="note">Nota</option>
      </select></div>`,
    onSubmit: () => {
      const type = (m.root.querySelector('[name=type]') as HTMLSelectElement).value
      if (type === 'note') openNewNoteModal(slug)
      else openNewCardModal(slug)
    },
  })
}

function renderEmpty(panel: HTMLElement, items: Array<any>, root: HTMLElement) {
  const last = active(); const lastWd = items.find(w => w.slug === last)
  panel.innerHTML = `
    <div class="panel-empty">
      <div class="logo">ATLAS</div>
      <p class="tagline">O titã que sustenta os céus — cada projecto, o seu próprio mundo.</p>
      ${items.length ? `${lastWd ? `<button class="btn btn-ghost" id="reopen">${icon('sphere', 16)} Reabrir ${esc(lastWd.name)}</button>` : ''}` : `<p class="muted">Ainda não há workdirs. Cria o primeiro.</p>`}
      <button class="btn btn-primary" id="panel-new" style="margin-top:14px">${icon('plus', 16)} ${items.length ? 'Novo mundo' : 'Criar o primeiro mundo'}</button>
    </div>`
  root.querySelector('#panel-new')!.addEventListener('click', () => newWorkdir())
  const reopen = panel.querySelector('#reopen')
  if (reopen) reopen.addEventListener('click', () => { setActive(last); navigate('/w/' + last) })
}

export function newWorkdir() {
  openModal({
    title: 'Novo mundo', submitText: 'Criar',
    body: () => `<div class="field"><label for="wd-name">Nome</label><input id="wd-name" name="name" required></div>
                 <div class="field"><label for="wd-desc">Descrição <span class="muted">(opcional)</span></label><input id="wd-desc" name="description"></div>
                 <div class="field"><label for="wd-repo">Repo do projeto <span class="muted">(opcional)</span></label><input id="wd-repo" name="repo" placeholder="C:\...\projeto"></div>`,
    onSubmit: async () => {
      const form = document.querySelector('.modal form') as HTMLFormElement | null; if (!form) return
      const name = (form.querySelector('[name=name]') as HTMLInputElement).value
      const description = (form.querySelector('[name=description]') as HTMLInputElement).value
      const repo = (form.querySelector('[name=repo]') as HTMLInputElement)?.value.trim() || undefined
      if (!name.trim()) return
      try { const wd = await api.createWorkdir(name, description, repo); setActive(wd.slug); toast('Workdir criado'); navigate('/w/' + wd.slug) }
      catch (e: any) { toast('Erro: ' + e.message) }
    },
  })
}
function bindClockTz(shell: HTMLElement) {
  const btn = shell.querySelector('#clock-tz') as HTMLElement | null
  const pop = shell.querySelector('#tz-pop') as HTMLElement | null
  const sel = pop?.querySelector('select') as HTMLSelectElement | null
  if (!btn || !pop || !sel) return
  sel.innerHTML = TZ_LIST.map(z => `<option value="${z.id}"${z.id === getTz().id ? ' selected' : ''}>${z.label}</option>`).join('')
  const open = () => { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); sel.focus() }
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false') }
  btn.addEventListener('click', () => pop.hidden ? open() : close())
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pop.hidden ? open() : close() } })
  sel.addEventListener('change', () => { setTz(sel.value); close(); toast(`Fuso horário: ${getTz().label}`) })
  // Fora do relógio fecha o seletor. Listeners presos ao shell (re-criado a cada render) — sem acumulação.
  shell.addEventListener('click', e => { if (!pop.hidden && e.target !== btn && !pop.contains(e.target as Node)) close() })
  shell.addEventListener('keydown', e => { if (!pop.hidden && e.key === 'Escape') close() })
}

// ponytail: 1 fetch + render; falha silenciosa (mantem '--°'); re-tenta em 15min (TTL do cache em weather.ts).
// Loc hard-coded em Porto — trocar de fuso horario nao afecta a localizacao da meteo.
// Click no relogio abre o modal "previsão 7 dias" (mesma fonte do dashboard).
async function bindClockWeather(shell: HTMLElement) {
  const iconEl = shell.querySelector<HTMLElement>('[data-clock="wx-icon"]')
  const tempEl = shell.querySelector<HTMLElement>('[data-clock="wx-temp"]')
  const btn = shell.querySelector<HTMLElement>('[data-clock="wx"]')
  if (!iconEl || !tempEl || !btn) return
  const tick = async () => {
    try {
      const w = await fetchWeather()
      iconEl.innerHTML = icon(w.icon, 14)
      tempEl.textContent = `${Math.round(w.tempC)}°`
    } catch { /* offline: fica '--°' */ }
  }
  await tick()
  setInterval(tick, 15 * 60 * 1000)
  btn.addEventListener('click', e => { e.stopPropagation(); openWeatherWeekModal() })
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWeatherWeekModal() } })
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
