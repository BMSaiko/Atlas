// Relógio de relojaria — hora real de Portugal continental (Europe/Lisbon).
// Sem libs: Intl.DateTimeFormat + timeZone. Tabular-nums via CSS.

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
    // Hora atual tambem reflete a luminosidade do dia (data-shift)
    const h = now.getHours()
    const shift = h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night'
    if (document.documentElement.dataset.shift !== shift) document.documentElement.dataset.shift = shift
  }
  tick()
  return window.setInterval(tick, 1000)
}
