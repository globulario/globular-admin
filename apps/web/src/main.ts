
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
import './pages/console_shell'
import './pages/repo_market'
import './pages/medias'

// css
import "@fortawesome/fontawesome-free/css/all.min.css";
import 'toastify-js/src/toastify.css';

// src/main.ts
import './widgets/user_toolbar'
import './widgets/theme_toggle'
import './widgets/peer_discovery'

// src/main.ts
import { applyTheme, watchSystemTheme } from './theme/theme'

// main.ts
import { Backend } from "./backend/backend";
import { getEventClient } from "./backend/event/event"; // your factory for EventServiceClient
import { getBaseUrl } from "./backend/core/endpoints";
import { restoreSession, enableVisibilityAutoRefresh } from "./backend/core/auth";


//restoreSession();
//enableVisibilityAutoRefresh(); // optional but nice

// A getter that always reads the *current* token/baseUrl.
// Works before login (no token) and after login (token set in sessionStorage).
function currentEventClient() {
  return getEventClient(); // build a grpc-web client with creds if token present
}

// Initialize once at startup
Backend.init(() => currentEventClient()); 


applyTheme();           // set from localStorage or system
watchSystemTheme();     // keep in sync if "system"

startRouter()
