import { openModal } from './modal'

export function confirmDialog(o: { title: string; message: string; confirmText?: string }): Promise<boolean> {
  return new Promise(res => {
    let done = false
    openModal({
      title: o.title, submitText: o.confirmText || 'Eliminar', danger: true, cancelText: 'Cancelar',
      body: () => `<p>${esc(o.message)}</p>`,
      onSubmit: () => { done = true; res(true) },
      onCancel: () => { if (!done) res(false) },
    })
  })
}
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
