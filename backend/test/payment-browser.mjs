// Run explicitly with npm exec --package=playwright. Uses headless Edge and
// temporary accounts; never charges or cancels a real provider payment.
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, delimiter } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

if (!process.argv.includes('--allow-remote-fixtures')) throw new Error('Remote fixture opt-in is required.')
const require = createRequire(import.meta.url)
let playwright
for (const dir of process.env.PATH.split(delimiter)) {
  const candidate = join(dir, '..', 'playwright')
  if (existsSync(join(candidate, 'package.json'))) { playwright = require(candidate); break }
}
if (!playwright) throw new Error('Run through npm exec --package=playwright.')
const { chromium } = playwright
const env = {}
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/)
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}
const site = 'https://onboardproject.shop'
const base = 'https://ymprvqsfpwvoutwozwvn.supabase.co'
const prefix = `moa-ui-${randomUUID().slice(0, 8)}`
const created = []
const errors = []
const snapshots = join(tmpdir(), prefix)
mkdirSync(snapshots)
let browser

async function http(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + path, { method, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) })
  assert.ok(response.ok, `Fixture request failed: ${method} ${path.split('?')[0]} ${response.status}`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}
async function account(label, admin = false) {
  const email = `${prefix}-${label}@example.com`
  const password = randomUUID() + '!Test9'
  const user = await http('/auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { name: `${prefix}-${label}` } })
  created.push(user.id)
  if (admin) await http(`/rest/v1/profiles?id=eq.${user.id}`, { role: 'admin' }, 'PATCH')
  return { id: user.id, email, password }
}
async function waitFor(callback, name) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await callback()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out: ${name}`)
}
async function noOverflow(page, name) {
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  assert.ok(size.scroll <= size.width + 1, `${name}: horizontal overflow ${size.scroll}/${size.width}`)
  console.log(`PASS ${name} has no horizontal overflow`)
}

function trackPage(page) {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) errors.push('Unexpected local request')
  })
}

try {
  const buyer = await account('buyer')
  const admin = await account('admin', true)
  const orderId = `${prefix}-paid`
  const canceledOrderId = `${prefix}-cancelled`
  const failedOrderId = `${prefix}-failed`
  await http('/rest/v1/payment_orders', { id: orderId, user_id: buyer.id, product_id: 'credits_1000', product_name: 'UI fixture credit purchase', product_type: 'credits', amount: 1000, credits: 1000, status: 'paid', paid_at: new Date().toISOString(), toss_payment_key: `${prefix}-key`, toss_payment_data: { method: 'CARD', receipt: { url: 'https://receipts.tosspayments.com/fixture' } } })
  for (const [id, name] of [[canceledOrderId, 'UI fixture cancelled purchase'], [failedOrderId, 'UI fixture failed purchase']]) {
    await http('/rest/v1/payment_orders', { id, user_id: buyer.id, product_id: 'credits_1000', product_name: name, product_type: 'credits', amount: 1000, credits: 1000, status: 'pending' })
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const adminContext = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const page = await adminContext.newPage()
  trackPage(page)
  await page.goto(site + '/admin/login')
  await page.getByLabel('이메일', { exact: true }).fill(admin.email)
  await page.getByLabel('비밀번호', { exact: true }).fill(admin.password)
  await page.getByRole('button', { name: '관리자 콘솔 접속', exact: true }).click()
  await page.waitForURL(site + '/admin')
  console.log('PASS administrator signs in through the production login form')
  await page.locator('.admin-sidebar-v2').getByRole('button', { name: '결제·크레딧 관리' }).click()
  await page.getByLabel('이름·이메일').fill(buyer.email)
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await page.locator('.admin-credit-user').filter({ hasText: buyer.email }).click()
  await page.locator('.admin-credit-selected').waitFor()
  await page.getByLabel('크레딧 (P)', { exact: true }).fill('300')
  await page.getByLabel('처리 사유').fill('UI fixture grant')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '크레딧 지급', exact: true }).click()
  await waitFor(async () => (await page.locator('.admin-credit-selected').textContent().catch(() => ''))?.includes('300P'), 'credit grant balance')
  assert.ok(await page.locator('.admin-credit-ledger').getByText('UI fixture grant').count())
  console.log('PASS administrator credit grant form updates Supabase balance and audit ledger')
  await page.screenshot({ path: join(snapshots, 'admin-desktop.png'), fullPage: true })
  await noOverflow(page, 'administrator desktop')

  const buyerContext = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const profile = await buyerContext.newPage()
  trackPage(profile)
  await profile.goto(site + '/admin/login')
  await profile.getByLabel('이메일', { exact: true }).fill(buyer.email)
  await profile.getByLabel('비밀번호', { exact: true }).fill(buyer.password)
  await profile.getByRole('button', { name: '관리자 콘솔 접속', exact: true }).click()
  await profile.locator('.admin-error').filter({ hasText: '관리자 권한이 필요합니다.' }).waitFor()
  assert.equal(await profile.evaluate(() => localStorage.getItem('adminToken')), null)
  console.log('PASS ordinary user is rejected by the administrator login form')
  await profile.goto(site + '/login')
  await profile.getByLabel('이메일', { exact: true }).fill(buyer.email)
  await profile.getByLabel('비밀번호', { exact: true }).fill(buyer.password)
  await profile.getByRole('button', { name: '로그인', exact: true }).click()
  await profile.waitForURL(site + '/')
  console.log('PASS user signs in through the production login form')
  for (const [id, code, message, expected] of [
    [canceledOrderId, 'PAY_PROCESS_CANCELED', 'Browser checkout cancelled', 'cancelled'],
    [failedOrderId, 'PAY_PROCESS_ABORTED', 'Browser checkout failed', 'failed'],
  ]) {
    const query = new URLSearchParams({ flow: 'credits', checkoutOrderId: id, code, message })
    await profile.goto(site + '/shop/fail?' + query.toString())
    await profile.locator('.shop-notice').filter({ hasText: message }).waitFor()
    const saved = (await http(`/rest/v1/payment_orders?id=eq.${id}&select=status,cancel_reason,canceled_at,failure_code,failure_message,failed_at`))[0]
    assert.equal(saved.status, expected)
    if (expected === 'cancelled') { assert.equal(saved.cancel_reason, message); assert.ok(Date.parse(saved.canceled_at)) }
    else { assert.equal(saved.failure_code, code); assert.equal(saved.failure_message, message); assert.ok(Date.parse(saved.failed_at)) }
  }
  console.log('PASS simulated checkout cancel/failure redirects persist exact status/reason/time in Supabase')
  await profile.goto(site + '/profile')
  await profile.getByRole('heading', { name: '내 결제정보', exact: true }).waitFor()
  await waitFor(async () => (await profile.locator('.payment-summary-card').first().textContent())?.includes('300P'), 'profile credit balance')
  await profile.getByText('UI fixture credit purchase', { exact: true }).waitFor()
  assert.equal(await profile.getByRole('link', { name: '영수증 보기 ↗', exact: true }).getAttribute('href'), 'https://receipts.tosspayments.com/fixture')
  await profile.locator('.payment-order-card').filter({ hasText: 'UI fixture credit purchase' }).getByText('결제 상세정보', { exact: true }).click()
  assert.ok(await profile.getByText(orderId, { exact: true }).isVisible())
  console.log('PASS user profile shows purchased item, receipt, credit balance and order details')
  await noOverflow(profile, 'profile desktop')
  await profile.screenshot({ path: join(snapshots, 'profile-desktop.png'), fullPage: true })
  await profile.setViewportSize({ width: 375, height: 812 })
  await noOverflow(profile, 'profile mobile')
  await profile.screenshot({ path: join(snapshots, 'profile-mobile.png'), fullPage: true })
  await profile.getByRole('link', { name: '결제내역 자세히 보기 →', exact: true }).click()
  await profile.getByRole('heading', { name: '구독 · 크레딧 · 결제내역', exact: true }).waitFor()
  await profile.getByText('UI fixture credit purchase', { exact: true }).waitFor()
  await profile.getByRole('combobox').selectOption('cancelled')
  await profile.getByText('UI fixture cancelled purchase', { exact: true }).waitFor()
  assert.equal(await profile.getByText('UI fixture credit purchase', { exact: true }).count(), 0)
  await profile.getByRole('combobox').selectOption('failed')
  await profile.getByText('UI fixture failed purchase', { exact: true }).waitFor()
  console.log('PASS full history displays the persisted cancelled/failed orders through status filters')
  await noOverflow(profile, 'full payment history mobile')

  await page.setViewportSize({ width: 375, height: 812 })
  await noOverflow(page, 'administrator mobile')
  await page.getByLabel('처리 구분').selectOption('revoke')
  await page.getByLabel('크레딧 (P)', { exact: true }).fill('100')
  await page.getByLabel('처리 사유').fill('UI fixture recovery')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '크레딧 회수', exact: true }).click()
  await waitFor(async () => (await page.locator('.admin-credit-selected').textContent().catch(() => ''))?.includes('200P'), 'credit recovery balance')
  console.log('PASS mobile administrator credit recovery form updates the selected user balance')
  await page.screenshot({ path: join(snapshots, 'admin-mobile.png'), fullPage: true })
  await profile.goto(site + '/profile')
  await profile.getByRole('button', { name: '로그아웃', exact: true }).click()
  await profile.goto(site + '/profile/payments')
  await profile.getByRole('heading', { name: '다시 만나서 반가워요', exact: true }).waitFor()
  assert.equal(await profile.evaluate(() => localStorage.getItem('token')), null)
  await page.getByRole('button', { name: '로그아웃', exact: true }).click()
  await page.waitForURL(site + '/admin/login')
  await page.goto(site + '/admin')
  await page.waitForURL(site + '/admin/login')
  assert.equal(await page.evaluate(() => localStorage.getItem('adminToken')), null)
  console.log('PASS user/admin logout clears credentials and protects account pages')
  assert.deepEqual(errors, [])
  console.log(`PASS no browser runtime errors; screenshots: ${snapshots}`)
} finally {
  if (browser) await browser.close()
  for (const id of created) await http(`/auth/v1/admin/users/${id}`, undefined, 'DELETE')
  console.log(`Temporary browser fixture accounts removed: ${created.length}`)
}
