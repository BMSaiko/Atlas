import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

function startClock() {
  const set = () => {
    const h = new Date().getHours()
    const shift = h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night'
    document.documentElement.dataset.shift = shift
  }
  set(); setInterval(set, 60000)
}
startClock()

import { router } from './router'
router.init()
