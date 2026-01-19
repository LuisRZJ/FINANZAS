export function leer(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}
export function escribir(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
export function eliminar(key) {
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
