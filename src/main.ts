import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

import { router } from './router'
import { applyTheme } from './ui/theme'
applyTheme()
router.init()
