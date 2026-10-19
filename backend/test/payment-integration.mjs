// Explicit remote fixture check. Creates isolated temporary Auth accounts and
// removes them (and their cascading payment/ledger rows) in finally. No Toss calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

if (!process.argv.includes('--allow-remote-fixtures')) throw new Error('Pass --allow-remote-fixtures to run the isolated remote check.')
const env = {}
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/)
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}
const base = 'https://ymprvqsfpwvoutwozwvn.supabase.co'
const service = env.SUPABASE_SERVICE_ROLE_KEY
const publicKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
if (!service || !publicKey) throw new Error('Required project keys are missing.')
const prefix = `moa-fixture-${randomUUID().slice(0, 8)}`
const created = []
let passed = 0

async function http(path, { token = service, apiKey = service, method = 'GET', body, expected = 200, prefer } = {}) {
  const response = await fetch(base + path, {
    method, headers: { apikey: apiKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = null }
  assert.equal(response.status, expected, `Unexpected status for ${method} ${path.split('?')[0]}: ${response.status} ${data?.message || data?.msg || ''}`)
  return data
}
const api = (path, token, options = {}) => http('/functions/v1/api' + path, { ...options, token, apiKey: publicKey })
const rpc = (name, body, options = {}) => http('/rest/v1/rpc/' + name, { method: 'POST', body, ...options })
function check(name) { passed++; console.log(`PASS ${name}`) }

async function account(label) {
  const password = randomUUID() + '!Test9'
  const email = `${prefix}-${label}@example.com`
  const user = await http('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true, user_metadata: { name: `${prefix}-${label}` } } })
  created.push(user.id)
  const session = await http('/auth/v1/token?grant_type=password', { method: 'POST', apiKey: publicKey, body: { email, password } })
  return { id: user.id, token: session.access_token }
}

try {
  const buyer = await account('buyer')
  const other = await account('other')
  const admin = await account('admin')
  await http(`/rest/v1/profiles?id=eq.${admin.id}`, { method: 'PATCH', body: { role: 'admin' }, expected: 204 })
  const statuses = ['pending', 'paid', 'refunded', 'cancelled', 'failed']
  const rows = statuses.map((status) => ({
    id: `${prefix}-${status}`, user_id: buyer.id, product_id: 'credits_1000', product_name: 'Isolated integration fixture',
    product_type: 'credits', amount: 1000, credits: 1000, status,
    ...(status === 'paid' || status === 'refunded' ? { paid_at: new Date().toISOString(), toss_payment_key: `${prefix}-key-${status}`, toss_payment_data: { paymentKey: 'must-not-be-exposed', billingKey: 'must-not-be-exposed', method: 'CARD', receipt: { url: 'https://receipts.tosspayments.com/fixture' } } } : {}),
    ...(status === 'refunded' ? { canceled_at: new Date().toISOString(), cancel_reason: 'Fixture refund', toss_cancel_data: { cancels: [{ cancelAmount: 1000, cancelReason: 'Fixture refund', canceledAt: new Date().toISOString() }] } } : {}),
    ...(status === 'failed' ? { failure_code: 'FIXTURE_FAILURE', failure_message: 'Fixture decline', failed_at: new Date().toISOString() } : {}),
  }))
  const fixtures = [...rows, { ...rows[1], id: `${prefix}-other`, user_id: other.id, toss_payment_key: `${prefix}-other-key` }]
  const columns = [...new Set(fixtures.flatMap(Object.keys))]
  const uniformRows = fixtures.map((row) => Object.fromEntries(columns.map((key) => [key, row[key] ?? null])))
  await http('/rest/v1/payment_orders', { method: 'POST', body: uniformRows, expected: 201 })
  const summary = await api('/payments/account', buyer.token)
  assert.equal(summary.order_count, 5); assert.equal(summary.balance, 0)
  assert.ok(!JSON.stringify(summary).includes('must-not-be-exposed'))
  assert.equal(summary.orders.find((row) => row.status === 'refunded').refunded_amount, 1000)
  assert.ok(summary.orders.find((row) => row.status === 'paid').receipt_url.startsWith('https:'))
  check('user purchase/refund/receipt data is read from Supabase without provider secrets')

  const paged = await api('/payments/orders?limit=2&page=2', buyer.token)
  assert.equal(paged.total, 5); assert.equal(paged.items.length, 2)
  const paid = await api('/payments/orders?status=paid', buyer.token)
  assert.equal(paid.total, 1)
  check('user history pagination and status filters')
  await api(`/payments/orders/${prefix}-other/close`, buyer.token, { method: 'POST', body: { status: 'cancelled' }, expected: 404 })
  const unchanged = await api(`/payments/orders/${prefix}-paid/close`, buyer.token, { method: 'POST', body: { status: 'cancelled' } })
  assert.equal(unchanged.status, 'paid')
  await api(`/payments/orders/${prefix}-pending/close`, buyer.token, { method: 'POST', body: { status: 'cancelled', message: 'Fixture checkout close' } })
  check('checkout closure owns the order and cannot overwrite an approved payment')
  const adminOrders = await api(`/admin/payments?userId=${buyer.id}`, admin.token)
  assert.equal(adminOrders.total, 5); assert.ok(adminOrders.items.every((row) => row.user.id === buyer.id))
  check('administrator can inspect a selected user payment history')
  await api('/admin/payments', buyer.token, { expected: 403 })
  await api(`/admin/credits/users/${buyer.id}/adjust`, buyer.token, { method: 'POST', body: { amount: 999, reason: 'Unauthorized fixture', requestId: randomUUID(), actorId: admin.id }, expected: 403 })
  await rpc('admin_adjust_credits', { p_actor_id: admin.id, p_user_id: buyer.id, p_amount: 999, p_reason: 'Unauthorized direct call', p_request_id: randomUUID() }, { token: buyer.token, apiKey: publicKey, expected: 403 })
  check('ordinary users cannot inspect admin history or adjust credits through API/direct RPC')

  const adjust = (amount, reason, requestId = randomUUID(), expected = 200) => api(`/admin/credits/users/${buyer.id}/adjust`, admin.token, { method: 'POST', body: { amount, reason, requestId }, expected })
  const grantId = randomUUID()
  assert.equal((await adjust(1000, 'Fixture grant', grantId)).balance, 1000)
  assert.equal((await adjust(1000, 'Fixture grant', grantId)).alreadyProcessed, true)
  await adjust(1000, 'Changed retry', grantId, 409)
  assert.equal((await adjust(-200, 'Fixture recovery')).balance, 800)
  await adjust(-1000, 'Excess recovery', randomUUID(), 409)
  check('grant/recovery, duplicate request protection, conflict detection, and insufficient balance')

  const concurrentId = randomUUID()
  const duplicates = await Promise.all([adjust(25, 'Concurrent retry', concurrentId), adjust(25, 'Concurrent retry', concurrentId)])
  assert.equal(duplicates.filter((row) => row.alreadyProcessed).length, 1)
  assert.equal((await api('/payments/account', buyer.token)).balance, 825)
  check('concurrent duplicate credit grants are applied only once')
  const concurrentRecovery = await Promise.allSettled([adjust(-600, 'Concurrent recovery A'), adjust(-600, 'Concurrent recovery B')])
  assert.equal(concurrentRecovery.filter((row) => row.status === 'fulfilled').length, 1)
  assert.equal((await api('/payments/account', buyer.token)).balance, 225)
  check('concurrent recoveries cannot make the wallet negative')

  const balance = await api(`/admin/credits/users?userId=${buyer.id}`, admin.token)
  assert.equal(balance.items[0].balance, 225)
  const ledger = await api(`/admin/credits/transactions?userId=${buyer.id}`, admin.token)
  assert.ok(ledger.items.every((row) => row.actor_id === admin.id && row.balance_before != null && row.balance_after != null))
  assert.ok((await api('/payments/account', buyer.token)).transactions.some((row) => row.kind === 'admin_grant'))
  check('administrator audit actor/reason/before-after balances and user ledger are linked')

  await adjust(1000, 'Refund reservation fixture')
  const refundId = `${prefix}-paid`
  const reserved = await rpc('reserve_credit_refund', { p_order_id: refundId, p_reason: 'Fixture refund' })
  assert.ok(reserved.requestId)
  assert.equal((await api('/payments/account', buyer.token)).balance, 225)
  await adjust(-226, 'Cannot consume reserved credit', randomUUID(), 409)
  await rpc('release_credit_refund', { p_order_id: refundId }, { expected: 204 })
  assert.equal((await api('/payments/account', buyer.token)).balance, 1225)
  await rpc('reserve_credit_refund', { p_order_id: refundId, p_reason: 'Fixture refund' })
  await rpc('refund_credit_order', { p_order_id: refundId, p_cancel_reason: 'Fixture refund', p_cancel_data: { cancels: [{ cancelAmount: 1000, cancelReason: 'Fixture refund' }] } })
  const repeatedRefund = await rpc('refund_credit_order', { p_order_id: refundId, p_cancel_reason: 'Fixture refund', p_cancel_data: {} })
  assert.equal(repeatedRefund.alreadyProcessed, true)
  assert.equal((await api('/payments/account', buyer.token)).balance, 225)
  check('DB refund reservation/release/finalization preserves wallet balance without provider calls')

  const rlsRows = await http('/rest/v1/payment_orders?select=user_id', { token: buyer.token, apiKey: publicKey })
  assert.ok(rlsRows.every((row) => row.user_id === buyer.id))
  check('Supabase RLS restricts direct payment reads to the owning user')
  console.log(`Remote fixture checks passed: ${passed}`)
} finally {
  for (const id of created) await http(`/auth/v1/admin/users/${id}`, { method: 'DELETE' })
  console.log(`Temporary fixture accounts removed: ${created.length}`)
}
