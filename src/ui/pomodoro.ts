// Cronómetro + Pomodoro — sessões de foco no sidebar.
// Sem libs: estado a nível de módulo (sobrevive à navegação), um único interval de tick,
// DOM atualizado por data-attributes (sem re-render). Durações persistidas em localStorage.

import { icon } from './icons'
import { openModal } from './modal'
import { toast } from './toast'

type Mode = 'chrono' | 'pomo'
type Phase = 'focus' | 'break'

interface PomodoroState {
  mode: Mode
  running: boolean
  // cronómetro (conta para cima)
  chronoTotal: number       // ms acumulados (excluindo a fração corrente)
  chronoStart: number       // Date.now() quando running; 0 senão
  // pomodoro (conta para baixo)
  phase: Phase
  cycle: number             // pomodoros completos
  phaseLeft: number         // ms restantes na fase atual
  phaseStart: number        // Date.now() quando running; 0 senão
  focusMin: number
  breakMin: number
}

const LSK = 'atlas.pomo'
const def = { focusMin: 25, breakMin: 5 }

function loadCfg(): { focusMin: number; breakMin: number } {
  try {
    const raw = localStorage.getItem(LSK)
    if (!raw) return { ...def }
    const p = JSON.parse(raw)
    return { focusMin: clamp(+p.focusMin || def.focusMin, 1, 120), breakMin: clamp(+p.breakMin || def.breakMin, 1, 60) }
  } catch { return { ...def } }
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)) }
function saveCfg() { try { localStorage.setItem(LSK, JSON.stringify({ focusMin: st.focusMin, breakMin: st.breakMin })) } catch {} }

// ponytail: estado de módulo — sobrevive a re-renders do shell/navegação
const st: PomodoroState = { mode: 'chrono', running: false, chronoTotal: 0, chronoStart: 0, phase: 'focus', cycle: 0, phaseLeft: loadCfg().focusMin * 60000, phaseStart: 0, focusMin: loadCfg().focusMin, breakMin: loadCfg().breakMin }

function now() { return Date.now() }
let starter = 0
function bootTick() {
  if (starter) return
  starter = window.setInterval(render, 250)
}
function render() {
  const disp = document.getElementById('pomo-display')
  if (!disp) return
  if (st.mode === 'chrono') {
    const total = st.chronoTotal + (st.running ? now() - st.chronoStart : 0)
    disp.textContent = fmtChrono(total)
  } else {
    let left = st.phaseLeft - (st.running ? now() - st.phaseStart : 0)
    if (left <= 0 && st.running) advanceAny()
    disp.textContent = fmtCount(left)
  }
  const sub = document.getElementById('pomo-sub')
  if (sub) sub.textContent = subLabel()
  setBtn()
}

function advanceAny() {
  // foco terminado? pausa terminada? avança automático e reinicia o countdown
  const dir = st.phase === 'focus' ? 1 : -1
  if (st.phase === 'focus') { st.cycle++; notify(`Foco concluído — pausa de ${st.breakMin} min`) }
  else notify('Pausa terminada — de volta ao foco')
  st.phase = dir === 1 ? 'break' : 'focus'
  st.phaseLeft = (st.phase === 'focus' ? st.focusMin : st.breakMin) * 60000
  st.phaseStart = now()
}
function notify(msg: string) {
  toast(msg)
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Atlas · Pomodoro', { body: msg }) } catch {}
  }
}
function subLabel(): string {
  if (st.mode === 'chrono') return 'Cronómetro'
  const label = st.phase === 'focus' ? 'Foco' : 'Pausa'
  return `${label} · ciclo ${st.cycle}`
}
function setBtn() {
  const b = document.getElementById('pomo-toggle')
  if (!b) return
  // ponytail: rótulo pelo estado; para pomodoro em contagem decrescente até 0, pausa
  const iconname = st.running ? 'pause' : 'play'
  b.innerHTML = `${icon(iconname, 14)} ${st.running ? 'Pausar' : 'Iniciar'}`
}
function fmtChrono(ms: number): string {
  const h = Math.floor(ms/3600000), m = Math.floor(ms/60000)%60, s = Math.floor(ms/1000)%60
  return h>0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
function fmtCount(ms: number): string {
  const m = Math.max(0, Math.floor(ms/60000)), s = Math.max(0, Math.floor(ms/1000)%60)
  return `${pad(m)}:${pad(s)}`
}
function pad(n: number) { return String(n).padStart(2, '0') }

// ---- mount: injeta o widget no container e liga eventos (chamado em cada render do shell) ----
export function pomoMount(root: HTMLElement) {
  root.innerHTML = `
    <div class="pomo" id="pomo">
      <div class="pomo-head">
        <span class="pomo-title">${icon('timer', 14)} Foco</span>
        <div class="pomo-seg" id="pomo-seg" role="tablist" aria-label="Modo temporizador">
          <button class="pomo-seg-btn" data-pmode="chrono" role="tab" aria-selected="true">Cronómetro</button>
          <button class="pomo-seg-btn" data-pmode="pomo" role="tab">Pomodoro</button>
        </div>
      </div>
      <div class="pomo-display" id="pomo-display" aria-live="off">00:00</div>
      <div class="pomo-sub" id="pomo-sub"></div>
      <div class="pomo-ctrl">
        <button class="btn btn-primary btn-sm" id="pomo-toggle">${icon('play', 14)} Iniciar</button>
        <button class="btn-icon btn-ghost" id="pomo-reset" aria-label="Reiniciar" title="Reiniciar">${icon('reset', 15)}</button>
        <button class="btn-icon btn-ghost" id="pomo-settings" aria-label="Definir durações" title="Durações">${icon('gear', 15)}</button>
      </div>
    </div>`

  root.querySelectorAll<HTMLElement>('.pomo-seg-btn').forEach(b => b.addEventListener('click', () => {
    st.mode = b.dataset.pmode as Mode
    st.running = false
    if (st.mode === 'chrono') { st.chronoStart = 0 }
    else { st.phaseStart = 0; if (st.phaseLeft <= 0) st.phaseLeft = st.focusMin * 60000 }
    refreshSegment(); toggleLabel()
  }))

  root.querySelector('#pomo-toggle')!.addEventListener('click', () => {
    st.running = !st.running
    const t = now()
    if (st.running) {
      if (st.mode === 'chrono') st.chronoStart = t
      else { if (st.phaseLeft <= 0) st.phaseLeft = st.focusMin * 60000; st.phaseStart = t }
    } else {
      if (st.mode === 'chrono') st.chronoTotal += t - st.chronoStart
      else st.phaseLeft = Math.max(0, st.phaseLeft - (t - st.phaseStart))
      st.chronoStart = st.phaseStart = 0
    }
    toggleLabel()
  })

  root.querySelector('#pomo-reset')!.addEventListener('click', () => {
    st.running = false
    st.chronoTotal = 0; st.chronoStart = 0
    st.phase = 'focus'; st.cycle = 0
    st.phaseLeft = st.focusMin * 60000; st.phaseStart = 0
    toggleLabel(); const d = document.getElementById('pomo-display'); if (d) d.textContent = st.mode==='chrono' ? '00:00' : fmtCount(st.phaseLeft)
  })

  root.querySelector('#pomo-settings')!.addEventListener('click', () => {
    openModal({
      title: 'Durações do Pomodoro', submitText: 'Guardar',
      body: () => `<div class="field"><label for="p-focus">Foco (minutos)</label><input id="p-focus" name="focus" type="number" min="1" max="120" value="${st.focusMin}"></div>
        <div class="field"><label for="p-break">Pausa (minutos)</label><input id="p-break" name="break" type="number" min="1" max="60" value="${st.breakMin}"></div>`,
      onSubmit: () => {
        const form = document.querySelector('.modal form') as HTMLFormElement
        const f = clamp(parseInt((form.querySelector('[name=focus]') as HTMLInputElement).value) || def.focusMin, 1, 120)
        const b = clamp(parseInt((form.querySelector('[name=break]') as HTMLInputElement).value) || def.breakMin, 1, 60)
        st.focusMin = f; st.breakMin = b
        if (!st.running && st.mode === 'pomo' && st.cycle === 0 && st.phase === 'focus') st.phaseLeft = f * 60000
        saveCfg(); refreshSegment(); const d = document.getElementById('pomo-display'); if (d) d.textContent = fmtCount(st.phaseLeft)
        toast('Durações guardadas')
      },
    })
  })

  refreshSegment(); toggleLabel()
  bootTick()
  const d = document.getElementById('pomo-display'); if (d) d.textContent = st.mode==='chrono' ? fmtChrono(st.chronoTotal) : fmtCount(st.phaseLeft)
}

function refreshSegment() {
  const seg = document.getElementById('pomo-seg'); if (!seg) return
  seg.querySelectorAll<HTMLElement>('.pomo-seg-btn').forEach(b => {
    const active = b.dataset.pmode === st.mode
    b.classList.toggle('active', active); if (active) b.setAttribute('aria-selected','true'); else b.removeAttribute('aria-selected')
  })
}
function toggleLabel() {
  const d = document.getElementById('pomo-display')
  if (!d) return
  if (st.mode === 'chrono') d.textContent = fmtChrono(st.chronoTotal + (st.running ? now() - st.chronoStart : 0))
  else d.textContent = fmtCount(st.phaseLeft - (st.running ? now() - st.phaseStart : 0))
  const sub = document.getElementById('pomo-sub'); if (sub) sub.textContent = subLabel()
}
