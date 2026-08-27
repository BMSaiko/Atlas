// Relógio de relojaria — hora real de Portugal continental (Europe/Lisbon).
// Sem libs: Intl.DateTimeFormat + timeZone. Tabular-nums via CSS.
import { getTheme, applyTheme } from './theme'

export function startClockWidget(root: HTMLElement) {
  const timeEl = root.querySelector<HTMLElement>('[data-clock="time"]')
  if (!timeEl) return 0
  const dateEl = root.querySelector<HTMLElement>('[data-clock="date"]')
  const tz = 'Europe/Lisbon'
  const tFmt = new Intl.DateTimeFormat('pt-PT', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dFmt = new Intl.DateTimeFormat('pt-PT', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short' })

  const tick = () => {
    const now = new Date()
    timeEl.textContent = tFmt.format(now)
    if (dateEl) dateEl.textContent = dFmt.format(now)
    // Em modo auto o tema segue a hora do dia; em manual fica fixo (nao reescreve).
    if (getTheme().mode === 'auto') applyTheme()
  }
  tick()
  return window.setInterval(tick, 1000)
}
