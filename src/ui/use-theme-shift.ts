import { useEffect, useState } from 'react'
import {
  autoShift as autoShiftFn, autoSeason as autoSeasonFn,
  applyShift as applyShiftFn, applySeason as applySeasonFn,
  type Shift, type Season,
} from './theme'

// ponytail: SP §7 step 10 â useThemeShift reads time on mount, sets data-shift/data-season
// on <html>. Mount-guarded: no SSR, useEffect only. Schedules a 60s interval to re-evaluate.
// next-themes orthogonally sets class="dark" via <ThemeProvider>.

export function useThemeShift() {
  const [shift, setShift] = useState<Shift>('night')
  const [season, setSeason] = useState<Season>('autumn')

  useEffect(() => {
    const update = () => {
      const s = autoShiftFn()
      const w = autoSeasonFn()
      setShift(s); setSeason(w)
      applyShiftFn(s); applySeasonFn(w)
    }
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [])

  return { shift, season }
}
