const publicApiKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {})
  if (publicApiKey) headers.set('apikey', publicApiKey)
  const target = /^https?:\/\//i.test(url) ? url : API + (url.startsWith('/') ? url : '/' + url)
  return window.fetch(target, { ...options, headers }).then(async (response) => {
    const data = response.status === 204 ? null : await response.json()
    if (!response.ok) throw new Error(data?.message || '요청을 처리할 수 없습니다.')
    return data
  })
}
