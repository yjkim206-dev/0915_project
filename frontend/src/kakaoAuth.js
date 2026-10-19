import { authStorage } from './authStorage.js'
import { SUPABASE_URL, SITE_URL } from './deploymentConfig.js'

const supabaseUrl = SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export function startKakaoLogin() {
  if (!supabaseUrl || !anonKey) {
    throw new Error('카카오 로그인을 사용하려면 VITE_SUPABASE_URL(또는 VITE_API_URL)과 VITE_SUPABASE_ANON_KEY를 설정해야 합니다.')
  }

  let authorizeUrl
  try {
    authorizeUrl = new URL('/auth/v1/authorize', supabaseUrl)
  } catch {
    throw new Error('Supabase URL 설정이 올바르지 않습니다.')
  }

  authorizeUrl.searchParams.set('provider', 'kakao')
  authorizeUrl.searchParams.set('redirect_to', `${SITE_URL}/auth/callback`)
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
  if (error) return { error: error.replaceAll('+', ' ') }

  const token = params.get('access_token')
  if (!token) {
    const code = params.get('code')
    if (code) return { error: '인증 응답이 코드 방식으로 도착했습니다. Supabase OAuth 설정을 확인해 주세요.' }
    return { error: '카카오 인증 토큰을 받지 못했습니다. Supabase와 카카오의 로그인 설정 및 허용된 리디렉션 URL을 확인해 주세요.' }
  }

  try {
    const tokenParts = token.split('.')
    if (tokenParts.length !== 3 || !tokenParts[1]) throw new Error('Invalid token')
    const encodedPayload = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=')))
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Missing user id')
    if (payload.exp && payload.exp * 1000 <= Date.now()) throw new Error('Expired token')

    authStorage.setItem('token', token)
    authStorage.setItem('userId', payload.sub)
    authStorage.beginSession()
    window.history.replaceState({}, document.title, '/auth/callback')
    return { token, userId: payload.sub }
  } catch {
    return { error: '카카오 로그인 토큰을 확인하지 못했습니다. 다시 시도해 주세요.' }
  }
}
