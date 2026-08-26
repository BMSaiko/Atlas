export interface ModalOpts { title: string; body: () => string; onSubmit?: () => void; onCancel?: () => void; submitText?: string; cancelText?: string; danger?: boolean }
export function openModal(opts: ModalOpts): { root: HTMLElement; close: () => void } {
  const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'
  backdrop.setAttribute('role','dialog'); backdrop.setAttribute('aria-modal','true'); backdrop.setAttribute('aria-label', opts.title)
  backdrop.innerHTML = `<div class="modal"><h3>${opts.title}</h3><form><div class="modal-body">${opts.body()}</div><div class="modal-actions">
    <button type="button" class="btn btn-ghost" data-act="cancel">${opts.cancelText || 'Cancelar'}</button>
    <button type="submit" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-act="submit">${opts.submitText || 'Guardar'}</button>
  </div></form></div>`
  document.body.appendChild(backdrop)
  const form = backdrop.querySelector('form')!
  const close = () => { backdrop.remove() }
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close() })
  backdrop.querySelector('[data-act=cancel]')!.addEventListener('click', () => { opts.onCancel?.(); close() })
  form.addEventListener('submit', e => {
    e.preventDefault()
    if (opts.danger && !confirm('Tem a certeza? Esta acção é irreversível.')) return
    opts.onSubmit?.(); close()
  })
  // focus first input
  const fi = form.querySelector('input, textarea, select') as HTMLElement | null
  fi?.focus()
  return { root: backdrop, close }
}
export function readForm(form: HTMLFormElement): Record<string,string> {
  const o: Record<string,string> = {}
  form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input, textarea, select').forEach(el => { if (el.name) o[el.name] = el.value })
  return o
}
