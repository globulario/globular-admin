// packages/components — barrel file
//
// Importing '@globular/components' registers all web components as side effects.
// Deep imports (e.g. '@globular/components/fileExplorer/fileExplorer.js') still work.

// ── Layout ──────────────────────────────────────────────────────────────────
import './applicationLayout.js'
import './splitView.js'
import './dockbar.js'
import './dialog.js'
import './menu.js'
import './wizard.js'
import './moveable.js'
import './resizeable.js'

// ── Generic UI ──────────────────────────────────────────────────────────────
import './table.js'
import './list.js'
import './link.js'
import './autocomplete.js'
import './image.js'
import './markdown.js'
import './notification/notificationsPanel.ts'
import './notification/notificationEditor.ts'

// ── File Explorer ───────────────────────────────────────────────────────────
import './fileExplorer/fileExplorer.js'

// ── Permissions ─────────────────────────────────────────────────────────────
import './permissionManager/permissionManager.js'

// ── Sharing ─────────────────────────────────────────────────────────────────
import './share/sharePanel.js'
import './share/shareResourceWizard.js'
