const keys = ['token', 'userId', 'adminToken', 'authExpiresAt']
export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000

const expiration = () => Number(localStorage.getItem('authExpiresAt') || sessionStorage.getItem('authExpiresAt') || 0)
const expired = () => expiration() <= Date.now()

export const authStorage = {
  getItem(key) {
    if (key !== 'authExpiresAt' && expired()) {
      this.clear()
      return null
    }
    const value = localStorage.getItem(key)
    if (value !== null) return value
    const legacyValue = sessionStorage.getItem(key)
    if (legacyValue !== null) localStorage.setItem(key, legacyValue)
    return legacyValue
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
