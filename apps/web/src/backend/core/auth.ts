let _token: string | undefined
export function setToken(t?: string) { _token = t }
export function getToken() { return _token }
export function metadata(): Record<string,string> {
  const m: Record<string,string> = {}
  if (_token) m["authorization"] = "Bearer " + _token
  return m
}
