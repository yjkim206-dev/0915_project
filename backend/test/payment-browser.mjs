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
const site = 'https://0915-project-ruby.vercel.app'
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
  const session = await http('/auth/v1/token?grant_type=password', { email, password })
  return { id: user.id, token: session.access_token, email }
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

try {
  const buyer = await account('buyer')
  const admin = await account('admin', true)
  const orderId = `${prefix}-paid`
  await http('/rest/v1/payment_orders', { id: orderId, user_id: buyer.id, product_id: 'credits_1000', product_name: 'UI fixture credit purchase', product_type: 'credits', amount: 1000, credits: 1000, status: 'paid', paid_at: new Date().toISOString(), toss_payment_key: `${prefix}-key`, toss_payment_data: { method: 'CARD', receipt: { url: 'https://receipts.tosspayments.com/fixture' } } })
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const adminContext = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await adminContext.addInitScript(({ token }) => { localStorage.setItem('adminToken', token); localStorage.setItem('authExpiresAt', String(Date.now() + 3600000)) }, { token: admin.token })
  const page = await adminContext.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(site + '/admin')
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
  await buyerContext.addInitScript(({ token, id }) => { localStorage.setItem('token', token); localStorage.setItem('userId', id); localStorage.setItem('authExpiresAt', String(Date.now() + 3600000)) }, buyer)
  const profile = await buyerContext.newPage()
  profile.on('pageerror', (error) => errors.push(error.message))
  await profile.goto(site + '/profile')
  await profile.getByRole('heading', { name: '내 결제정보', exact: true }).waitFor()
  await waitFor(async () => (await profile.locator('.payment-summary-card').first().textContent())?.includes('300P'), 'profile credit balance')
  await profile.getByText('UI fixture credit purchase', { exact: true }).waitFor()
  assert.equal(await profile.getByRole('link', { name: '영수증 보기 ↗', exact: true }).getAttribute('href'), 'https://receipts.tosspayments.com/fixture')
  await profile.getByText('결제 상세정보', { exact: true }).click()
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
  assert.deepEqual(errors, [])
  console.log(`PASS no browser runtime errors; screenshots: ${snapshots}`)
} finally {
  if (browser) await browser.close()
  for (const id of created) await http(`/auth/v1/admin/users/${id}`, undefined, 'DELETE')
  console.log(`Temporary browser fixture accounts removed: ${created.length}`)
}
