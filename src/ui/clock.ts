// Relógio global — hora do fuso selecionado (default Portugal). Sem libs: Intl.DateTimeFormat + timeZone.
// O badge `.clock-tz` mostra o fuso ativo; clique abre o seletor (ver shell.ts).
import { getTheme, applyTheme } from './theme'
import { getTz } from './timezones'

export function startClockWidget(root: HTMLElement) {
  const timeEl = root.querySelector<HTMLElement>('[data-clock="time"]')
  if (!timeEl) return 0
  const dateEl = root.querySelector<HTMLElement>('[data-clock="date"]')
  const tzEl = root.querySelector<HTMLElement>('[data-clock="tz"]')
  const tick = () => {
    const tz = getTz().id
    const now = new Date()
    timeEl.textContent = new Intl.DateTimeFormat('pt-PT', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)
    if (dateEl) dateEl.textContent = new Intl.DateTimeFormat('pt-PT', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short' }).format(now)
    if (tzEl) tzEl.textContent = getTz().badge
    // Em modo auto o tema segue a hora; em manual fica fixo (nao reescreve).
    if (getTheme().mode === 'auto' || getTheme().seasonMode === 'auto') applyTheme()
  }
  tick()
  return window.setInterval(tick, 1000)
}
