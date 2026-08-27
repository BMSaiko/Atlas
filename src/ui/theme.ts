// Tema (dia/entardecer/noite). Modo auto segue a hora do dia; manual fixa o tema.
// Estado persistido em localStorage — global ao dashboard, nao por workdir.
// ponytail: JSON minusculo em 1 chave. Sem store external: 4 setters bastam.

export type Shift = 'day' | 'dusk' | 'night'
export type ThemeMode = 'auto' | 'manual'

const KEY = 'atlas.theme'

interface Theme { mode: ThemeMode; shift: Shift }

function isShift(s: unknown): s is Shift {
  return s === 'day' || s === 'dusk' || s === 'night'
}

function read(): Theme {
  const fallback: Theme = { mode: 'auto', shift: 'night' }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '')
    return {
      mode: raw?.mode === 'manual' ? 'manual' : 'auto',
      shift: isShift(raw?.shift) ? raw.shift : 'night',
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

export function applyShift(s: Shift) {
  document.documentElement.dataset.shift = s
}

export function getTheme(): Theme {
  return read()
}

/** Aplica o tema que deve estar ativo agora (auto pela hora, ou o manual). */
export function applyTheme() {
  const t = read()
  applyShift(t.mode === 'manual' ? t.shift : autoShift())
}

export function setManual(shift: Shift) {
  write({ mode: 'manual', shift })
  applyShift(shift)
}

/** Alterna entre automático e manual mantendo o tema visualmente estável. */
export function setMode(mode: ThemeMode) {
  const cur: Shift = (document.documentElement.dataset.shift as Shift) || read().shift
  const shift = mode === 'auto' ? autoShift() : cur
  write({ mode, shift })
  applyShift(shift)
}

export function setAuto() {
  const shift = autoShift()
  write({ mode: 'auto', shift })
  applyShift(shift)
}
