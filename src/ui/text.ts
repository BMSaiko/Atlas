export function linkify(s: unknown): string {
  const esc = String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')
  return esc.replace(/(https?:\/\/[^\s<"]+)/g, (url) => {
    const clean = url.replace(/[.,;:!?]+$/, '')
    return `<a class="link" href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`
  })
}

// ponytail: parser minimo de subconjunto markdown (headers, bold, listas, code) — sem lib.
// Escapa SEMPRE primeiro (via esc()) e so depois aplica tags estruturais que ELE gera;
// conteudo nunca e reemitido como HTML (backticks/fences escapados) -> XSS-safe.
// Tetos (documentados): sem *italic*, sem links markdown [x](url), sem tabelas, sem listas
// numeradas/aninhadas, sem enfase cross-line (--inline por linha).
// Upgrade path: trocar o interior por `marked` mantendo a interface (renderMd/esc).
export function renderMd(s: unknown): string {
  const src = String(s ?? '').replace(/\r\n/g, '\n').split('\n')
  const inline = (t: string) => t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s<"]+)/g, (u) => {
      const clean = u.replace(/[.,;:!?]+$/, '')
      return `<a class="link" href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`
    })
  const out: string[] = []
  const list: string[] = []
  let code: string[] | null = null
  const flushList = () => { if (list.length) { out.push('<ul class="md-ul">' + list.map((li) => `<li>${inline(esc(li))}</li>`).join('') + '</ul>'); list.length = 0 } }
  const flushCode = () => { out.push('<pre class="md-code"><code>' + code!.map(esc).join('\n') + '</code></pre>') }
  for (const raw of src) {
    if (/^```/.test(raw)) {
      if (code) { flushCode(); code = null }
      else { flushList(); code = [] }
      continue
    }
    if (code) { code.push(raw); continue }
    const hm = raw.match(/^#{1,4}\s+(.*)$/)
    if (hm) {
      flushList()
      const n = Math.min(raw.match(/^#+/)![0].length, 4)
      const tag = n >= 4 ? 'h4' : 'h' + (n + 1) // #->h2, ##->h3, ###/####->h4
      out.push(`<${tag} class="md-h">${inline(esc(hm[1]))}</${tag}>`)
      continue
    }
    const lm = raw.match(/^\s*[-*]\s+(.*)$/)
    if (lm) { list.push(lm[1].trim()); continue }
    if (raw.trim() === '') { flushList(); continue }
    flushList()
    out.push(`<p class="md-p">${inline(esc(raw))}</p>`)
  }
  flushList()
  if (code) flushCode()
  return out.join('\n')
}
function esc(s: string): string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')
}
