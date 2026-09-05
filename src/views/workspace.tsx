import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api, type WorkdirMeta } from '../api'
import { Icon } from '../ui/icon'
import { refreshTabCounts } from '../ui/counts'
import { renderNotes } from './notes-vanilla'
import { renderSettings } from './settings-vanilla'
import { renderWorldDashboard } from './dashboard-vanilla'
import { linkify } from '../ui/text'

type Tab = 'dash' | 'notes'

export default function Workspace() {
  const { slug } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [meta, setMeta] = useState<WorkdirMeta | null>(null)
  const [err, setErr] = useState(false)
  const [tab, setTab] = useState<Tab>(() => {
    const qtab = searchParams.get('tab') as Tab | null
    if (qtab === 'notes' || qtab === 'dash') return qtab
    try {
      const v = slug ? localStorage.getItem(`atlas.tab.${slug}`) : null
      if (v === 'notes' || v === 'dash') return v as Tab
    } catch {}
    return 'dash'
  })
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!slug) return
    api.meta(slug).then(m => {
      if (!m || (m as any).error) setErr(true)
      else { setMeta(m); try { localStorage.setItem('atlas.active', slug) } catch {} }
    })
  }, [slug])

  useEffect(() => {
    if (!meta || !contentRef.current || !slug) return
    const content = contentRef.current
    content.innerHTML = ''
    if (tab === 'dash') renderWorldDashboard(content, { slug, name: meta.name, description: meta.description, icon: meta.icon })
    else if (tab === 'notes') renderNotes(content, slug)
    refreshTabCounts(slug).catch(() => {})
    const openId = searchParams.get('open')
    if (openId) {
      const target = content.querySelector<HTMLElement>(`[data-id="${openId}"]`)
      target?.click()
      const next = new URLSearchParams(searchParams); next.delete('open')
      setSearchParams(next, { replace: true })
    }
  }, [meta, tab, slug])

  useEffect(() => {
    if (!slug) return
    const TAB_ORDER: Tab[] = ['dash', 'notes']
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (document.querySelector('.modal-backdrop')) return
      if (!e.altKey) return
      const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
      if (!delta) return
      const i = TAB_ORDER.indexOf(tab)
      if (i < 0) return
      e.preventDefault()
      const next = TAB_ORDER[(i + delta + TAB_ORDER.length) % TAB_ORDER.length]
      setTab(next)
      try { localStorage.setItem(`atlas.tab.${slug}`, next) } catch {}
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, slug])

  if (err) return <div className="empty">Workdir não encontrado</div>
  if (!meta) return <div className="empty">A carregar…</div>

  return (
    <div className="ws">
      <div className="pan-head">
        <div className="pan-title">
          <h1>{meta.name}</h1>
          <div className="desc" dangerouslySetInnerHTML={{ __html: linkify(meta.description || '') }} />
        </div>
      </div>
      <nav className="ws-tabs" id="tabs">
        <button className={`ws-tab ${tab === 'dash' ? 'active' : ''}`} data-tab="dash" id="tab-dash" data-cmd="ui.tab-dash" title="Alt+← / Alt+→" onClick={() => setTab('dash')}>
          <Icon name="sphere" size={16} /> Dashboard
        </button>
        <button className={`ws-tab ${tab === 'notes' ? 'active' : ''}`} data-tab="notes" id="tab-notes" data-cmd="ui.tab-notes" title="Alt+← / Alt+→" onClick={() => setTab('notes')}>
          <Icon name="note" size={16} /> Notas
        </button>
      </nav>
      <div id="ws-content" ref={contentRef} />
    </div>
  )
}
