const keys = ['token', 'userId', 'adminToken', 'authExpiresAt']
export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000

const expiration = () => Number(localStorage.getItem('authExpiresAt') || sessionStorage.getItem('authExpiresAt') || 0)
const expired = () => {
  const expiresAt = expiration()
  return expiresAt > 0 && expiresAt <= Date.now()
}

let expiryTimer

const scheduleExpiry = () => {
  if (typeof window === 'undefined') return
  window.clearTimeout(expiryTimer)
  const expiresAt = expiration()
  if (!expiresAt) return
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) {
    authStorage.clear()
    window.location.assign('/login')
    return
  }
  expiryTimer = window.setTimeout(() => {
    authStorage.clear()
    window.location.assign('/login')
  }, remaining)
}

export const authStorage = {
  getItem(key) {
    if (key !== 'authExpiresAt' && expired()) {
      this.clear()
      return null
    }
    const persistentValue = localStorage.getItem(key)
    if (persistentValue !== null) {
      scheduleExpiry()
      return persistentValue
    }
    const legacySessionValue = sessionStorage.getItem(key)
    if (legacySessionValue !== null) {
      localStorage.setItem(key, legacySessionValue)
      sessionStorage.removeItem(key)
    }
    scheduleExpiry()
    return legacySessionValue
  },
  setItem(key, value) {
    localStorage.setItem(key, value)
    sessionStorage.removeItem(key)
  },
  beginSession() {
    this.setItem('authExpiresAt', String(Date.now() + SESSION_DURATION_MS))
    scheduleExpiry()
  },
  getExpiresAt() {
    return expiration()
  },
  isExpired() {
    return expired()
  },
  removeItem(key) {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
  clear() {
    if (typeof window !== 'undefined') window.clearTimeout(expiryTimer)
    keys.forEach((key) => this.removeItem(key))
  },
}
