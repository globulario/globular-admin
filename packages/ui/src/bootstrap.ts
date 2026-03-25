import {
  Backend,
  getEventClient,
  setNavigateHandler,
  restoreSession,
  enableVisibilityAutoRefresh,
} from '@globular/sdk'
import { applyTheme, watchSystemTheme } from './theme/theme'

export interface InitOptions {
  onNavigate: (path: string) => void
}

/**
 * One-call bootstrap for any Globular web application.
 *
 * Wires up:
 *   1. Router integration (setNavigateHandler)
 *   2. Backend event hub (Backend.init)
 *   3. Theme (apply + system-change watcher)
 *   4. Session restore + visibility-based token refresh
 */
export function initGlobularApp(opts: InitOptions) {
  setNavigateHandler(opts.onNavigate)
  Backend.init(() => getEventClient())
  applyTheme()
  watchSystemTheme()
  restoreSession()
  enableVisibilityAutoRefresh()
}
