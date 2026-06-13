// packages/sdk/src/rbac/proto_helpers.ts
//
// Shared utilities for working with proto-generated message classes.
// Used by accounts, roles, groups, organizations, applications, permissions.
//
// globular: enforces ui.sdk_utilities_not_duplicated

/**
 * Try multiple names for a request class in a proto namespace; fallback to {}.
 * Handles codegen variations where class names differ across generator versions.
 */
export function newRq(ns: any, names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = ns?.[n]
    if (typeof Ctor === 'function') return new Ctor()
  }
  return {}
}

/**
 * Pick the first method that exists on a gRPC-web client.
 * Handles codegen variations where method names differ.
 */
export function pickMethod(c: any, names: readonly string[]): string {
  for (const n of names) if (typeof c[n] === 'function') return n
  return names[0]
}

/**
 * Safe string getter from a proto message object.
 * Tries multiple getter names (handles codegen variations like
 * getName/getname, getFirstName/getFirstname, etc.).
 */
export const getStr = (obj: any, names: string[], alt?: any): string => {
  for (const n of names) {
    const fn = obj?.[n]
    if (typeof fn === 'function') return String(fn.call(obj))
    if (n in (obj || {})) return String(obj[n])
  }
  return alt === undefined ? '' : String(alt)
}

/**
 * Safe string array getter from a proto message object.
 * Tries multiple list getter names (handles codegen variations like
 * getAccountsList/accounts/getAccounts, etc.).
 */
export const getArr = (obj: any, names: string[]): string[] => {
  for (const n of names) {
    const fn = obj?.[n]
    const v = typeof fn === 'function' ? fn.call(obj) : obj?.[n]
    if (Array.isArray(v)) return v.map(String)
  }
  return []
}
