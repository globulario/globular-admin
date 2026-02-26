import './styles/styles.css'
import './styles/theme.css'

import "@globular/components/applicationLayout.js"
import './widgets/user_toolbar'
import './widgets/theme_toggle'

import "@fortawesome/fontawesome-free/css/all.min.css"
import 'toastify-js/src/toastify.css'

import { applyTheme, watchSystemTheme } from './theme/theme'
import { Backend, getEventClient, setNavigateHandler } from "@globular/backend"
import { startRouter, navigateTo, clearPageCache } from './router'

setNavigateHandler(navigateTo)
Backend.init(() => getEventClient())
applyTheme()
watchSystemTheme()
startRouter()

// Clear cached pages on logout so stale content never bleeds into a new session
window.addEventListener('auth:changed', () => {
  if (!sessionStorage.getItem('__globular_token__')) clearPageCache()
})
