import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

// Exercise the real Edge Function router offline. Only its external Supabase
// and Deno runtime dependencies are stubbed; no credentials or database needed.
const source = stripTypeScriptTypes(
  readFileSync(new URL('../supabase/functions/api/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, ''),
)

function loadHandler() {
  let handler
  const client = {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      signInWithPassword: async () => { throw new Error('Simulated auth outage') },
      signUp: async () => { throw new Error('Simulated auth outage') },
    },
    from: () => { throw new Error('Unexpected database access') },
  }
  runInNewContext(source, {
    Request, Response, URL, Error,
    console: { error() {} },
    createClient: () => client,
    handlePaymentRoutes: async () => null,
    Deno: { env: { get: () => '' }, serve: (callback) => { handler = callback } },
  })
  return handler
}

for (const [method, path] of [
  ['GET', '/profile'],
  ['PUT', '/profile'],
  ['POST', '/posts/1/view'],
  ['POST', '/posts/1/reactions'],
]) {
  test(`${method} ${path} returns JSON 401 with CORS when logged out`, async () => {
    const response = await loadHandler()(new Request(`https://example.test/functions/v1/api${path}`, { method }))
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal((await response.json()).message, '로그인이 필요합니다.')
  })
}

test('an invalid bearer token returns a handled 401', async () => {
  const response = await loadHandler()(new Request('https://example.test/functions/v1/api/profile', {
    headers: { Authorization: 'Bearer invalid-test-token' },
  }))
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal((await response.json()).message, '로그인이 필요합니다.')
})

for (const path of ['/auth/login', '/auth/signup', '/admin/login']) {
  test(`${path} catches asynchronous service errors and retains JSON/CORS`, async () => {
    const response = await loadHandler()(new Request(`https://example.test/functions/v1/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.test', password: 'test-password', name: 'Test' }),
    }))
    assert.equal(response.status, 500)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal((await response.json()).message, '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
  })
}

test('health check and CORS preflight remain available', async () => {
  const handler = loadHandler()
  const health = await handler(new Request('https://example.test/functions/v1/api/health'))
  assert.equal(health.status, 200)
  assert.equal((await health.json()).status, 'ok')
  const preflight = await handler(new Request('https://example.test/functions/v1/api/profile', { method: 'OPTIONS' }))
  assert.equal(preflight.status, 200)
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*')
})

test('unsafe numeric resource ids are rejected before any database access', async () => {
  for (const path of ['/posts/999999999999999999999999', '/posts/0/comments']) {
    const response = await loadHandler()(new Request(`https://example.test/functions/v1/api${path}`))
    assert.equal(response.status, 400)
  }
})
