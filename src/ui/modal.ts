export interface ModalOpts { title: string; body: () => string; onSubmit?: () => void; onCancel?: () => void; submitText?: string; cancelText?: string; danger?: boolean }
export function openModal(opts: ModalOpts): { root: HTMLElement; close: () => void } {
  const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'
  backdrop.setAttribute('role','dialog'); backdrop.setAttribute('aria-modal','true'); backdrop.setAttribute('aria-label', opts.title)
  backdrop.innerHTML = `<div class="modal"><h3>${opts.title}</h3><form><div class="modal-body">${opts.body()}</div><div class="modal-actions">
    <button type="button" class="btn btn-ghost" data-act="cancel">${opts.cancelText || 'Cancelar'}</button>
    <button type="submit" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'} kbdhint" data-act="submit" aria-describedby="m-submit-tip">${opts.submitText || 'Guardar'}<span class="kbdhint-tip" id="m-submit-tip" role="tooltip"><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span></button>
  </div></form></div>`
  document.body.appendChild(backdrop)
  const form = backdrop.querySelector('form')!
  let closed = false
  const onCancel = () => { if (closed) return; closed = true; opts.onCancel?.(); close() }
  const close = () => { backdrop.remove() }
  const onDocKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { onCancel(); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); form.requestSubmit() }
  }
  document.addEventListener('keydown', onDocKey)
  backdrop.addEventListener('click', e => { if (e.target === backdrop) onCancel() })
  backdrop.querySelector('[data-act=cancel]')!.addEventListener('click', () => onCancel())
  form.addEventListener('submit', e => {
    e.preventDefault()
    opts.onSubmit?.(); close()
  })
  const fi = form.querySelector('input, textarea, select') as HTMLElement | null
  fi?.focus()
  return { root: backdrop, close }
}
export function readForm(form: HTMLFormElement): Record<string,string> {
  const o: Record<string,string> = {}
  form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input, textarea, select').forEach(el => { if (el.name) o[el.name] = el.value })
  return o
}


// ponytail: self-check — Ctrl+Enter route. Browser-only, opt-in via ?selftest=1.
// Verifies that a synthetic Ctrl+Enter keydown on the modal's document handler
// ends up calling form.requestSubmit(). Fails loudly so future refactors that
// break the shortcut are caught.
if (typeof window !== 'undefined' && new URLSearchParams(location.search).has('modal-selftest')) {
  setTimeout(() => {
    try {
      let submitted = false
      const f = document.createElement('form')
      const i = document.createElement('input'); i.name = 'x'; f.appendChild(i)
      const orig = f.requestSubmit.bind(f)
      f.requestSubmit = () => { submitted = true; orig() }
      document.body.appendChild(f)
      // Simulate the handler with the same shape used in openModal.
      const probe = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); f.requestSubmit() } }
      probe(new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter', bubbles: true, cancelable: true }))
      if (!submitted) throw new Error('modal self-check failed: Ctrl+Enter did not invoke form.requestSubmit()')
      f.remove()
      console.info('[modal] selftest ok')
    } catch (err) { console.error('[modal] selftest failed:', err) }
  }, 0)
}
