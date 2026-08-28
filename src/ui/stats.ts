// Relatório de foco persistido — localStorage por data calendária.
// Contadores `cycle`/`chronoTotal` do pomodoro são só memória; este módulo
// acumula por dia (focusMs, sessões, pomodoros) numa janela de 90 dias.

export interface DailyStat { focusMs: number; sessions: number; pomodoros: number }
export type FocusStats = Record<string, DailyStat>

const KEY = 'atlas.foco.stats'
const WINDOW_DAYS = 90

function empty(): DailyStat { return { focusMs: 0, sessions: 0, pomodoros: 0 } }
function isoDay(d = new Date()): string { return d.toISOString().slice(0, 10) }

export function loadStats(): FocusStats {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}')
    return p && typeof p === 'object' ? p as FocusStats : {}
  } catch { return {} }
}
export function saveStats(s: FocusStats) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }

export function addFocus(ms: number, isPomodoro: boolean) {
  if (ms <= 0) return
  const s = loadStats()
  const k = isoDay()
  const e = s[k] || empty()
  e.focusMs += ms; e.sessions++
  if (isPomodoro) e.pomodoros++
  s[k] = e
  // purga das entradas anteriores à janela
  const cutoff = Date.now() - WINDOW_DAYS * 86400000
  for (const d in s) if (new Date(d).getTime() < cutoff) delete s[d]
  saveStats(s)
}

export function today(): DailyStat { return loadStats()[isoDay()] || empty() }

export function week(): DailyStat {
  const s = loadStats()
  const out = empty()
  const now = new Date()
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() - i)
    const e = s[d.toISOString().slice(0, 10)]
    if (e) { out.focusMs += e.focusMs; out.sessions += e.sessions; out.pomodoros += e.pomodoros }
  }
  return out
}
