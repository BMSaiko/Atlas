// Fusos horários do relógio global. Estado persistido em localStorage (global, não por workdir).
// Sem libs: Intl.DateTimeFormat resolve a hora; lista curada ~13 zonas comuns.
export interface TzZone { id: string; badge: string; label: string }
export const TZ_LIST: TzZone[] = [
  { id: 'Europe/Lisbon', badge: 'PT', label: 'Lisboa (PT)' },
  { id: 'Europe/London', badge: 'UK', label: 'Londres (UK)' },
  { id: 'Europe/Paris', badge: 'FR', label: 'Paris (FR)' },
  { id: 'Europe/Berlin', badge: 'DE', label: 'Berlim (DE)' },
  { id: 'Europe/Madrid', badge: 'ES', label: 'Madrid (ES)' },
  { id: 'UTC', badge: 'UTC', label: 'UTC' },
  { id: 'America/New_York', badge: 'NY', label: 'Nova Iorque (US)' },
  { id: 'America/Chicago', badge: 'CHI', label: 'Chicago (US)' },
  { id: 'America/Los_Angeles', badge: 'LA', label: 'Los Angeles (US)' },
  { id: 'America/Sao_Paulo', badge: 'SP', label: 'São Paulo (BR)' },
  { id: 'Asia/Tokyo', badge: 'JP', label: 'Tóquio (JP)' },
  { id: 'Asia/Shanghai', badge: 'CN', label: 'Xangai (CN)' },
  { id: 'Australia/Sydney', badge: 'AU', label: 'Sydney (AU)' },
]
const KEY = 'atlas.tz'
export function getTz(): TzZone {
  try {
    const id = localStorage.getItem(KEY)
    if (id) { const z = TZ_LIST.find(z => z.id === id); if (z) return z }
  } catch {}
  return TZ_LIST[0]
}
export function setTz(id: string) {
  try { localStorage.setItem(KEY, id) } catch {}
}
