export function toast(msg: string) {
  let wrap = document.querySelector('.toast-wrap') as HTMLElement
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; wrap.setAttribute('aria-live','polite'); document.body.appendChild(wrap) }
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg
  wrap.appendChild(el)
  setTimeout(() => el.remove(), 3000)
}
