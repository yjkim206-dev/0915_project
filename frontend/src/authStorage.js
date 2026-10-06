const keys = ['token', 'userId', 'adminToken', 'authExpiresAt']
export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000

const expiration = () => Number(localStorage.getItem('authExpiresAt') || sessionStorage.getItem('authExpiresAt') || 0)
const expired = () => {
  const expiresAt = expiration()
  return expiresAt > 0 && expiresAt <= Date.now()
}

export const authStorage = {
  getItem(key) {
    if (key !== 'authExpiresAt' && expired()) {
      this.clear()
      return null
    }
    const persistentValue = localStorage.getItem(key)
    if (persistentValue !== null) return persistentValue
    const legacySessionValue = sessionStorage.getItem(key)
    if (legacySessionValue !== null) {
      localStorage.setItem(key, legacySessionValue)
      sessionStorage.removeItem(key)
    }
    return legacySessionValue
  },
  setItem(key, value) {
    localStorage.setItem(key, value)
    sessionStorage.removeItem(key)
  },
  beginSession() {
    this.setItem('authExpiresAt', String(Date.now() + SESSION_DURATION_MS))
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
    keys.forEach((key) => this.removeItem(key))
  },
}
