// Browser checks use real test-key checkout windows without entering a card.
// Activation/refund approvals below are explicit fixtures; no provider charge.
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, delimiter } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
if (!process.argv.includes('--allow-remote-fixtures')) throw new Error('Remote fixture opt-in required.')
const require = createRequire(import.meta.url)
let pw
for (const dir of process.env.PATH.split(delimiter)) {
  const candidate = join(dir, '..', 'playwright')
  if (existsSync(join(candidate, 'package.json'))) { pw = require(candidate); break }
}
if (!pw) throw new Error('Run through npm exec --package=playwright.')
const env = {}
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const base = 'https://ymprvqsfpwvoutwozwvn.supabase.co'
const site = 'https://0915-project-ruby.vercel.app'
const service = env.SUPABASE_SERVICE_ROLE_KEY
const prefix = 'moa-sub-ui-' + randomUUID().slice(0, 8)
const created = []
const shots = join(tmpdir(), prefix); mkdirSync(shots)
let browser
async function http(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + path, { method, headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) })
  assert.ok(r.ok, `Fixture ${method} ${path.split('?')[0]}: ${r.status}`)
  const text = await r.text(); return text ? JSON.parse(text) : null
}
async function account(label, admin = false) {
  const email = `${prefix}-${label}@example.com`; const password = randomUUID() + '!9'
  const user = await http('/auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { name: `${prefix}-${label}` } }); created.push(user.id)
  if (admin) await http('/rest/v1/profiles?id=eq.' + user.id, { role: 'admin' }, 'PATCH')
  const session = await http('/auth/v1/token?grant_type=password', { email, password })
  return { id: user.id, token: session.access_token, email }
}
async function context(user, admin = false) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await ctx.addInitScript(({ token, id, admin }) => { localStorage.setItem(admin ? 'adminToken' : 'token', token); if (!admin) localStorage.setItem('userId', id); localStorage.setItem('authExpiresAt', String(Date.now() + 3600000)) }, { ...user, admin })
  return ctx
}
async function ownApi(path, user, body) {
  const r = await fetch(base + '/functions/v1/api' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  assert.ok(r.ok, `Account API ${path}: ${r.status}`); return r.json()
}
async function until(callback, name) {
  for (let n = 0; n < 40; n++) { if (await callback()) return; await new Promise((resolve) => setTimeout(resolve, 250)) }
  throw new Error('Timed out: ' + name)
}
async function fakeSettle(order, mode) {
  return http('/rest/v1/rpc/settle_subscription_purchase', { p_order_id: order.orderId, p_payment_key: prefix + '-' + order.orderId,
    p_payment_data: { orderId: order.orderId, paymentKey: prefix + '-' + order.orderId, totalAmount: order.amount, status: 'DONE', method: 'CARD', receipt: { url: 'https://receipts.tosspayments.com/fixture' } },
    p_billing_key: mode === 'automatic' ? prefix + '-billing' : null })
}
async function mockProviderRefund(page, order, user, admin = false) {
  const path = `/${admin ? 'admin' : 'payments'}/subscriptions/orders/${order.orderId}/refund`
  await page.route('**' + path, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const reason = route.request().postDataJSON().reason
    await http('/rest/v1/rpc/prepare_subscription_refund', { p_order_id: order.orderId, p_actor_id: user.id, p_reason: reason })
    const result = await http('/rest/v1/rpc/finish_subscription_refund', { p_order_id: order.orderId, p_actor_id: user.id, p_cancel_data: { orderId: order.orderId, totalAmount: order.amount, status: 'CANCELED', cancels: [{ cancelAmount: order.amount, cancelReason: reason, canceledAt: new Date().toISOString() }] } })
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(result) })
  })
}
try {
  const buyer = await account('buyer'); const admin = await account('admin', true)
  browser = await pw.chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await context(buyer); const page = await ctx.newPage(); const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(site + '/shop')
  await page.getByRole('button', { name: '1개월 이용권 결제', exact: true }).waitFor()
  await page.evaluate(() => {
    window.__subscriptionCalls = []
    window.TossPayments = () => ({ payment: () => ({
      requestPayment: async (options) => { window.__subscriptionCalls.push({ kind: 'normal', ...options }); throw Object.assign(new Error('Fixture checkout close'), { code: 'USER_CANCEL' }) },
      requestBillingAuth: async (options) => { window.__subscriptionCalls.push({ kind: 'billing', ...options }); throw Object.assign(new Error('Fixture checkout close'), { code: 'USER_CANCEL' }) },
    }) })
  })
  await page.getByRole('button', { name: '1개월 이용권 결제', exact: true }).click()
  await until(() => page.evaluate(() => window.__subscriptionCalls.length === 1), 'manual checkout call')
  await page.getByRole('button', { name: '1개월 이용권 결제', exact: true }).waitFor({ state: 'visible' })
  await page.locator('.shop-credit-card').first().getByRole('button').click()
  await until(() => page.evaluate(() => window.__subscriptionCalls.length === 2), 'credits checkout call')
  await page.getByRole('radio', { name: /자동갱신 구독/ }).check()
  await page.getByRole('button', { name: '자동갱신 카드 등록 및 첫 결제', exact: true }).click()
  await until(() => page.evaluate(() => window.__subscriptionCalls.length === 3), 'automatic checkout call')
  const calls = await page.evaluate(() => window.__subscriptionCalls)
  assert.deepEqual(calls.map((row) => row.kind), ['normal', 'normal', 'billing'])
  assert.ok(calls.every((row) => row.method === 'CARD'))
  assert.equal(calls[0].amount.value, 9900)
  console.log('PASS one-month pass and credits share requestPayment(CARD); automatic renewal is an explicit billing choice')

  // Open the real provider windows. No card data or approval is submitted.
  for (const kind of ['manual', 'credits', 'automatic']) {
    const checkoutCtx = await context(buyer); const checkout = await checkoutCtx.newPage()
    await checkout.goto(site + '/shop')
    if (kind === 'automatic') await checkout.getByRole('radio', { name: /자동갱신 구독/ }).check()
    const button = kind === 'credits' ? checkout.locator('.shop-credit-card').first().getByRole('button') : checkout.getByRole('button', { name: kind === 'manual' ? '1개월 이용권 결제' : '자동갱신 카드 등록 및 첫 결제', exact: true })
    await button.click()
    await until(async () => checkout.frames().some((frame) => /tosspayments\.com/.test(frame.url())), kind + ' provider iframe')
    await checkout.screenshot({ path: join(shots, 'checkout-' + kind + '.png'), fullPage: true })
    console.log(`PASS real Toss ${kind} checkout window opens without submitting a payment`)
    await checkoutCtx.close()
  }
  const manual = await ownApi('/payments/subscriptions/orders', buyer, { mode: 'manual' })
  await fakeSettle(manual, 'manual')
  await page.goto(site + '/profile/payments')
  await page.getByText('1개월 이용권 · 자동갱신 없음', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '자동갱신 해지 예약', exact: true }).count(), 0)
  await mockProviderRefund(page, manual, buyer)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '결제 취소·환불', exact: true }).click()
  await until(async () => (await ownApi('/payments/account', buyer)).subscription?.status === 'cancelled', 'manual refund entitlement')
  console.log('PASS user sees one-month entitlement and refund button ends it using a simulated provider approval')

  const automatic = await ownApi('/payments/subscriptions/orders', buyer, { mode: 'automatic' })
  await fakeSettle(automatic, 'automatic')
  await page.reload()
  await page.getByRole('button', { name: '자동갱신 해지 예약', exact: true }).waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '자동갱신 해지 예약', exact: true }).click()
  await page.getByRole('button', { name: '해지 예약 철회', exact: true }).waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '해지 예약 철회', exact: true }).click()
  await page.getByRole('button', { name: '자동갱신 해지 예약', exact: true }).waitFor()
  console.log('PASS user cancel/resume buttons update the real subscription without ending paid access')

  const adminCtx = await context(admin, true); const adminPage = await adminCtx.newPage()
  adminPage.on('pageerror', (error) => errors.push(error.message))
  await adminPage.goto(site + '/admin')
  await adminPage.locator('.admin-sidebar-v2').getByRole('button', { name: '결제·크레딧 관리' }).click()
  await adminPage.getByLabel('이름·이메일').fill(buyer.email)
  await adminPage.getByRole('button', { name: '검색', exact: true }).click()
  await adminPage.locator('.admin-credit-user').filter({ hasText: buyer.email }).click()
  await adminPage.getByRole('heading', { name: '선택 회원 구독정보', exact: true }).waitFor()
  await adminPage.setViewportSize({ width: 375, height: 812 })
  const size = await adminPage.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  assert.ok(size.scroll <= size.width + 1)
  adminPage.once('dialog', (dialog) => dialog.accept('UI administrator cancellation'))
  await adminPage.getByRole('button', { name: '자동갱신 해지 예약', exact: true }).click()
  await adminPage.getByRole('button', { name: '해지 예약 철회', exact: true }).waitFor()
  await mockProviderRefund(adminPage, automatic, admin, true)
  adminPage.once('dialog', (dialog) => dialog.accept('UI administrator refund'))
  await adminPage.getByRole('button', { name: '결제 취소·환불', exact: true }).click()
  await until(async () => (await ownApi('/payments/account', buyer)).subscription?.status === 'cancelled', 'admin refund entitlement')
  await adminPage.screenshot({ path: join(shots, 'admin-subscription-mobile.png'), fullPage: true })
  await page.reload(); await page.getByText('이용 종료', { exact: true }).first().waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS mobile administrator sees subscription state, cancels renewal and refunds a fixture payment; user state matches')
  console.log('Subscription browser screenshots: ' + shots)
} finally {
  if (browser) await browser.close()
  for (const id of created) await http('/auth/v1/admin/users/' + id, undefined, 'DELETE')
  console.log('Temporary subscription browser accounts removed: ' + created.length)
}
