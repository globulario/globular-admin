import '@globular/ui/styles/theme.css'
import '@globular/ui/styles/components.css'
import './styles/styles.css'

import "@globular/components/applicationLayout.js"
import '@globular/ui' // registers theme-toggle, user-toolbar

import "@fortawesome/fontawesome-free/css/all.min.css"
import 'toastify-js/src/toastify.css'

import { initGlobularApp } from '@globular/ui'
import { startRouter, navigateTo, clearPageCache } from './router'

initGlobularApp({ onNavigate: navigateTo })

startRouter()

// Clear cached pages on logout so stale content never bleeds into a new session
window.addEventListener('auth:changed', () => {
  if (!sessionStorage.getItem('__globular_token__')) clearPageCache()
})
