import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const id = '11111111-1111-4111-8111-111111111111'
const order = { id: 'MOA_TEST', user_id: id, status: 'pending', product_type: 'subscription', subscription_mode: 'manual', product_name: 'Monthly', amount: 9900 }
const payment = { orderId: order.id, paymentKey: 'provider-key', totalAmount: 9900, status: 'DONE' }
const req = (path, body = {}) => new Request('https://example.test' + path, { method: 'POST', body: JSON.stringify(body) })
function moduleFor(fetch) {
  const source = ['provider.ts', 'paymentHistory.ts', 'subscriptions.ts'].map((name) => stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/api/' + name, import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''))).join('\n')
  return runInNewContext(source + '\n;({handleSubscriptionRoutes, chargeSubscription, reconcileSubscription, refundSubscription, runSubscriptionRenewals, subscriptionSummary})', { Request, Response, URL, Error, AbortSignal, btoa, fetch, console: { error() {} } })
}
function database(paymentOrder = order) {
  const calls = []
  const rpcCalls = []
  const db = { calls, rpcCalls, rpc: async (name, input) => {
    rpcCalls.push({ name, input })
    if (name === 'claim_subscription_payment') return { data: { requestId: 'stable-request-id' } }
    if (name === 'prepare_subscription_refund') return { data: { requestId: 'refund-request-id', reason: 'Customer refund' } }
    return { data: { status: name === 'finish_subscription_refund' ? 'refunded' : 'active', currentPeriodEnd: '2027-01-01' } }
  }, from: (table) => {
    const call = { table, filters: [] }; calls.push(call)
    const data = table === 'payment_orders' ? paymentOrder : table === 'subscription_payment_attempts' ? { billing_key: 'saved-billing-key' } : []
    const result = { data }
    const query = { select: () => query, eq: (key, value) => { call.filters.push([key, value]); return query },
      update: (value) => { call.update = value; return query }, delete: () => { call.deleted = true; return query },
      insert: (value) => { call.insert = value; return query }, single: async () => result, maybeSingle: async () => result,
      order: () => query, limit: () => query, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    }; return query
  } }
  return db
}

test('manual subscription confirms through the same normal payment API as credits', async () => {
  const network = []
  const api = moduleFor(async (url, options) => { network.push({ url, options }); return new Response(JSON.stringify(url.includes('/payments/orders/') ? { status: 'IN_PROGRESS' } : payment)) })
  const db = database()
  const result = await api.handleSubscriptionRoutes('/payments/subscriptions/confirm', 'POST', req('/payments/subscriptions/confirm', { orderId: order.id, amount: 9900, paymentKey: 'provider-key' }), db, async () => ({ id }), async () => {}, 'test_sk_fake')
  assert.equal(result.status, 200)
  assert.ok(network[1].url.endsWith('/payments/confirm'))
  assert.equal(network[1].options.headers['Idempotency-Key'], 'stable-request-id')
  assert.equal(db.rpcCalls[1].name, 'settle_subscription_purchase')
  assert.equal(db.rpcCalls[1].input.p_billing_key, null)
})

test('automatic subscription uses its server-stored billing key instead of normal confirmation', async () => {
  const network = []
  const api = moduleFor(async (url, options) => { network.push({ url, options }); return url.includes('/payments/orders/') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(payment)) })
  const db = database({ ...order, subscription_mode: 'automatic' })
  const response = await api.chargeSubscription(db, { ...order, subscription_mode: 'automatic' }, 'test_sk_fake', {})
  assert.equal(response.status, 200)
  assert.ok(network[1].url.endsWith('/billing/saved-billing-key'))
  assert.equal(db.rpcCalls[1].input.p_billing_key, 'saved-billing-key')
})

test('wrong amount and wrong checkout mode are rejected before provider calls', async () => {
  let called = false
  const api = moduleFor(async () => { called = true })
  for (const [path, body] of [['/payments/subscriptions/confirm', { amount: 1, paymentKey: 'key' }], ['/payments/subscriptions/activate', { authKey: 'key' }]]) {
    const response = await api.handleSubscriptionRoutes(path, 'POST', req(path, { orderId: order.id, ...body }), database(), async () => ({ id }), async () => {}, 'test_sk_fake')
    assert.equal(response.status, 400)
  }
  assert.equal(called, false)
})

test('already paid orders do not charge or grant another month', async () => {
  const api = moduleFor(async () => { throw new Error('Must not charge') })
  const db = database()
  const response = await api.chargeSubscription(db, { ...order, status: 'paid' }, 'test_sk_fake')
  assert.equal((await response.json()).alreadyProcessed, true)
  assert.equal(db.rpcCalls.length, 0)
})

test('timeout preserves the pending order and its idempotency record', async () => {
  const api = moduleFor(async () => { throw new Error('Timeout') })
  const db = database()
  assert.equal((await api.chargeSubscription(db, order, 'test_sk_fake')).status, 503)
  assert.ok(!db.calls.some((call) => call.deleted || call.update?.status === 'failed'))
  assert.equal(db.rpcCalls.length, 1)
})

test('reconciliation verifies approved payment without issuing a new charge', async () => {
  const methods = []
  const api = moduleFor(async (_url, options) => { methods.push(options.method); return new Response(JSON.stringify(payment)) })
  const db = database()
  assert.equal((await api.reconcileSubscription(db, order, 'test_sk_fake')).status, 200)
  assert.deepEqual(methods, ['GET'])
  assert.equal(db.rpcCalls[1].name, 'settle_subscription_purchase')
})

test('subscription refund verifies provider cancellation before finalizing entitlement removal', async () => {
  const api = moduleFor(async (url) => new Response(JSON.stringify({ ...payment, status: url.endsWith('/cancel') ? 'CANCELED' : 'DONE' })))
  const db = database()
  const response = await api.refundSubscription(db, { ...order, status: 'paid', toss_payment_key: 'key' }, id, 'Customer refund', 'test_sk_fake')
  assert.equal(response.status, 200)
  assert.deepEqual(db.rpcCalls.map((call) => call.name), ['prepare_subscription_refund', 'finish_subscription_refund'])
})

test('scheduler rejects public requests before touching the database', async () => {
  const api = moduleFor(async () => { throw new Error('Must not charge') })
  const db = database()
  assert.equal((await api.runSubscriptionRenewals(req('/internal/subscriptions/renew'), db, 'test_sk_fake', 'private-cron-secret')).status, 401)
  assert.equal(db.rpcCalls.length, 0)
})

test('subscription summary hides billing credentials and derives expiry', () => {
  const api = moduleFor(() => {})
  const result = api.subscriptionSummary({ id: 1, user_id: id, billing_key: 'secret-billing', customer_key: 'secret-customer', billing_mode: 'manual', status: 'active', current_period_end: '2020-01-01', cancel_at_period_end: false })
  assert.equal(result.status, 'expired'); assert.equal(result.is_active, false); assert.equal(result.auto_renew, false)
  assert.ok(!JSON.stringify(result).includes('secret'))
})

test('administrator subscription routes enforce the administrator guard', async () => {
  const api = moduleFor(() => {})
  const path = '/admin/subscriptions/users/' + id + '/cancel'
  const db = database()
  await assert.rejects(api.handleSubscriptionRoutes(path, 'POST', req(path), db, async () => ({ id }), async () => { throw new Response('', { status: 403 }) }, 'test_sk_fake'), (error) => error.status === 403)
  assert.equal(db.calls.length, 0)
})
