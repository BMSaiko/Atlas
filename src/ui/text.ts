export function linkify(s: unknown): string {
  const esc = String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  return esc.replace(/(https?:\/\/[^\s<"]+)/g, (url) => {
    const clean = url.replace(/[.,;:!?]+$/, '')
    return `<a class="link" href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`
  })
}

// ponytail: mini-markdown p/ texto livre das notas — sem lib externa.
// Teto (features fora do subconjunto pedido): *italic*, links markdown [x](url),
// listas numeradas/aninhadas, tabelas, enfase cross-line. Se fizer falta, troca-se
// o interior por `marked` mantendo a assinatura — nenhum caller muda.
export function renderMd(s: unknown): string {
  const esc = String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const inline = (t: string) => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<"]+)/g, (url: string) => {
      const clean = url.replace(/[.,;:!?]+$/, '')
      return `<a class="link" href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`
    })
  const lines = esc.split('\n')
  let html = ''
  let fence = false
  let buf: string[] = []
  let list: string[] | null = null
  const flushList = () => {
    if (list) { html += `<ul class="md-ul">${list.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`; list = null }
  }
  for (const raw of lines) {
    if (/^```\s*$/.test(raw)) {
      if (fence) { html += `<pre class="md-code"><code>${buf.join('\n')}</code></pre>`; buf = []; fence = false }
      else { flushList(); fence = true }
      continue
    }
    if (fence) { buf.push(raw); continue }
    const h = raw.match(/^(#{1,4})\s+(.*)/)
    if (h) { flushList(); const lv = Math.min(2 + h[1].length - 1, 4); html += `<h${lv} class="md-h">${inline(h[2])}</h${lv}>`; continue }
    const li = raw.match(/^[-*]\s+(.*)/)
    if (li) { if (!list) list = []; list.push(li[1]); continue }
    flushList()
    if (raw.trim() === '') continue
    html += `<p class="md-p">${inline(raw)}</p>`
  }
  flushList()
  if (fence) html += `<pre class="md-code"><code>${buf.join('\n')}</code></pre>`
  return html
}
