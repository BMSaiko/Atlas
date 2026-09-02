// src/ui/snapshot-list.ts
// ponytail: lista snapshots com restore + descarregar file. 1 fetch por render. Inline na settings.
import { api } from '../api'
import { icon } from './icons'
import { toast } from './toast'
import { confirmDialog } from './confirm'

export async function renderSnapshotList(root: HTMLElement, slug: string) {
  const list = root.querySelector('#snap-list') as HTMLElement
  const runBtn = root.querySelector('#snap-run') as HTMLButtonElement | null
  if (!list || !runBtn) return

  const reload = async () => {
    const snaps = await api.snapshots.list(slug).catch(() => [] as any[])
    if (!snaps.length) {
      list.innerHTML = '<p class="muted">Sem snapshots. Clica "Snapshot agora" ou espera o próximo slot (00/06/12/18 UTC).</p>'
      return
    }
    list.innerHTML = snaps.map(s => {
      const pre = s.preRestoreOf ? ` <span class="muted">(pre-restore de ${s.preRestoreOf})</span>` : ''
      const sz = s.size >= 1024 ? `${(s.size / 1024).toFixed(1)} KB` : `${s.size} B`
      return `<div class="snap-row" data-slot="${esc(s.slot)}">
        <div><strong>${esc(s.slot.replace('/', ' '))}</strong> <span class="muted">${sz}${pre}</span></div>
        <div class="actions">
          <button class="btn btn-ghost" data-act="dl" data-kind="notes">notas</button>
          <button class="btn btn-ghost" data-act="dl" data-kind="kanban">kanban</button>
          <button class="btn btn-danger" data-act="restore">Restaurar</button>
        </div>
      </div>`
    }).join('')
  }
  await reload()

  runBtn.onclick = async () => {
    runBtn.disabled = true
    try {
      const r = await api.snapshots.run(slug)
      toast(r.deduped ? `Nada mudou (slot ${r.slot}, dedup)` : `Snapshot feito em ${r.slot}`)
      await reload()
    } catch (e: any) { toast('Falhou: ' + e.message) }
    finally { runBtn.disabled = false }
  }

  list.onclick = async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    const row = (e.target as HTMLElement).closest('.snap-row') as HTMLElement | null
    if (!btn || !row) return
    const slot = row.dataset.slot!, act = btn.dataset.act!, kind = btn.dataset.kind as 'meta' | 'notes' | 'kanban' | undefined
    if (act === 'dl' && kind) {
      try {
        const r = await fetch(api.snapshots.fileUrl(slug, slot, kind))
        if (!r.ok) { toast('404 — file nao existe neste snapshot'); return }
        const blob = await r.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `${slug}-${kind}-${slot.replace('/', '_')}.json`
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (err: any) { toast('Falhou: ' + err.message) }
    }
    if (act === 'restore') {
      const ok = await confirmDialog({
        title: 'Restaurar snapshot',
        message: `Restaurar ${slot}? O estado actual fica guardado como pre-restore (podes desfazer). Perdes tudo entre ${slot} e agora.`,
      })
      if (!ok) return
      try {
        const r = await api.snapshots.restore(slug, slot)
        toast(r.ok ? `Restaurado — pre-restore: ${r.preRestoreSlot}` : 'Falhou')
        await reload()
      } catch (e: any) { toast('Falhou: ' + e.message) }
    }
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
