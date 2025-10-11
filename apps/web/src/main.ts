
import './styles.css'
import './components/applicationLayout.js'
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

startRouter()
