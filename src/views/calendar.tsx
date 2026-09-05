// ponytail: SP atlas-calendar-2026-09-05. Single-file React view (under SP's ~250 LOC cap).
// One network call on mount (events + kanban in parallel), one PUT per save. No polling,
// no new deps. CalendarEvent type + api.events.* live in src/api.ts (single source of truth).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type CalendarEvent } from '../api'
import { Icon } from '../ui/icon'
import { openModal, readForm } from '../ui/modal'
import { confirmDialog } from '../ui/confirm'
import { toast } from '../ui/toast'

// ymd: local-date YYYY-MM-DD (the user thinks in local — UTC drift would push events 1 day early/late)
function ymd(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1) }

// monthGrid: 42 days (6 weeks) starting on the Monday of the week containing day 1.
// ponytail: ceil instead of 35 because some months span 6 weeks (e.g. Aug 2026 starts Fri).
function monthGrid(focus: Date): Date[] {
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1)
  const dow = (first.getDay() + 6) % 7   // Mon=0..Sun=6 (JS day numbering: Sun=0..Sat=6)
  const start = new Date(focus.getFullYear(), focus.getMonth(), 1 - dow)
  const days: Date[] = []
  for (let i = 0; i < 42; i++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  return days
}

interface Deadline { date: string; cardId: string; title: string; priority: string }

export default function Calendar() {
  const nav = useNavigate()
  const [slug, setSlug] = useState<string | null>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [focus, setFocus] = useState<Date>(() => new Date())

  // ponytail: dashboard mode (no workdir selected) shows empty state. The calendar is per-workdir;
  // without slug the PUT has nowhere to go. Default = first workdir if any.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const wds = await api.workdirs()
        if (!cancel && wds[0]) setSlug(wds[0].slug)
      } catch { /* no workdirs -> empty state */ }
    })()
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    if (!slug) return
    let cancel = false
    ;(async () => {
      try {
        // ponytail: kanban removido em 2026-09-05 — deadlines derivavam de board.cards.
        // Calendar agora mostra apenas os events.json (calendar events do utilizador).
        const ev = await api.events.get(slug).catch(() => ({ events: [] }))
        if (cancel) return
        setEvents(ev.events || [])
        setDeadlines([])
      } catch { /* keep prior state on transient error */ }
    })()
    return () => { cancel = true }
  }, [slug])

  const grid = useMemo(() => monthGrid(focus), [focus])
  const today = ymd(new Date())
  const monthLabel = focus.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
  const dowLabels = useMemo(() => {
    // Anchor a known Monday (2024-01-01) so the labels are stable across re-renders.
    const ref = new Date(2024, 0, 1)
    return Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat('pt-PT', { weekday: 'short' }).format(new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + i))
    )
  }, [])

  const byDate = useMemo(() => {
    const m = new Map<string, { events: CalendarEvent[]; deadlines: Deadline[] }>()
    for (const d of grid) m.set(ymd(d), { events: [], deadlines: [] })
    for (const e of events) m.get(e.date)?.events.push(e)
    for (const dl of deadlines) m.get(dl.date)?.deadlines.push(dl)
    return m
  }, [grid, events, deadlines])

  // persist: optimistic local update + PUT. On error, surface toast (no rollback — server has its own wipe guard).
  function persist(next: CalendarEvent[]) {
    if (!slug) { toast('Selecione um mundo'); return }
    setEvents(next)
    api.events.put(slug, { events: next }).catch((e: any) => toast('Erro: ' + (e?.message || e)))
  }

  function openCreate(date: string) {
    if (!slug) { toast('Crie um mundo primeiro'); return }
    const body = () => `
      <label>Título <input name="title" required autocomplete="off"></label>
      <label>Data <input name="date" type="date" required value="${date}"></label>
      <label>Cor <select name="color">
        <option value="gold">Ouro</option>
        <option value="red">Vermelho</option>
        <option value="blue">Azul</option>
      </select></label>
      <label>Nota (opcional) <textarea name="note" rows="3"></textarea></label>
    `
    openModal({
      title: 'Novo evento',
      body,
      onSubmit: () => {
        const f = document.querySelector('.modal-backdrop form') as HTMLFormElement
        if (!f) return
        const data = readForm(f)
        const ev: CalendarEvent = {
          id: crypto.randomUUID(),
          title: (data.title || '').trim(),
          date: data.date,
          color: (data.color as CalendarEvent['color']) || 'gold',
          note: data.note?.trim() || undefined,
        }
        if (!ev.title) return
        persist([...events, ev])
        toast('Evento criado')
      },
    })
  }

  function openEdit(ev: CalendarEvent) {
    const body = () => `
      <label>Título <input name="title" required value="${escAttr(ev.title)}" autocomplete="off"></label>
      <label>Data <input name="date" type="date" required value="${ev.date}"></label>
      <label>Cor <select name="color">
        <option value="gold"${ev.color === 'gold' ? ' selected' : ''}>Ouro</option>
        <option value="red"${ev.color === 'red' ? ' selected' : ''}>Vermelho</option>
        <option value="blue"${ev.color === 'blue' ? ' selected' : ''}>Azul</option>
      </select></label>
      <label>Nota (opcional) <textarea name="note" rows="3">${escText(ev.note || '')}</textarea></label>
      <div class="modal-row" style="margin-top:.5rem"><button type="button" class="btn btn-danger" data-act="delete">Apagar</button></div>
    `
    const m = openModal({
      title: 'Editar evento',
      body,
      onSubmit: () => {
        const f = m.root.querySelector('form') as HTMLFormElement
        if (!f) return
        const data = readForm(f)
        persist(events.map(e => e.id === ev.id ? {
          ...e,
          title: (data.title || '').trim(),
          date: data.date,
          color: (data.color as CalendarEvent['color']) || 'gold',
          note: data.note?.trim() || undefined,
        } : e))
        toast('Evento guardado')
      },
    })
    const del = m.root.querySelector('[data-act=delete]') as HTMLButtonElement | null
    del?.addEventListener('click', async () => {
      const yes = await confirmDialog({ title: 'Apagar evento', message: `Apagar "${ev.title}"?`, confirmText: 'Apagar' })
      if (!yes) return
      persist(events.filter(e => e.id !== ev.id))
      m.close()
      toast('Evento apagado')
    })
  }

  if (!slug) {
    return <div className="cal-empty p-8 text-center text-text-dim">Calendário por mundo — crie um mundo para começar.</div>
  }

  return (
    <div className="cal p-4">
      <div className="cal-head flex items-center gap-3 mb-3">
        <button className="btn btn-ghost" onClick={() => setFocus(addMonths(focus, -1))} aria-label="Mês anterior"><Icon name="back" /></button>
        <h2 className="cal-title text-lg font-semibold flex-1 capitalize">{monthLabel}</h2>
        <button className="btn btn-ghost" onClick={() => setFocus(addMonths(focus, 1))} aria-label="Mês seguinte"><Icon name="forward" /></button>
        <button className="btn btn-primary" onClick={() => setFocus(new Date())}>Hoje</button>
      </div>
      <div className="cal-grid grid grid-cols-7 gap-1" role="grid" aria-label={`Calendário ${monthLabel}`}>
        {dowLabels.map((d, i) => <div key={i} className="cal-dow text-xs text-text-dim text-center py-1" role="columnheader">{d}</div>)}
        {grid.map((d, i) => {
          const k = ymd(d)
          const isOutside = d.getMonth() !== focus.getMonth()
          const isToday = k === today
          const items = byDate.get(k) || { events: [], deadlines: [] }
          return (
            <div key={i}
                 className={`cal-cell border border-line rounded p-1.5 min-h-[88px] flex flex-col gap-1 cursor-pointer${isOutside ? ' outside opacity-50' : ''}${isToday ? ' today ring-2 ring-[var(--gold)]' : ''}`}
                 role="gridcell" aria-label={k}
                 onClick={(e) => { if ((e.target as HTMLElement).closest('.cal-event,.cal-deadline')) return; openCreate(k) }}
                 data-outside={isOutside}>
              <div className="cal-day-num text-xs text-text-dim">{d.getDate()}{isToday ? ' · hoje' : ''}</div>
              {items.events.map(e => (
                <div key={e.id} className={`cal-event cal-ev-${e.color || 'gold'} text-xs px-1.5 py-0.5 rounded truncate`}
                     role="button" tabIndex={0}
                     title={e.title}
                     onClick={(ev) => { ev.stopPropagation(); openEdit(e) }}
                     onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEdit(e) } }}>
                  {e.title}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function escAttr(s: string) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }
function escText(s: string) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
