// Open-Meteo: free, sem chave, CORS OK. CC BY 4.0 obrigatorio.
// fetch nativo + cache em memoria (TTL 15min) — sem lib, sem classe.
// WMO weather_code (subset ~10 entradas; cair fora do mapa -> "—").
export interface Weather {
  tempC: number
  code: number
  label: string
  icon: 'sun' | 'moon' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'
  time: string  // ISO local do Porto (timezone=auto)
}

const TTL_MS = 15 * 60 * 1000
const cache = new Map<string, { at: number; data: Weather }>()

export function describe(code: number): { label: string; icon: Weather['icon'] } {
  if (code === 0) return { label: 'Céu limpo', icon: 'sun' }
  if (code === 1 || code === 2) return { label: 'Parcialmente nublado', icon: 'cloud' }
  if (code === 3) return { label: 'Encoberto', icon: 'cloud' }
  if (code >= 45 && code <= 48) return { label: 'Nevoeiro', icon: 'fog' }
  if (code >= 51 && code <= 67) return { label: 'Chuva', icon: 'rain' }
  if (code >= 71 && code <= 77) return { label: 'Neve', icon: 'snow' }
  if (code >= 80 && code <= 82) return { label: 'Aguaceiros', icon: 'rain' }
  if (code >= 95) return { label: 'Trovoada', icon: 'storm' }
  return { label: '—', icon: 'cloud' }
}

const URL = (lat: number, lon: number) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`

export async function fetchWeather(lat = 41.15, lon = -8.61): Promise<Weather> {
  const k = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = cache.get(k)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data
  const r = await fetch(URL(lat, lon))
  if (!r.ok) throw new Error(`open-meteo ${r.status}`)
  const j = await r.json()
  const c = j.current
  const w: Weather = { tempC: c.temperature_2m, code: c.weather_code, time: c.time, ...describe(c.weather_code) }
  cache.set(k, { at: Date.now(), data: w })
  return w
}

export function weatherAgeLabel(iso: string): string {
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit' }).format(d)
  } catch { return '—' }
}

export interface WeatherDay {
  iso: string          // "YYYY-MM-DD" no fuso do Porto
  code: number
  minC: number
  maxC: number
  label: string
  icon: Weather['icon']
}

// ponytail: mesma TTL + cache key do Weather; um fetch paralelo a mais, zero duplicacao de icon/label
export interface Forecast { days: WeatherDay[]; fetchedAt: number }
const fcCache = new Map<string, Forecast>()
const FC_TTL = 15 * 60 * 1000

const FC_URL = (lat: number, lon: number) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
  `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`

export async function fetchForecast(lat = 41.15, lon = -8.61): Promise<Forecast> {
  const k = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = fcCache.get(k)
  if (hit && Date.now() - hit.fetchedAt < FC_TTL) return hit
  const r = await fetch(FC_URL(lat, lon))
  if (!r.ok) throw new Error(`open-meteo forecast ${r.status}`)
  const j = await r.json()
  const t: string[] = j.daily.time
  const code: number[] = j.daily.weather_code
  const tmin: number[] = j.daily.temperature_2m_min
  const tmax: number[] = j.daily.temperature_2m_max
  const days: WeatherDay[] = t.map((iso, i) => {
    const d = describe(code[i])
    return { iso, code: code[i], minC: tmin[i], maxC: tmax[i], label: d.label, icon: d.icon }
  })
  const f: Forecast = { days, fetchedAt: Date.now() }
  fcCache.set(k, f)
  return f
}

// ponytail: devolve "Sex" ou "Sex · 30 ago" — curto para a semana, mais detalhe quando >7d (futuro)
export function weekdayLabel(iso: string): string {
  try {
    const d = new Date(iso + 'T12:00:00')
    return new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: '2-digit', month: 'short' }).format(d)
  } catch { return '—' }
}
