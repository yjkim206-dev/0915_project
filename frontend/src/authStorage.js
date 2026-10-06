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
    // The active browser-session token must win over any older persisted token.
    const sessionValue = sessionStorage.getItem(key)
    if (sessionValue !== null) return sessionValue
    return localStorage.getItem(key)
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
