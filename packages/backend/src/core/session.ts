import { displaySuccess } from '../ui/notify'

const TOKEN_KEY = '__globular_token__'

let navigateHandler: ((path: string) => void) | null = null;

/**
 * Let the app provide its own router navigation function.
 * Call this from apps/web (or any app) at startup.
 */
export function setNavigateHandler(fn: (path: string) => void) {
  navigateHandler = fn;
}

export function navigateTo(path: string) {
  if (navigateHandler) {
    navigateHandler(path);
  } else {
    console.warn("navigateTo called but no navigateHandler is set.", path);
  }
}

export function getToken(): string | null {
  // Standardize on sessionStorage TOKEN_KEY, keep a fallback to old localStorage key.
  try {
    const t = sessionStorage.getItem(TOKEN_KEY)
    if (t) return t
  } catch {}
  try {
    // legacy/fallback
    return localStorage.getItem('access_token')
  } catch {
    return null
  }
}

export function decodeJwtPayload(token: string): any | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const pad = '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/') + pad
    // Robust decode (handles UTF-8)
    const json =
      decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function getUsername(): string | null {
  const t = getToken()
  const p = t ? decodeJwtPayload(t) : null
  let u: string | undefined =
    p?.preferred_username ?? p?.username ?? p?.user ?? p?.name ?? p?.sub ?? p?.email
  if (u && u.includes('@')) u = u.split('@')[0]
  if (u) return u
  try { return localStorage.getItem('current_user') } catch { return null }
}

export function isSa(): boolean {
  const u = getUsername()
  return !!u && u.toLowerCase() === 'sa'
}

export function isTokenTimeValid(skewSec = 60): boolean {
  const t = getToken()
  if (!t) return false
  const p = decodeJwtPayload(t)
  if (!p) return false
  const now = Math.floor(Date.now() / 1000)
  if (typeof p.nbf === 'number' && now + skewSec < p.nbf) return false
  if (typeof p.exp === 'number' && now - skewSec >= p.exp) return false
  if (typeof p.iat === 'number' && p.iat > now + skewSec) return false
  return true
}

export function logout() {
  try {
    sessionStorage.removeItem(TOKEN_KEY)   // new canonical key
    localStorage.removeItem('access_token')// legacy
    localStorage.removeItem('current_user')
  } catch {}
  window.dispatchEvent(new CustomEvent('auth:changed'))
  displaySuccess('Signed out')
  navigateTo('#/login')
}
