// Theme utilities
export { applyTheme, watchSystemTheme, getStoredTheme, setStoredTheme, resolveTheme } from './theme/theme'
export type { Theme } from './theme/theme'

// Bootstrap helper (Phase 4)
export { initGlobularApp } from './bootstrap'

// Polymer replacement elements (must load before components that use them)
import './elements'

// Side-effect widget registrations
import './widgets/theme_toggle'
import './widgets/user_toolbar'
