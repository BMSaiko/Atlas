// Tema (dia/entardecer/noite) + época do ano (estação). Cada dimensão tem modo
// auto/manual. Estado persistido em localStorage — global ao dashboard.
// ponytail: JSON minusculo em 1 chave. Sem store external: 6 setters bastam.

export type Shift = 'day' | 'dusk' | 'night'
export type Season = 'winter' | 'spring' | 'summer' | 'autumn'
export type ThemeMode = 'auto' | 'manual'

const KEY = 'atlas.theme'

interface Theme {
  mode: ThemeMode
  shift: Shift
  season: Season
  seasonMode: ThemeMode
}

function isShift(s: unknown): s is Shift {
  return s === 'day' || s === 'dusk' || s === 'night'
}
function isSeason(s: unknown): s is Season {
  return s === 'winter' || s === 'spring' || s === 'summer' || s === 'autumn'
}

function read(): Theme {
  // backward-compat: o objeto velho {mode,shift} sem season/seasonMode le como auto + estação do mês.
  const fallback: Theme = { mode: 'auto', shift: 'night', season: autoSeason(), seasonMode: 'auto' }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '')
    return {
      mode: raw?.mode === 'manual' ? 'manual' : 'auto',
      shift: isShift(raw?.shift) ? raw.shift : 'night',
      season: isSeason(raw?.season) ? raw.season : autoSeason(),
      seasonMode: raw?.seasonMode === 'manual' ? 'manual' : 'auto',
    }
  } catch { return fallback }
}

function write(t: Theme) {
  try { localStorage.setItem(KEY, JSON.stringify(t)) } catch {}
}

const SHIFT_NAMES: Record<Shift, string> = { day: 'Dia', dusk: 'Entardecer', night: 'Noite' }
/** Marcos do tema automatico — fonte unica (autoShift deriva dele). */
const SHIFT_TIMES: Array<{ shift: Shift; from: number }> = [
  { shift: 'day', from: 7 },
  { shift: 'dusk', from: 17 },
  { shift: 'night', from: 20 },
]
const HH = (h: number) => `${String(h).padStart(2, '0')}:00`
/** Shift que a hora atual implicaria, se estivesse em modo auto. */
export function autoShift(now = new Date()): Shift {
  const h = now.getHours()
  for (let i = SHIFT_TIMES.length - 1; i >= 0; i--) if (h >= SHIFT_TIMES[i].from) return SHIFT_TIMES[i].shift
  return SHIFT_TIMES[SHIFT_TIMES.length - 1].shift
}
/** Horarios dos temas automaticos, prontos a mostrar na UI. */
export function shiftSchedule(): Array<{ shift: Shift; label: string; range: string }> {
  return SHIFT_TIMES.map((s, i) => {
    const next = SHIFT_TIMES[(i + 1) % SHIFT_TIMES.length].from
    return { shift: s.shift, label: SHIFT_NAMES[s.shift], range: `${HH(s.from)} – ${HH(next)}` }
  })
}

const SEASON_NAMES: Record<Season, string> = { winter: 'Inverno', spring: 'Primavera', summer: 'Verão', autumn: 'Outono' }
/** Estação que o mês atual implicaria, em modo auto (hemisfério norte, PT). */
export function autoSeason(now = new Date()): Season {
  const m = now.getMonth() // 0..11
  if (m <= 1 || m === 11) return 'winter' // dez, jan, fev
  if (m <= 4) return 'spring'             // mar, abr, mai
  if (m <= 7) return 'summer'             // jun, jul, ago
  return 'autumn'                          // set, out, nov
}
/** Faixas de meses das estações, prontas a mostrar na UI. */
export function seasonSchedule(): Array<{ season: Season; label: string; range: string }> {
  return [
    { season: 'winter', label: SEASON_NAMES.winter, range: 'Dez – Fev' },
    { season: 'spring', label: SEASON_NAMES.spring, range: 'Mar – Mai' },
    { season: 'summer', label: SEASON_NAMES.summer, range: 'Jun – Ago' },
    { season: 'autumn', label: SEASON_NAMES.autumn, range: 'Set – Nov' },
  ]
}

export function applyShift(s: Shift) {
  document.documentElement.dataset.shift = s
}
export function applySeason(s: Season) {
  document.documentElement.dataset.season = s
}

export function getTheme(): Theme {
  return read()
}

/** Aplica o que deve estar ativo agora: shift (auto pela hora, ou manual) + estação (auto, se aplicável). */
export function applyTheme() {
  const t = read()
  applyShift(t.mode === 'manual' ? t.shift : autoShift())
  if (t.seasonMode === 'auto') applySeason(autoSeason())
}

export function setManual(shift: Shift) {
  write({ ...read(), mode: 'manual', shift })
  applyShift(shift)
}

/** Alterna entre automático e manual mantendo o tema visualmente estável. */
export function setMode(mode: ThemeMode) {
  const t = read()
  const cur: Shift = (document.documentElement.dataset.shift as Shift) || t.shift
  const shift = mode === 'auto' ? autoShift() : cur
  write({ ...t, mode, shift })
  applyShift(shift)
}

export function setAuto() {
  const t = read()
  const shift = autoShift()
  write({ ...t, mode: 'auto', shift })
  applyShift(shift)
}

// --- Época do ano (estação), dimensão paralela ao shift ---
export function setSeason(s: Season) {
  write({ ...read(), season: s, seasonMode: 'manual' })
  applySeason(s)
}

/** Alterna o modo de estação mantendo a estação visualmente estável. */
export function setSeasonMode(mode: ThemeMode) {
  const t = read()
  const cur: Season = (document.documentElement.dataset.season as Season) || t.season || autoSeason()
  const season = mode === 'auto' ? autoSeason() : cur
  write({ ...t, season, seasonMode: mode })
  applySeason(season)
}
