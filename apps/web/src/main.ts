import '@globular/ui/styles/theme.css'
import '@globular/ui/styles/components.css'
import './styles/styles.css'

import "@globular/components/applicationLayout.js"
import '@globular/ui' // registers theme-toggle, user-toolbar
import './widgets/peer_discovery'

import "@fortawesome/fontawesome-free/css/all.min.css"
import 'toastify-js/src/toastify.css'

import { initGlobularApp } from '@globular/ui'
import { startRouter, navigateTo } from './router'

initGlobularApp({ onNavigate: navigateTo })

startRouter()
