// Theme utilities
export { applyTheme, watchSystemTheme, getStoredTheme, setStoredTheme, resolveTheme } from './theme/theme'
export type { Theme } from './theme/theme'

// Notifications (UI-only, no SDK dependency)
export { displayMessage, displayError, displaySuccess, displayQuestion } from './notify'

// Event bus (lightweight, no SDK dependency)
export { eventBus } from './event-bus'

// Bootstrap helper
export { initGlobularApp } from './bootstrap'

// Polymer replacement elements (must load before components that use them)
import './elements'

// Side-effect widget registrations
import './widgets/theme_toggle'
import './widgets/user_toolbar'
