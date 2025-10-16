
import './styles/styles.css'
import './styles/theme.css'

import './components/applicationLayout.js'
import './widgets/user_toolbar' // registers <user-toolbar>
import { startRouter } from './router'

// Register pages
import './pages/dashboard'
import './pages/cluster_overview'
import './pages/cluster_peers'
import './pages/cluster_services'
import './pages/cluster_apps'
import './pages/cluster_dns'
import './pages/rbac_accounts'
import './pages/rbac_orgs'
import './pages/rbac_groups'
import './pages/rbac_roles'
import './pages/cms_browser'
import './pages/console_shell'
import './pages/repo_market'

// css
import "@fortawesome/fontawesome-free/css/all.min.css";
import 'toastify-js/src/toastify.css';

// src/main.ts
import './widgets/user_toolbar'
import './widgets/theme_toggle'
import './widgets/peer_discovery'

// src/main.ts
import { applyTheme, watchSystemTheme } from './theme/theme'
applyTheme();           // set from localStorage or system
watchSystemTheme();     // keep in sync if "system"

startRouter()
