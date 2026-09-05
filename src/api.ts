export type Prioridade = 'urgent' | 'high' | 'medium' | 'low'
export interface Nota { id: string;
  title: string; text: string; ts: number; archived?: boolean; tags?: string[] }

// ponytail: 2026-09-05 strip-kanban — Card/Coluna/Board/MichiPhase removidos (kanban removido).
// Mantidos apenas os tipos de bundle (WorkdirBundle.kanban e' opcional, preservado para compat
// de ficheiros antigos).
// ponytail: write-token fence (card iykn11lg) — header global em TODOS os PUTs (j<T> é o unico helper
// que toca fetch no cliente). Resolucao (ordem): URL ?token=... -> localStorage ->
// server /api/wtoken em background (loopback-only, mesma fence que o PUT). Sem o endpoint /api/wtoken,
// abrir localhost:5173 sem ?token=... caia em 401 permanente; agora o client puxa o token uma vez e guarda.
// Top-level await NAO usado (target esbuild chrome87 nao suporta) — j<T> awaits _wtokenReady
// antes do PUT se ainda nao tiver token em maos.
let _atlasToken: string = ''
let _wtokenReady: Promise<void> | null = null
try {
  const q = new URL(location.href).searchParams.get('token')
  if (q) { localStorage.setItem('atlas.wtoken', q); _atlasToken = q }
  else _atlasToken = localStorage.getItem('atlas.wtoken') || ''
} catch { /* SSR / localStorage indisponivel */ }
// ponytail: dispara o fetch /api/wtoken em background IMEDIATAMENTE (se nao temos token) para o caso
// de o utilizador abrir a app sem ?token=... e sem localStorage. j<T> awaita este promise antes de PUT.
if (!_atlasToken) {
  _wtokenReady = (async () => {
    try {
      const r = await fetch('/api/wtoken', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json().catch(() => null)
      if (d && typeof d.token === 'string' && d.token) {
        localStorage.setItem('atlas.wtoken', d.token)
        _atlasToken = d.token
      }
    } catch { /* dev remoto sem loopback -> 403, fica sem token, PUTs vao falhar */ }
  })()
}

// optimistic concurrency: payloads com etag `ver` (escapam ao last-write-wins do PUT)
export type NotesDoc = { ver: number; items: Nota[] }
export interface Template { id: string; name: string; kind: 'note' | 'card'; title?: string; body?: string; priority?: Prioridade; colId?: string; tags?: string[] }
export interface Workdir { slug: string; name: string; description?: string; createdAt: number; icon?: string; repo?: string }
export interface LogEntry { id: string; ts: number; kind: 'review' | 'brainstorm' | 'due'; slug: string; title: string; body: string; ref: { cardId?: string; cardTitle?: string } | null; level: 'info' | 'ok' | 'warn' | 'err' }
export interface WorkdirMeta { slug: string; name: string; description: string; createdAt: number; icon?: string; repo?: string }
// ponytail: SP atlas-calendar-2026-09-05 — CalendarEvent lives next to other domain types so
// the calendar view imports it from api.ts (single source of truth, mirrors how Nota/Card are organised).
export interface CalendarEvent { id: string; title: string; date: string; color?: 'gold'|'red'|'blue'; note?: string }

async function j<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  // ponytail: se o token ainda nao foi puxado do server, aguarda (max 1.5s). Evita 401 no 1o PUT
  // quando o utilizador abriu a app sem ?token=... e sem localStorage.
  if (_wtokenReady && !_atlasToken) {
    await Promise.race([_wtokenReady, new Promise<void>(r => setTimeout(r, 1500))])
  }
  const headers: Record<string, string> = body !== undefined ? { 'Content-Type': 'application/json' } : {}
  if (_atlasToken) headers['X-Atlas-Token'] = _atlasToken  // card iykn11lg: fence anti-corrida
  const r = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const data = await r.json().catch(() => null)
  if (!r.ok) { const err = new Error((data && data.error) || r.statusText); (err as any).status = r.status; throw err }
  return data as T
}
export const api = {
  workdirs: () => j<Workdir[]>('/api/workdirs'),
  createWorkdir: (name: string, description?: string, repo?: string) => j<Workdir>('/api/workdirs', 'POST', { name, description, repo }),
  patchWorkdir: (slug: string, patch: { name?: string; description?: string; icon?: string; repo?: string }) => j<Workdir>(`/api/workdirs/${slug}`, 'PATCH', patch),
  reorderWorkdirs: (order: string[]) => j<Workdir[]>('/api/workdirs', 'PUT', { order }),
  icons: () => j<{ icons: string[] }>('/api/icons').then(r => r.icons),
  deleteWorkdir: (slug: string) => j<{ ok: boolean }>(`/api/workdirs/${slug}`, 'DELETE'),
  meta: (slug: string) => j<WorkdirMeta>(`/api/w/${slug}`),
  notes: {
    get: (slug: string) => j<{ ver: number; items: Nota[] }>(`/api/w/${slug}/notes`),
    put: (slug: string, doc: { ver: number; items: Nota[] }) => j<{ ok: boolean; ver?: number }>(`/api/w/${slug}/notes`, 'PUT', doc),
  },

  exportNotes: (slug: string) => j<{ ok: boolean; count: number }>(`/api/w/${slug}/export`, 'POST'),
  bundle: {
    get: (slug: string) => j<WorkdirBundle>(`/api/w/${slug}/bundle`),
    put: (slug: string, doc: { meta: WorkdirMeta; notes: { ver: number; items: Nota[] }; kanban?: unknown }) => j<{ ok: boolean }>(`/api/w/${slug}/bundle`, 'PUT', doc),
  },
  // ponytail: snapshots — 4/dia, retenção 7d. UI chama list/run/restore. fileUrl é URL crua (a API serve application/json).
  snapshots: {
    list: (slug: string) => j<Array<{ slot: string; ts: number; size: number; files: Record<string, { hash: string; size: number } | null>; preRestoreOf?: string }>>(`/api/w/${slug}/snapshots`),
    run: (slug: string) => j<{ ok: boolean; slot: string; deduped: boolean; pruned: number }>(`/api/w/${slug}/snapshots`, 'POST'),
    restore: (slug: string, slot: string) => j<{ ok: boolean; preRestoreSlot: string }>(`/api/w/${slug}/snapshots/${encodeURIComponent(slot)}/restore`, 'POST'),
    fileUrl: (slug: string, slot: string, name: 'meta' | 'notes' | 'kanban') => `/api/w/${slug}/snapshots/${encodeURIComponent(slot)}/file/${name}`,
  },
  templates: { get: (slug: string) => j<Template[]>(`/api/w/${slug}/templates`) },


  // ponytail: SP atlas-calendar-2026-09-05 — calendar events. Flat array, no `ver` (no OT).
  // Mirror of notes/kanban shape (get/put) so the call-site reads identically.
  events: {
    get: (slug: string) => j<{ events: CalendarEvent[] }>(`/api/w/${slug}/events`),
    put: (slug: string, doc: { events: CalendarEvent[] }) => j<{ ok: boolean }>(`/api/w/${slug}/events`, 'PUT', doc),
  },
  logs: {
    get: (slug: string) => j<{ ver: number; items: LogEntry[] }>(`/api/w/${slug}/logs`),
    put: (slug: string, doc: { items: LogEntry[] }) => j<{ ok: boolean; cleared?: boolean; count?: number }>(`/api/w/${slug}/logs`, 'PUT', doc),
  },
  chat: {
    history: () => j<{ conversation: any; messages: ChatMsg[]; conversations: any[]; current: string }>('/api/chat/history'),
    send: (text: string) => j<{ ok: boolean; runId: string; ts: number; conversationId: string }>('/api/chat/send', 'POST', { text }),
    output: (runId: string, offset = 0) => j<{ ok: boolean; started: boolean; done: boolean; code: number | null; chunk: string; offset: number; size: number }>(`/api/chat/output/${runId}?offset=${offset}`),
    clear: () => j<{ ok: boolean }>('/api/chat/history', 'DELETE'),
    conversations: () => j<{ current: string; conversations: Array<{ id: string; title: string; createdAt: number; updatedAt: number; msgCount: number }> }>('/api/chat/conversations'),
    newConversation: () => j<{ conversation: any; messages: ChatMsg[]; conversations: any[]; current: string }>('/api/chat/conversation/new', 'POST'),
    switchConversation: (id: string) => j<{ conversation: any; messages: ChatMsg[]; conversations: any[]; current: string }>('/api/chat/conversation/switch', 'POST', { id }),
    deleteConversation: (id: string) => j<{ current: string; conversations: any[] }>(`/api/chat/conversation/${id}`, 'DELETE'),
  },
  hermes: {
    keys: () => j<HermesKey[]>('/api/hermes/keys'),
    usage: () => j<HermesUsage>('/api/hermes/usage'),
  },
}
// ponytail: chat history messages. role = 'user' (mandei) | 'agent' (hermes respondeu). text cru sem markdown parsed.
export interface ChatMsg { role: 'user' | 'agent'; text: string; ts: number; runId?: string; actions?: any[]; err?: string }
// hermes/keys -> lista de API keys configuradas no Hermes (censor: NUNCA traz access_token do server).
export type HermesKeyStatus = 'active' | 'exhausted' | 'error' | 'unknown'
export interface HermesKey {
  provider: string; id: string | null; label: string | null; source: string | null
  auth_type: string | null; base_url: string | null; priority: number | null
  status: HermesKeyStatus
  last_status: number | null; last_status_at: string | null
  last_error_code: number | null; last_error_reason: string | null
  last_error_message: string | null; last_error_reset_at: string | null
  request_count: number; secret_fingerprint: string | null
  has_token: boolean
}
// hermes/usage -> agregado por key_id do JSONL de usage (HERMES_HOME/logs/atlas/usage.jsonl).
// Server aplica since=inicio-do-dia local quando ausente. Sem ficheiro -> totals_by_key: {} (rc 200).
export interface HermesUsageKey {
  requests: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  last_ts?: number
  model?: string
  provider?: string
}
export interface HermesUsage {
  since: number
  generated_at: number
  totals_by_key: Record<string, HermesUsageKey>
}
// bundle -> snapshot portatil do workdir (meta+notes+kanban). Backup/restore manual, fora do git.
export interface WorkdirBundle {
  slug: string
  meta: WorkdirMeta
  notes: { ver: number; items: Nota[] }
  kanban?: unknown  // ponytail: shape preservado para bundles antigos. Card/Coluna removidos; opaque agora.
  ts: number
}
export const uid = () => Math.random().toString(36).slice(2, 10)

// ponytail: OrphanRun removido em 2026-09-05 — kanban removido.



