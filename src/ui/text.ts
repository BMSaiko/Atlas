export function linkify(s: unknown): string {
  const esc = String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')
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
    if (list) { html += `<ul class="md-ul">${list.map(x => x[0] === '<' ? x : `<li>${inline(x)}</li>`).join('')}</ul>`; list = null }
  }
  for (let idx = 0; idx < lines.length; idx++) { const raw = lines[idx]
    if (/^```\s*$/.test(raw)) {
      if (fence) { html += `<pre class="md-code"><code>${buf.join('\n')}</code></pre>`; buf = []; fence = false }
      else { flushList(); fence = true }
      continue
    }
    if (fence) { buf.push(raw); continue }
    const h = raw.match(/^(#{1,4})\s+(.*)/)
    if (h) { flushList(); const lv = Math.min(2 + h[1].length - 1, 4); html += `<h${lv} class="md-h">${inline(h[2])}</h${lv}>`; continue }
    // task antes da lista generica: `- [ ] foo` tem de casar aqui (senão cai no <li> morto e o toggle não renderiza) — DI 29/08
    const task = raw.match(/^[-*]\s+\[([ xX])\]\s*(.*)/)
    if (task) {
      const done = task[1].toLowerCase() === 'x'
      if (!list) list = []
      list.push(`<li class="md-task"${done ? ' data-done' : ''}><input type="checkbox" class="md-task-cb" data-i="${idx}" ${done ? 'checked' : ''} aria-label="Marcar"> <span class="md-task-txt">${inline(task[2])}</span></li>`)
      continue
    }
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
