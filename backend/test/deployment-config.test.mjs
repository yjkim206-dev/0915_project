import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../frontend/src/deploymentConfig.js', import.meta.url), 'utf8')
  .replace(/import\.meta\.env/g, 'env').replace(/^export /gm, '')
const resolve = (env) => runInNewContext(`${source}\n;({API_URL, SUPABASE_URL, SITE_URL})`, { env, URL })

test('missing and stale local environment settings resolve to the deployed project', () => {
  for (const env of [{}, { VITE_API_URL: 'http://localhost:3000/api', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SITE_URL: 'http://localhost:5173' }, { VITE_API_URL: 'https://another.supabase.co/functions/v1/api' }]) {
    const result = resolve(env)
    assert.equal(result.API_URL, 'https://ymprvqsfpwvoutwozwvn.supabase.co/functions/v1/api')
    assert.equal(result.SUPABASE_URL, 'https://ymprvqsfpwvoutwozwvn.supabase.co')
    assert.equal(result.SITE_URL, 'https://onboardproject.shop')
  }
})
