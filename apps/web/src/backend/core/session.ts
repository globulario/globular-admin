// src/backend/core/session.ts
import { navigateTo } from '../../router'
import { displaySuccess } from '../ui/notify'

export function getToken(): string | null {
  try { return localStorage.getItem('access_token') } catch { return null }
}

export function decodeJwtPayload(token: string): any | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''))
    return JSON.parse(json)
  } catch { return null }
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

export function logout() {
  try {
    localStorage.removeItem('access_token')
    localStorage.removeItem('current_user')
  } catch {}
  window.dispatchEvent(new CustomEvent('auth:changed'))
  displaySuccess('Signed out')
  navigateTo('#/login')
}
