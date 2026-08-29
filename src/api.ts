export type Prioridade = 'urgent' | 'high' | 'medium' | 'low'
export interface Nota { id: string; title: string; text: string; ts: number; archived?: boolean; tags?: string[] }
export interface Card { id: string; colId: string; title: string; description: string; priority: Prioridade; due?: number; ts: number; archived: boolean; result?: string; dp?: string; reviewed?: boolean; startedAt?: number }
export interface Coluna { id: string; name: string }
export interface Board { columns: Coluna[]; cards: Card[] }
// optimistic concurrency: payloads com etag `ver` (escapam ao last-write-wins do PUT)
export type BoardDoc = { ver: number; columns: Coluna[]; cards: Card[] }
export type NotesDoc = { ver: number; items: Nota[] }
export interface Template { id: string; name: string; kind: 'note' | 'card'; title?: string; body?: string; priority?: Prioridade; colId?: string; tags?: string[] }
export interface Workdir { slug: string; name: string; description?: string; createdAt: number; icon?: string; repo?: string }
export interface WorkdirMeta { slug: string; name: string; description: string; createdAt: number; icon?: string; repo?: string }

async function j<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
  const data = await r.json().catch(() => null)
  if (!r.ok) { const err = new Error((data && data.error) || r.statusText); (err as any).status = r.status; throw err }
  return data as T
}
export const api = {
  workdirs: () => j<Workdir[]>('/api/workdirs'),
  createWorkdir: (name: string, description?: string) => j<Workdir>('/api/workdirs', 'POST', { name, description }),
  patchWorkdir: (slug: string, patch: { name?: string; description?: string; icon?: string; repo?: string }) => j<Workdir>(`/api/workdirs/${slug}`, 'PATCH', patch),
  reorderWorkdirs: (order: string[]) => j<Workdir[]>('/api/workdirs', 'PUT', { order }),
  icons: () => j<{ icons: string[] }>('/api/icons').then(r => r.icons),
  deleteWorkdir: (slug: string) => j<{ ok: boolean }>(`/api/workdirs/${slug}`, 'DELETE'),
  meta: (slug: string) => j<WorkdirMeta>(`/api/w/${slug}`),
  notes: {
    get: (slug: string) => j<{ ver: number; items: Nota[] }>(`/api/w/${slug}/notes`),
    put: (slug: string, doc: { ver: number; items: Nota[] }) => j<{ ok: boolean; ver?: number }>(`/api/w/${slug}/notes`, 'PUT', doc),
  },
  importRoadmap: (slug: string, path: string) => j<{ ok: boolean; addedCards: number; addedNotes: number; skipped: number; total: number }>(`/api/w/${slug}/import-roadmap`, 'POST', { path }),
  exportNotes: (slug: string) => j<{ ok: boolean; count: number }>(`/api/w/${slug}/export`, 'POST'),
  templates: { get: (slug: string) => j<Template[]>(`/api/w/${slug}/templates`) },
  kanban: {
    get: (slug: string) => j<{ ver: number; columns: Coluna[]; cards: Card[] }>(`/api/w/${slug}/kanban`),
    put: (slug: string, doc: { ver: number; columns: Coluna[]; cards: Card[] }) => j<{ ok: boolean; ver?: number }>(`/api/w/${slug}/kanban`, 'PUT', doc),
  },
  orchestrator: {
    start: (slug?: string) => j<{ ok: boolean; moved: number }>(slug ? `/api/orchestrator/start/${encodeURIComponent(slug)}` : '/api/orchestrator/start', 'POST'),
  },

  review: {
    approve: (slug: string, cardId: string) => j<{ ok: boolean; merge?: string }>(`/api/w/${slug}/review/approve`, 'POST', { cardId }),
    reject: (slug: string, cardId: string, p: { note?: string; title?: string; description?: string; priority?: Prioridade }) => j<{ ok: boolean }>(`/api/w/${slug}/review/reject`, 'POST', { cardId, ...p }),
  },
  run: {
    // stream incremental do log do run headless (terminal a trabalhar / debugging)
    output: (slug: string, cardId: string, offset = 0) => j<{ ok: boolean; started: boolean; done: boolean; code: number | null; chunk: string; offset: number; size: number }>(`/api/w/${slug}/output/${cardId}?offset=${offset}`),
  },
}
export const uid = () => Math.random().toString(36).slice(2, 10)
