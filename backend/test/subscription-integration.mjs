// Isolated real Supabase database/API checks. Provider payments are fixtures;
// no Toss request is made. Cleanup cascades all temporary accounts/orders.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
if (!process.argv.includes('--allow-remote-fixtures')) throw new Error('Remote fixture opt-in required.')
const env = {}
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const base = 'https://ymprvqsfpwvoutwozwvn.supabase.co'
const service = env.SUPABASE_SERVICE_ROLE_KEY
const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
const prefix = 'moa-sub-' + randomUUID().slice(0, 8)
const created = []
let passed = 0
async function http(path, { token = service, key = service, body, method = body ? 'POST' : 'GET', expected = 200 } = {}) {
  const r = await fetch(base + path, { method, headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) })
  const text = await r.text(); let data; try { data = JSON.parse(text) } catch { data = null }
  assert.equal(r.status, expected, `${method} ${path.split('?')[0]}: ${r.status} ${data?.message || data?.msg || ''}`)
  return data
}
const rpc = (name, body = {}, expected = 200) => http('/rest/v1/rpc/' + name, { method: 'POST', body, expected })
const api = (path, token, body, expected = 200) => http('/functions/v1/api' + path, { token, key: anon, body, expected })
const check = (name) => { passed++; console.log('PASS ' + name) }
async function account(label, admin = false) {
  const email = `${prefix}-${label}@example.com`; const password = randomUUID() + '!9'
  const user = await http('/auth/v1/admin/users', { body: { email, password, email_confirm: true, user_metadata: { name: `${prefix}-${label}` } } })
  created.push(user.id)
  if (admin) await http('/rest/v1/profiles?id=eq.' + user.id, { method: 'PATCH', body: { role: 'admin' }, expected: 204 })
  const session = await http('/auth/v1/token?grant_type=password', { key: anon, body: { email, password } })
  return { id: user.id, token: session.access_token }
}
const providerPayment = (order, status = 'DONE') => ({ orderId: order.orderId, paymentKey: prefix + '-' + order.orderId, totalAmount: order.amount, status, method: 'CARD', receipt: { url: 'https://receipts.tosspayments.com/fixture' } })
const settle = (order, mode) => rpc('settle_subscription_purchase', { p_order_id: order.orderId, p_payment_key: prefix + '-' + order.orderId, p_payment_data: providerPayment(order), p_billing_key: mode === 'automatic' ? prefix + '-billing' : null })
try {
  const buyer = await account('buyer'); const admin = await account('admin', true)
  const subscription = async () => (await http(`/rest/v1/subscriptions?user_id=eq.${buyer.id}&select=*`))[0]
  const events = () => http(`/rest/v1/subscription_events?user_id=eq.${buyer.id}&select=*&order=id.asc`)
  const orderRow = async (id) => (await http(`/rest/v1/payment_orders?id=eq.${id}&select=*`))[0]
  const manual = await api('/payments/subscriptions/orders', buyer.token, { mode: 'manual' }, 201)
  assert.equal((await orderRow(manual.orderId)).subscription_mode, 'manual')
  const repeated = await api('/payments/subscriptions/orders', buyer.token, { mode: 'manual' }, 201)
  assert.equal(repeated.orderId, manual.orderId)
  check('manual purchase is a priced DB order and repeated checkout reuses its pending order')
  await api('/payments/subscriptions/confirm', buyer.token, { orderId: manual.orderId, paymentKey: 'fake', amount: manual.amount - 1 }, 400)
  assert.equal(await subscription(), undefined)
  check('wrong amount cannot activate an entitlement or contact the provider')
  await rpc('claim_subscription_payment', { p_order_id: manual.orderId })
  await api(`/payments/orders/${manual.orderId}/close`, buyer.token, { status: 'cancelled' }, 409)
  const parallel = await api('/payments/subscriptions/orders', buyer.token, { mode: 'automatic' }, 201)
  await rpc('claim_subscription_payment', { p_order_id: parallel.orderId }, 400)
  check('payment lease blocks concurrent alternative-mode charges and checkout closure')
  await rpc('settle_subscription_purchase', { p_order_id: manual.orderId, p_payment_key: 'fake', p_payment_data: { ...providerPayment(manual), totalAmount: 1 }, p_billing_key: null }, 400)
  assert.equal(await subscription(), undefined)
  await settle(manual, 'manual')
  const first = await subscription()
  assert.equal(first.billing_mode, 'manual'); assert.equal(first.billing_key, null); assert.equal(first.last_order_id, manual.orderId)
  const days = (Date.parse(first.current_period_end) - Date.parse(first.current_period_start)) / 86400000
  assert.ok(days >= 28 && days <= 31)
  assert.equal((await settle(manual, 'manual')).alreadyProcessed, true)
  assert.equal((await events()).filter((row) => row.event_type === 'payment_paid').length, 1)
  check('verified manual payment grants one calendar month only once; invalid payload cannot grant access')
  const accountData = await api('/payments/account', buyer.token)
  assert.equal(accountData.subscription.is_active, true); assert.equal(accountData.subscription.auto_renew, false)
  const adminData = await api('/admin/subscriptions/users/' + buyer.id, admin.token)
  assert.equal(adminData.subscription.last_order_id, manual.orderId)
  const userList = await api('/admin/users', admin.token)
  assert.equal(userList.find((row) => row.id === buyer.id).subscription.is_active, true)
  assert.ok(!JSON.stringify(accountData).includes(prefix + '-billing'))
  check('user profile, administrator subscription view and member list share the DB state')
  await api('/payments/subscriptions/orders', buyer.token, { mode: 'automatic' }, 409)
  await api('/admin/subscriptions/users/' + buyer.id, buyer.token, undefined, 403)
  await api('/payments/subscriptions/cancel', null, {}, 401)
  await api('/internal/subscriptions/renew', null, {}, 401)
  await http('/rest/v1/subscriptions?select=billing_key', { token: buyer.token, key: anon, expected: 403 })
  await http('/rest/v1/subscription_payment_attempts?select=*', { token: buyer.token, key: anon, expected: 403 })
  check('active duplicate purchase, ordinary admin access, public cron and direct billing-key reads are blocked')

  await rpc('prepare_subscription_refund', { p_order_id: manual.orderId, p_actor_id: buyer.id, p_reason: 'Fixture refund' })
  await rpc('finish_subscription_refund', { p_order_id: manual.orderId, p_actor_id: buyer.id, p_cancel_data: providerPayment(manual, 'DONE') }, 400)
  assert.equal((await subscription()).status, 'active')
  const cancellation = { ...providerPayment(manual, 'CANCELED'), cancels: [{ cancelAmount: manual.amount, cancelReason: 'Fixture refund', canceledAt: new Date().toISOString() }] }
  await rpc('finish_subscription_refund', { p_order_id: manual.orderId, p_actor_id: buyer.id, p_cancel_data: cancellation })
  assert.equal((await rpc('finish_subscription_refund', { p_order_id: manual.orderId, p_actor_id: buyer.id, p_cancel_data: cancellation })).alreadyProcessed, true)
  assert.equal((await subscription()).status, 'cancelled'); assert.equal((await orderRow(manual.orderId)).status, 'refunded')
  assert.equal((await events()).filter((row) => row.event_type === 'refunded').length, 1)
  check('refund requires a verified CANCELED result, ends access, records refund once and does not touch credit wallet')

  const automatic = await api('/payments/subscriptions/orders', buyer.token, { mode: 'automatic' }, 201)
  await rpc('claim_subscription_payment', { p_order_id: automatic.orderId })
  await settle(automatic, 'automatic')
  assert.equal((await subscription()).billing_key, prefix + '-billing')
  await api('/payments/subscriptions/cancel', buyer.token, {})
  assert.equal((await subscription()).cancel_at_period_end, true)
  assert.equal((await api('/payments/account', buyer.token)).subscription.is_active, true)
  await api('/payments/subscriptions/resume', buyer.token, {})
  assert.equal((await subscription()).cancel_at_period_end, false)
  await api('/admin/subscriptions/users/' + buyer.id + '/cancel', admin.token, { reason: 'Administrator fixture cancellation' })
  assert.ok((await events()).some((row) => row.event_type === 'cancel_scheduled' && row.actor_id === admin.id))
  check('automatic subscription cancel/resume preserves paid access; administrator action is audited')
  const end = new Date(Date.now() - 60000).toISOString()
  await http(`/rest/v1/subscriptions?user_id=eq.${buyer.id}`, { method: 'PATCH', body: { current_period_end: end }, expected: 204 })
  const subId = (await subscription()).id
  assert.equal(await rpc('prepare_subscription_renewal', { p_subscription_id: subId }), null)
  await rpc('expire_subscriptions')
  assert.equal((await subscription()).status, 'cancelled')
  check('canceled automatic subscriptions expire and cannot create another renewal charge')

  const next = await api('/payments/subscriptions/orders', buyer.token, { mode: 'automatic' }, 201)
  await settle(next, 'automatic')
  await http(`/rest/v1/subscriptions?user_id=eq.${buyer.id}`, { method: 'PATCH', body: { current_period_end: end }, expected: 204 })
  const renewalId = await rpc('prepare_subscription_renewal', { p_subscription_id: subId })
  assert.equal(await rpc('prepare_subscription_renewal', { p_subscription_id: subId }), renewalId)
  const renewal = await orderRow(renewalId)
  assert.equal(renewal.subscription_mode, 'automatic'); assert.equal(renewal.subscription_id, subId)
  await rpc('claim_subscription_payment', { p_order_id: renewalId })
  await rpc('record_subscription_failure', { p_order_id: renewalId, p_code: 'FIXTURE_DECLINED', p_message: 'Fixture card declined' }, 204)
  assert.equal((await subscription()).status, 'past_due'); assert.equal((await orderRow(renewalId)).status, 'failed')
  assert.equal((await events()).filter((row) => row.order_id === renewalId && row.event_type === 'payment_failed').length, 1)
  check('renewal order is deterministic and declined payment atomically records past_due, failed order and event')
  const recovered = await api('/payments/subscriptions/orders', buyer.token, { mode: 'manual' }, 201)
  await settle(recovered, 'manual')
  assert.equal((await subscription()).billing_mode, 'manual')
  assert.equal((await subscription()).last_error, null)
  assert.equal((await api('/payments/account', buyer.token)).subscription.auto_renew, false)
  check('a declined automatic subscription can be recovered with a one-month normal payment')
  const wallets = await http(`/rest/v1/credit_wallets?user_id=eq.${buyer.id}&select=balance`)
  assert.equal(wallets.length, 0)
  check('subscription payments/refunds do not mint or recover unrelated credits')
  console.log(`Subscription remote scenarios passed: ${passed}`)
} finally {
  for (const id of created) await http('/auth/v1/admin/users/' + id, { method: 'DELETE' })
  if (created.length) for (const table of ['subscriptions', 'subscription_events', 'payment_orders']) {
    const rows = await http(`/rest/v1/${table}?user_id=in.(${created.join(',')})&select=user_id`)
    assert.equal(rows.length, 0)
  }
  console.log(`Subscription fixture accounts removed and DB cleanup verified: ${created.length}`)
}
