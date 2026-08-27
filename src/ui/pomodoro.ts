// Sessão de foco — o Foco é uma experiência imersiva a pedido (overlay), não um widget fixo no sidebar.
// Sem libs: estado a nível de módulo (sobrevive à navegação), um único interval de tick,
// DOM por data-attributes (sem re-render). Durações persistidas em localStorage.
// Cronómetro = satélite a orbitar; Pomodoro = anel que se esvazia. Escape/backdrop fecha.

import { icon } from './icons'
import { openModal } from './modal'
import { toast } from './toast'
import { notify as notifyBrowser } from './notifs'

type Mode = 'chrono' | 'pomo'
type Phase = 'focus' | 'break'

interface FocusState {
  mode: Mode
  running: boolean
  chronoTotal: number       // ms acumulados do cronómetro
  chronoStart: number       // Date.now() quando running; 0 senão
  phase: Phase
  cycle: number             // pomodoros completos
  phaseLeft: number         // ms restantes na fase atual
  phaseStart: number        // Date.now() quando running; 0 senão
  focusMin: number
  breakMin: number
}

const LSK = 'atlas.foco'
const C = { focusMin: 25, breakMin: 5 }
const CIRC = 540 // 2*PI*86, raio do anel em viewBox

function loadCfg(): { focusMin: number; breakMin: number } {
  try {
    const p = JSON.parse(localStorage.getItem(LSK) || '')
    return { focusMin: clamp(+p.focusMin || C.focusMin, 1, 120), breakMin: clamp(+p.breakMin || C.breakMin, 1, 60) }
  } catch { return { ...C } }
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }
function saveCfg() { try { localStorage.setItem(LSK, JSON.stringify({ focusMin: st.focusMin, breakMin: st.breakMin })) } catch {} }

// ponytail: state de módulo — sobrevive a re-renders do shell/navegação
const st: FocusState = {
  mode: 'chrono', running: false, chronoTotal: 0, chronoStart: 0,
  phase: 'focus', cycle: 0, phaseLeft: loadCfg().focusMin * 60000, phaseStart: 0,
  focusMin: loadCfg().focusMin, breakMin: loadCfg().breakMin,
}

let ticker = 0
function bootTick() {
  if (ticker) return
  ticker = window.setInterval(tick, 250)
}
function tick() {
  renderPill()
  if (document.getElementById('foco-ov')?.hidden === false) renderOverlay()
}

function elElapsed(): number { return st.chronoTotal + (st.running ? now() - st.chronoStart : 0) }
function countLeft(): number {
  let left = st.phaseLeft - (st.running ? now() - st.phaseStart : 0)
  if (left <= 0 && st.running) advancePhase()
  return Math.max(0, left)
}
function now() { return Date.now() }

function advancePhase() {
  if (st.phase === 'focus') { st.cycle++; notify(`Foco concluído — pausa de ${st.breakMin} min`) }
  else notify('Pausa terminada — de volta ao foco')
  st.phase = st.phase === 'focus' ? 'break' : 'focus'
  st.phaseLeft = (st.phase === 'focus' ? st.focusMin : st.breakMin) * 60000
  st.phaseStart = now()
}
function notify(msg: string) {
  notifyBrowser('Atlas · Foco', msg)
}

// ---------- pill (entrada discreta, sem bloat) ----------
export function mountFocus(root: HTMLElement) {
  root.innerHTML = `<button class="foco-launch" id="foco-launch" aria-label="Sessão de foco" title="Abrir sessão de foco">
      <span class="foco-li">${icon('timer', 16)}</span><span class="foco-lbl" id="foco-lbl">Foco</span><span class="foco-meta" id="foco-meta"></span></button>`
  root.querySelector('#foco-launch')!.addEventListener('click', () => openOverlay())
  bootTick()
}

// ---------- overlay imersivo ----------
let built = false
function buildOverlay() {
  if (built) return
  built = true
  const el = document.createElement('div')
  el.id = 'foco-ov'; el.className = 'foco-ov'; el.hidden = true
  el.innerHTML = `
    <div class="foco-card" role="dialog" aria-modal="true" aria-label="Sessão de foco">
      <div class="foco-seg" id="foco-seg">
        <button class="foco-seg-btn" data-fmode="chrono">Cronómetro</button>
        <button class="foco-seg-btn" data-fmode="pomo">Pomodoro</button>
      </div>
      <div class="foco-ring">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle class="orb" cx="100" cy="100" r="86"/>
          <circle class="orb" cx="100" cy="100" r="76"/>
          <circle class="arc" id="foco-arc" cx="100" cy="100" r="86" transform="rotate(-90 100 100)"
            stroke-dasharray="${CIRC}" stroke-dashoffset="0"/>
        </svg>
        <div class="foco-sat" id="foco-sat"><i></i></div>
        <div class="foco-num-wrap">
          <div class="foco-num" id="foco-num">00:00</div>
          <div class="foco-sub" id="foco-sub">Cronómetro</div>
        </div>
      </div>
      <div class="foco-ctrl">
        <button class="btn btn-primary" id="foco-toggle">${icon('play', 16)} Iniciar</button>
        <button class="btn-icon btn-ghost" id="foco-reset" aria-label="Reiniciar" title="Reiniciar">${icon('reset', 18)}</button>
        <button class="btn-icon btn-ghost" id="foco-settings" aria-label="Durações" title="Durações">${icon('gear', 18)}</button>
      </div>
      <div class="foco-hint">Escape para fechar</div>
    </div>`
  document.body.appendChild(el)

  el.querySelectorAll<HTMLElement>('.foco-seg-btn').forEach(b => b.addEventListener('click', () => {
    st.mode = b.dataset.fmode as Mode
    st.running = false
    if (st.mode === 'chrono') st.chronoStart = 0
    else { st.phaseStart = 0; if (st.phaseLeft <= 0) st.phaseLeft = st.focusMin * 60000 }
    refreshSegment(); renderOverlay(); renderPill()
  }))

  el.querySelector('#foco-toggle')!.addEventListener('click', () => {
    st.running = !st.running
    const t = now()
    if (st.running) {
      if (st.mode === 'chrono') st.chronoStart = t
      else { if (st.phaseLeft <= 0) st.phaseLeft = st.focusMin * 60000; st.phaseStart = t }
      const sat = document.getElementById('foco-sat'); if (sat) { sat.style.animationDuration = '60s'; sat.style.animationPlayState = 'running' }
    } else {
      if (st.mode === 'chrono') st.chronoTotal += t - st.chronoStart
      else st.phaseLeft = Math.max(0, st.phaseLeft - (t - st.phaseStart))
      st.chronoStart = st.phaseStart = 0
      const sat = document.getElementById('foco-sat'); if (sat) sat.style.animationPlayState = 'paused'
    }
    renderOverlay(); renderPill()
  })

  el.querySelector('#foco-reset')!.addEventListener('click', () => {
    st.running = false
    st.chronoTotal = 0; st.chronoStart = 0
    st.phase = 'focus'; st.cycle = 0
    st.phaseLeft = st.focusMin * 60000; st.phaseStart = 0
    const sat = document.getElementById('foco-sat'); if (sat) sat.style.animationPlayState = 'paused'
    renderOverlay(); renderPill()
  })

  el.querySelector('#foco-settings')!.addEventListener('click', () => {
    openModal({
      title: 'Durações do Pomodoro', submitText: 'Guardar',
      body: () => `<div class="field"><label for="p-focus">Foco (minutos)</label><input id="p-focus" name="focus" type="number" min="1" max="120" value="${st.focusMin}"></div>
        <div class="field"><label for="p-break">Pausa (minutos)</label><input id="p-break" name="break" type="number" min="1" max="60" value="${st.breakMin}"></div>`,
      onSubmit: () => {
        const form = document.querySelector('.modal form') as HTMLFormElement
        const f = clamp(parseInt((form.querySelector('[name=focus]') as HTMLInputElement).value) || C.focusMin, 1, 120)
        const b = clamp(parseInt((form.querySelector('[name=break]') as HTMLInputElement).value) || C.breakMin, 1, 60)
        st.focusMin = f; st.breakMin = b
        if (!st.running && st.mode === 'pomo' && st.cycle === 0 && st.phase === 'focus') st.phaseLeft = f * 60000
        saveCfg(); refreshSegment(); renderOverlay(); renderPill()
        toast('Durações guardadas')
      },
    })
  })

  el.addEventListener('click', e => { if (e.target === el) { el.hidden = true; renderPill() } })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.hidden) { el.hidden = true; renderPill() }
  })
}

function openOverlay() {
  buildOverlay()
  const el = document.getElementById('foco-ov')!
  el.hidden = false
  refreshSegment(); renderOverlay()
}

function refreshSegment() {
  const seg = document.getElementById('foco-seg'); if (!seg) return
  seg.querySelectorAll<HTMLElement>('.foco-seg-btn').forEach(b => {
    const active = b.dataset.fmode === st.mode
    b.classList.toggle('active', active); if (active) b.setAttribute('aria-selected', 'true'); else b.removeAttribute('aria-selected')
  })
}

// ---------- render ----------
function phaseLabel(): string {
  const p = st.phase === 'focus' ? 'Foco' : 'Pausa'
  return `${p} · ciclo ${st.cycle}`
}
function fmtChrono(ms: number): string {
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
function fmtClock(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000)), s = Math.max(0, Math.floor(ms / 1000) % 60)
  return `${pad(m)}:${pad(s)}`
}
function pad(n: number) { return String(n).padStart(2, '0') }

function renderOverlay() {
  const num = document.getElementById('foco-num'), sub = document.getElementById('foco-sub')
  const arc = document.getElementById('foco-arc') as SVGCircleElement | null
  const sat = document.getElementById('foco-sat') as HTMLElement | null
  const tg = document.getElementById('foco-toggle'); if (tg) tg.innerHTML = `${icon(st.running ? 'pause' : 'play', 16)} ${st.running ? 'Pausar' : 'Iniciar'}`
  if (!num || !sub) return
  if (st.mode === 'chrono') {
    num.textContent = fmtChrono(elElapsed())
    sub.textContent = 'Cronómetro'
    if (arc) { arc.style.opacity = '0'; arc.setAttribute('stroke-dashoffset', String(CIRC)) }
    if (sat) { sat.style.opacity = '1'; }
  } else {
    const left = countLeft()
    num.textContent = fmtClock(left)
    sub.textContent = phaseLabel()
    const total = (st.phase === 'focus' ? st.focusMin : st.breakMin) * 60000
    const frac = total > 0 ? left / total : 0
    if (arc) { arc.style.opacity = '1'; arc.setAttribute('stroke-dashoffset', String(CIRC * (1 - frac))) }
    if (sat) sat.style.opacity = '0'
  }
}

function renderPill() {
  const pill = document.getElementById('foco-launch'), lbl = document.getElementById('foco-lbl'), meta = document.getElementById('foco-meta')
  if (!pill || !lbl) return
  pill.classList.toggle('running', st.running)
  if (st.mode === 'pomo' && st.running) {
    lbl.textContent = 'Pomodoro'
    if (meta) meta.textContent = fmtClock(countLeft())
  } else if (st.mode === 'chrono' && st.running) {
    lbl.textContent = 'Cronómetro'
    if (meta) meta.textContent = fmtChrono(elElapsed())
  } else {
    lbl.textContent = 'Foco'
    if (meta) meta.textContent = ''
  }
}
