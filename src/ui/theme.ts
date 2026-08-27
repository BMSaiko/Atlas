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

/** Shift que a hora atual implicaria, se estivesse em modo auto. */
export function autoShift(now = new Date()): Shift {
  const h = now.getHours()
  return h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night'
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
