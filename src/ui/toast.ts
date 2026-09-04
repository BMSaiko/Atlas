export function toast(msg: string, duration = 5000) {
  let wrap = document.querySelector('.toast-wrap') as HTMLElement
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; wrap.setAttribute('aria-live','polite'); document.body.appendChild(wrap) }

  const el = document.createElement('div'); el.className = 'toast'
  const text = document.createElement('span'); text.className = 'toast-msg'; text.textContent = msg
  const bar = document.createElement('div'); bar.className = 'toast-bar'
  el.append(text, bar)
  wrap.appendChild(el)

  let remaining = duration
  let timer = 0
  let lastTs = performance.now()

  const tick = (ts: number) => {
    remaining -= ts - lastTs
    lastTs = ts
    if (remaining <= 0) { bar.style.width = '0%'; dispose(); return }
    bar.style.width = (remaining / duration * 100) + '%'
    timer = requestAnimationFrame(tick)
  }

  const dispose = () => {
    cancelAnimationFrame(timer)
    el.remove()
  }

  const pause = () => { cancelAnimationFrame(timer) }     // hover congela
  const resume = () => { lastTs = performance.now(); timer = requestAnimationFrame(tick) }

  bar.style.width = '100%'
  timer = requestAnimationFrame(tick)
  el.addEventListener('mouseenter', pause)
  el.addEventListener('mouseleave', resume)
}
