export type Prioridade = 'low' | 'medium' | 'high'
export interface Nota { id: string; title: string; text: string; ts: number; archived?: boolean }
export interface Card { id: string; colId: string; title: string; description: string; priority: Prioridade; ts: number; archived: boolean; result?: string; reviewed?: boolean; startedAt?: number }
export interface Coluna { id: string; name: string }
export interface Board { columns: Coluna[]; cards: Card[] }
export interface Workdir { slug: string; name: string; description?: string; createdAt: number; icon?: string }
export interface WorkdirMeta { slug: string; name: string; description: string; createdAt: number; icon?: string }

async function j<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error((data && data.error) || r.statusText)
  return data as T
}
export const api = {
  workdirs: () => j<Workdir[]>('/api/workdirs'),
  createWorkdir: (name: string, description?: string) => j<Workdir>('/api/workdirs', 'POST', { name, description }),
  patchWorkdir: (slug: string, patch: { name?: string; description?: string; icon?: string }) => j<Workdir>(`/api/workdirs/${slug}`, 'PATCH', patch),
  icons: () => j<{ icons: string[] }>('/api/icons').then(r => r.icons),
  deleteWorkdir: (slug: string) => j<{ ok: boolean }>(`/api/workdirs/${slug}`, 'DELETE'),
  meta: (slug: string) => j<WorkdirMeta>(`/api/w/${slug}`),
  notes: {
    get: (slug: string) => j<Nota[]>(`/api/w/${slug}/notes`),
    put: (slug: string, notes: Nota[]) => j<{ ok: boolean }>(`/api/w/${slug}/notes`, 'PUT', notes),
  },
  importRoadmap: (slug: string, path: string) => j<{ ok: boolean; addedCards: number; addedNotes: number; skipped: number; total: number }>(`/api/w/${slug}/import-roadmap`, 'POST', { path }),
  kanban: {
    get: (slug: string) => j<Board>(`/api/w/${slug}/kanban`),
    put: (slug: string, board: Board) => j<{ ok: boolean }>(`/api/w/${slug}/kanban`, 'PUT', board),
  },
  review: {
    approve: (slug: string, cardId: string) => j<{ ok: boolean; merge?: string }>(`/api/w/${slug}/review/approve`, 'POST', { cardId }),
    reject: (slug: string, cardId: string, note: string) => j<{ ok: boolean }>(`/api/w/${slug}/review/reject`, 'POST', { cardId, note }),
  },
}
export const uid = () => Math.random().toString(36).slice(2, 10)
