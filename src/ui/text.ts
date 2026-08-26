export function linkify(s: unknown): string {
  const esc = String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  return esc.replace(/(https?:\/\/[^\s<"]+)/g, (url) => {
    const clean = url.replace(/[.,;:!?]+$/, '')
    return `<a class="link" href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`
  })
}
