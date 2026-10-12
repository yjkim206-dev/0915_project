import { authStorage } from './authStorage.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_API_URL?.replace(/\/functions\/v1\/api\/?$/, '')
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export function startKakaoLogin() {
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase URL과 공개 API 키가 설정되지 않았습니다.')
  }

  const redirectTo = `${window.location.origin}/auth/callback`
  const authorizeUrl = new URL('/auth/v1/authorize', supabaseUrl)
  authorizeUrl.searchParams.set('provider', 'kakao')
  authorizeUrl.searchParams.set('prompt', 'login')
  authorizeUrl.searchParams.set('redirect_to', redirectTo)
  authorizeUrl.searchParams.set('apikey', anonKey)
  authorizeUrl.searchParams.set('flow_type', 'implicit')
  window.location.assign(authorizeUrl.toString())
}

export function consumeKakaoRedirect() {
  if (window.location.pathname !== '/auth/callback') return null

  const params = window.location.hash
    ? new URLSearchParams(window.location.hash.slice(1))
    : new URLSearchParams(window.location.search)
  const error = params.get('error_description') || params.get('error')
  const token = params.get('access_token')
  if (error) return { error: error.replaceAll('+', ' ') }
  if (!window.location.hash) return null
  if (!token) return { error: '카카오 로그인 응답에서 인증 토큰을 받지 못했습니다.' }

  try {
    const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=')))
    authStorage.setItem('token', token)
    authStorage.setItem('userId', payload.sub)
    authStorage.beginSession()
    window.history.replaceState({}, document.title, '/auth/callback')
    return { token, userId: payload.sub }
  } catch {
    return { error: '카카오 로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.' }
  }
}
