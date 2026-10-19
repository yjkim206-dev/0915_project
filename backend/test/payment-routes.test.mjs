import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const userId = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
const user = { id: userId }
const request = (path, body, method = body ? 'POST' : 'GET') => new Request(`https://example.test${path}`, {
  method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
})

function loadModule(file, exposed, overrides = {}) {
  const source = ['paymentHistory.ts', file].filter(Boolean).map((name) => stripTypeScriptTypes(
    readFileSync(new URL(`../supabase/functions/api/${name}`, import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''),
  )).join('\n')
  return runInNewContext(`${source}\n;${exposed}`, { Request, Response, URL, Error, crypto, btoa, console: { error() {} }, ...overrides })
}

function fakeDb(results) {
  const calls = []
  return { calls, from(table) {
    const call = { table, filters: [] }; calls.push(call)
    const result = results[table] || { data: null, error: null }
    const query = {
      select(fields, options) { call.fields = fields; call.options = options; return query },
      eq(key, value) { call.filters.push([key, value]); return query },
      in(key, value) { call.filters.push([key, value]); return query },
      or(value) { call.or = value; return query },
      order() { return query }, limit() { return query },
      range(from, to) { call.range = [from, to]; return query },
      update(values) { call.update = values; return query },
      maybeSingle() { return Promise.resolve(result) },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
    }
    return query
  } }
}

test('order history exposes receipts and cancellation facts without provider secrets', () => {
  const summarize = loadModule(null, 'orderSummary')
  const output = summarize({ id: 'ORDER', user_id: userId, amount: 1000, status: 'refunded',
    toss_payment_key: 'secret', toss_payment_data: { paymentKey: 'secret', billingKey: 'secret', method: '카드', receipt: { url: 'https://example.test/receipt' } },
    toss_cancel_data: { cancels: [{ cancelAmount: 1000, cancelReason: '요청 환불', canceledAt: '2026-10-19' }] },
  })
  assert.equal(output.receipt_url, 'https://example.test/receipt')
  assert.equal(output.refunded_amount, 1000)
  assert.equal(output.cancellations[0].reason, '요청 환불')
  assert.ok(!JSON.stringify(output).includes('secret'))
  assert.equal(summarize({ toss_payment_data: { receipt: { url: 'javascript:alert(1)' } } }).receipt_url, null)
})

test('user history is scoped to the authenticated user and supports status/pagination', async () => {
  const route = loadModule('payments.ts', 'handlePaymentRoutes')
  const db = fakeDb({ payment_orders: { data: [{ id: 'OWN', status: 'paid' }], count: 25 } })
  const result = await route('/payments/orders', 'GET', request('/payments/orders?page=2&limit=10&status=paid'), db, async () => user, '')
  assert.equal(result.status, 200)
  assert.equal((await result.json()).total, 25)
  assert.deepEqual(db.calls[0].filters, [['user_id', userId], ['status', 'paid']])
  assert.deepEqual(db.calls[0].range, [10, 19])
})

test('checkout closure cannot set paid status or overwrite another user/approved order', async () => {
  const route = loadModule('payments.ts', 'handlePaymentRoutes')
  const db = fakeDb({ payment_orders: { data: { id: 'OWN', status: 'cancelled' } } })
  const bad = await route('/payments/orders/OWN/close', 'POST', request('/payments/orders/OWN/close', { status: 'paid' }), db, async () => user, '')
  assert.equal(bad.status, 400)
  assert.equal(db.calls.length, 0)
  const closed = await route('/payments/orders/OWN/close', 'POST', request('/payments/orders/OWN/close', { status: 'cancelled' }), db, async () => user, '')
  assert.equal(closed.status, 200)
  assert.deepEqual(db.calls[0].filters, [['id', 'OWN'], ['user_id', userId], ['status', 'pending']])
})

test('admin guard runs before payment data access or wallet adjustment', async () => {
  const route = loadModule('adminPayments.ts', 'handleAdminPaymentRoutes')
  const db = fakeDb({})
  await assert.rejects(route('/admin/payments', 'GET', request('/admin/payments'), db, async () => { throw new Response('', { status: 403 }) }), (error) => error.status === 403)
  assert.equal(db.calls.length, 0)
})

test('credit adjustment validates amount/reason and derives actor from authentication', async () => {
  const route = loadModule('adminPayments.ts', 'handleAdminPaymentRoutes')
  const path = `/admin/credits/users/${userId}/adjust`
  let args
  const db = { rpc: async (_name, input) => { args = input; return { data: { balance: 100 }, error: null } } }
  const admin = async () => ({ user: { id: actorId } })
  for (const amount of [0, 0.5, '100', 10000001]) {
    assert.equal((await route(path, 'POST', request(path, { amount, reason: '테스트 지급', requestId }), db, admin)).status, 400)
  }
  assert.equal(args, undefined)
  const result = await route(path, 'POST', request(path, { amount: 100, reason: '테스트 지급', requestId, actorId: userId }), db, admin)
  assert.equal(result.status, 200)
  assert.equal(args.p_actor_id, actorId)
  assert.equal(args.p_user_id, userId)
  assert.equal(args.p_amount, 100)
  assert.equal(args.p_request_id, requestId)
})

test('insufficient recovery returns a conflict without claiming success', async () => {
  const route = loadModule('adminPayments.ts', 'handleAdminPaymentRoutes')
  const path = `/admin/credits/users/${userId}/adjust`
  const result = await route(path, 'POST', request(path, { amount: -100, reason: '테스트 회수', requestId }), { rpc: async () => ({ error: { message: 'INSUFFICIENT_CREDIT_BALANCE' } }) }, async () => ({ user: { id: actorId } }))
  assert.equal(result.status, 409)
})

test('administrator member search preserves dots in email addresses', async () => {
  const route = loadModule('adminPayments.ts', 'handleAdminPaymentRoutes')
  const db = fakeDb({ profiles: { data: [], count: 0 } })
  const response = await route('/admin/credits/users', 'GET', request('/admin/credits/users?search=member%40example.com'), db, async () => ({ user: { id: actorId } }))
  assert.equal(response.status, 200)
  assert.equal(db.calls[0].or, 'name.ilike.%member@example.com%,email.ilike.%member@example.com%')
})

test('refund cannot call the processor before reserving sufficient credits', async () => {
  let externalCalls = 0
  const route = loadModule('payments.ts', 'handlePaymentRoutes', { fetch: async () => { externalCalls++; throw new Error('Unexpected call') } })
  const db = fakeDb({ payment_orders: { data: { id: 'OWN', status: 'paid', product_type: 'credits', amount: 1000, credits: 1000, toss_payment_key: 'test-key' } } })
  db.rpc = async () => ({ error: { message: 'INSUFFICIENT_CREDIT_BALANCE' } })
  const result = await route('/payments/orders/OWN/refund', 'POST', request('/payments/orders/OWN/refund', {}), db, async () => user, 'test-secret')
  assert.equal(result.status, 409)
  assert.equal(externalCalls, 0)
})

for (const alreadyCanceled of [false, true]) {
  test(`refund ${alreadyCanceled ? 'reconciles a completed cancellation' : 'uses a stable provider request id'} and finalizes the ledger`, async () => {
    const calls = []
    const route = loadModule('payments.ts', 'handlePaymentRoutes', { fetch: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({ orderId: 'OWN', totalAmount: 1000, status: alreadyCanceled ? 'CANCELED' : 'DONE', cancels: [{ cancelAmount: 1000 }] }))
    } })
    const db = fakeDb({ payment_orders: { data: { id: 'OWN', status: 'paid', product_type: 'credits', amount: 1000, toss_payment_key: 'test-key' } } })
    const rpcs = []
    db.rpc = async (name) => { rpcs.push(name); return { data: name === 'reserve_credit_refund' ? { requestId, reason: '환불 요청' } : { status: 'refunded' } } }
    const result = await route('/payments/orders/OWN/refund', 'POST', request('/payments/orders/OWN/refund', {}), db, async () => user, 'test-secret')
    assert.equal(result.status, 200)
    assert.deepEqual(rpcs, ['reserve_credit_refund', 'refund_credit_order'])
    assert.equal(calls.length, alreadyCanceled ? 1 : 2)
    if (!alreadyCanceled) assert.equal(calls[1].options.headers['Idempotency-Key'], requestId)
  })
}

test('ambiguous provider failure keeps the refund reservation for safe retry', async () => {
  const route = loadModule('payments.ts', 'handlePaymentRoutes', { fetch: async () => { throw new Error('Network timeout') } })
  const db = fakeDb({ payment_orders: { data: { id: 'OWN', status: 'paid', product_type: 'credits', amount: 1000, toss_payment_key: 'test-key' } } })
  const rpcs = []
  db.rpc = async (name) => { rpcs.push(name); return { data: { requestId, reason: '환불 요청' } } }
  const result = await route('/payments/orders/OWN/refund', 'POST', request('/payments/orders/OWN/refund', {}), db, async () => user, 'test-secret')
  assert.equal(result.status, 500)
  assert.deepEqual(rpcs, ['reserve_credit_refund'])
})
