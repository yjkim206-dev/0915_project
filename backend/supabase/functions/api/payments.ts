import type { SupabaseClient, User } from 'jsr:@supabase/supabase-js@2'

const products = [
  { id: 'premium_monthly', type: 'subscription', name: 'MOA Premium 월간 구독', amount: 9900, credits: 0 },
  { id: 'credits_1000', type: 'credits', name: '포인트 1,000P', amount: 1000, credits: 1000 },
  { id: 'credits_5500', type: 'credits', name: '포인트 5,500P', amount: 5000, credits: 5500 },
]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json' },
})
const fail = (message: string, status = 400) => json({ message }, status)
const parseBody = async (request: Request) => { try { return await request.json() } catch { return {} } }
const paymentAuth = (secret: string) => `Basic ${btoa(`${secret}:`)}`

async function tossRequest(path: string, secret: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.tosspayments.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: paymentAuth(secret), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || 'Toss 결제 요청에 실패했습니다.')
    Object.assign(error, { status: response.status, code: payload.code })
    throw error
  }
  return payload
}

function customerKeyFor(user: User) { return `moa_${user.id.replaceAll('-', '')}` }
function newOrderId() { return `MOA_${crypto.randomUUID().replaceAll('-', '')}` }

export async function handlePaymentRoutes(
  path: string,
  method: string,
  request: Request,
  db: SupabaseClient,
  requiredUser: (request: Request) => Promise<User>,
  tossSecret: string,
) {
  if (path === '/shop/products' && method === 'GET') {
    const { data, error } = await db.from('shop_products').select('id,product_type,name,amount,credits,billing_interval').eq('is_active', true).order('amount')
    if (error) return fail(error.message, 500)
    return json(data || [])
  }

  if (path === '/payments/orders' && method === 'POST') {
    const user = await requiredUser(request)
    const input = await parseBody(request)
    const { data: product, error: productError } = await db.from('shop_products').select('*').eq('id', String(input.productId || '')).eq('is_active', true).maybeSingle()
    if (productError) return fail(productError.message, 500)
    if (!product) return fail('판매 중인 상품을 찾을 수 없습니다.', 404)
    if (product.product_type !== 'credits') return fail('이 상품은 구독 카드 등록 절차로 주문해야 합니다.', 400)
    const orderId = newOrderId()
    const { error: insertError } = await db.from('payment_orders').insert({ id: orderId, user_id: user.id, product_id: product.id, product_type: product.product_type, amount: product.amount, credits: product.credits })
    if (insertError) return fail(insertError.message, 500)
    return json({ orderId, orderName: product.name, amount: product.amount, customerKey: customerKeyFor(user) }, 201)
  }

  if (path === '/payments/confirm' && method === 'POST') {
    const user = await requiredUser(request)
    const input = await parseBody(request)
    const orderId = String(input.orderId || '')
    const paymentKey = String(input.paymentKey || '')
    const amount = Number(input.amount)
    if (!orderId || !paymentKey || !Number.isSafeInteger(amount)) return fail('결제 승인 정보가 올바르지 않습니다.')
    const { data: order, error: readError } = await db.from('payment_orders').select('*').eq('id', orderId).eq('user_id', user.id).maybeSingle()
    if (readError) return fail(readError.message, 500)
    if (!order) return fail('주문을 찾을 수 없습니다.', 404)
    if (order.status === 'paid') return fail('이미 처리된 주문입니다.', 409)
    if (order.product_type !== 'credits' || order.amount !== amount) return fail('주문 금액이 일치하지 않습니다.', 400)
    try {
      const payment = await tossRequest('payments/confirm', tossSecret, { paymentKey, orderId, amount })
      const { data, error: settleError } = await db.rpc('settle_credit_order', { p_order_id: orderId, p_payment_key: paymentKey, p_payment_data: payment })
      if (settleError) throw settleError
      return json({ ...data, payment: { method: payment.method, approvedAt: payment.approvedAt } })
    } catch (error) {
      console.error('Payment confirmation failed', error)
      const status = Number((error as { status?: number })?.status) || 500
      return fail(error instanceof Error ? error.message : '결제 승인 처리에 실패했습니다.', status >= 400 && status < 500 ? 400 : 500)
    }
  }

  if (path === '/payments/subscriptions/orders' && method === 'POST') {
    const user = await requiredUser(request)
    const { data: active, error: activeError } = await db.from('subscriptions').select('id,status').eq('user_id', user.id).eq('status', 'active').maybeSingle()
    if (activeError) return fail(activeError.message, 500)
    if (active) return fail('이미 활성 구독이 있습니다.', 409)
    const { data: product, error: productError } = await db.from('shop_products').select('*').eq('id', 'premium_monthly').eq('is_active', true).single()
    if (productError) return fail(productError.message, 500)
    const orderId = newOrderId()
    const { error: insertError } = await db.from('payment_orders').insert({ id: orderId, user_id: user.id, product_id: product.id, product_type: 'subscription', amount: product.amount, credits: 0 })
    if (insertError) return fail(insertError.message, 500)
    return json({ orderId, customerKey: customerKeyFor(user) }, 201)
  }

  if (path === '/payments/subscriptions/activate' && method === 'POST') {
    const user = await requiredUser(request)
    const input = await parseBody(request)
    const authKey = String(input.authKey || '')
    const orderId = String(input.orderId || '')
    if (!authKey || authKey.length > 300 || !orderId) return fail('카드 인증 정보가 올바르지 않습니다.')
    const { data: order, error: orderError } = await db.from('payment_orders').select('*').eq('id', orderId).eq('user_id', user.id).maybeSingle()
    if (orderError) return fail(orderError.message, 500)
    if (!order || order.product_type !== 'subscription') return fail('구독 주문을 찾을 수 없습니다.', 404)
    if (order.status === 'paid') return fail('이미 처리된 구독 주문입니다.', 409)
    const customerKey = customerKeyFor(user)
    try {
      const billing = await tossRequest('billing/authorizations/issue', tossSecret, { authKey, customerKey })
      const payment = await tossRequest(`billing/${encodeURIComponent(billing.billingKey)}`, tossSecret, {
        customerKey,
        amount: order.amount,
        orderId,
        orderName: 'MOA Premium 월간 구독 첫 결제',
        customerEmail: user.email,
      })
      const { data, error: settleError } = await db.rpc('settle_subscription_order', {
        p_order_id: orderId,
        p_customer_key: customerKey,
        p_billing_key: billing.billingKey,
        p_payment_key: payment.paymentKey || orderId,
        p_payment_data: payment,
      })
      if (settleError) throw settleError
      return json(data)
    } catch (error) {
      console.error('Subscription activation failed', error)
      const status = Number((error as { status?: number })?.status) || 500
      return fail(error instanceof Error ? error.message : '구독 활성화에 실패했습니다.', status >= 400 && status < 500 ? 400 : 500)
    }
  }

  if (path === '/payments/account' && method === 'GET') {
    const user = await requiredUser(request)
    const [wallet, transactions, subscription, orders] = await Promise.all([
      db.from('credit_wallets').select('balance').eq('user_id', user.id).maybeSingle(),
      db.from('credit_transactions').select('id,amount,description,created_at,order_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
      db.from('subscriptions').select('status,current_period_start,current_period_end,cancel_at_period_end').eq('user_id', user.id).maybeSingle(),
      db.from('payment_orders').select('id,product_id,product_type,amount,credits,status,created_at,paid_at,canceled_at,cancel_reason,toss_payment_data').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
    ])
    const queryError = [wallet, transactions, subscription, orders].find((result) => result.error)?.error
    if (queryError) return fail(queryError.message, 500)
    const orderRows = (orders.data || []).map((order) => ({
      id: order.id,
      product_id: order.product_id,
      product_type: order.product_type,
      amount: order.amount,
      credits: order.credits,
      status: order.status,
      created_at: order.created_at,
      paid_at: order.paid_at,
      canceled_at: order.canceled_at,
      cancel_reason: order.cancel_reason,
      receipt_url: order.toss_payment_data?.receipt?.url || null,
    }))
    return json({ balance: wallet.data?.balance || 0, transactions: transactions.data || [], subscription: subscription.data || null, orders: orderRows })
  }

  const refundMatch = path.match(/^\/payments\/orders\/([^/]+)\/refund$/)
  if (refundMatch && method === 'POST') {
    const user = await requiredUser(request)
    const orderId = decodeURIComponent(refundMatch[1])
    const input = await parseBody(request)
    const reason = String(input.reason || '구매 취소').trim().slice(0, 100)
    const { data: order, error: orderError } = await db.from('payment_orders').select('*').eq('id', orderId).eq('user_id', user.id).maybeSingle()
    if (orderError) return fail(orderError.message, 500)
    if (!order) return fail('주문을 찾을 수 없습니다.', 404)
    if (order.product_type !== 'credits') return fail('구독 결제는 결제내역의 구독 해지 메뉴에서 처리해 주세요.', 400)
    if (order.status === 'refunded' || order.status === 'cancelled') return json({ orderId, status: order.status, alreadyProcessed: true })
    if (order.status !== 'paid' || !order.toss_payment_key) return fail('승인 완료된 주문만 환불할 수 있습니다.', 409)
    try {
      const cancellation = await tossRequest(`payments/${encodeURIComponent(order.toss_payment_key)}/cancel`, tossSecret, { cancelReason: reason })
      const { data, error: refundError } = await db.rpc('refund_credit_order', { p_order_id: orderId, p_cancel_reason: reason, p_cancel_data: cancellation })
      if (refundError) {
        console.error('Toss refund succeeded but credit refund record failed', refundError)
        return fail('결제 취소는 완료됐지만 포인트 원장 반영에 실패했습니다. 고객센터에 주문번호를 알려 주세요.', 500)
      }
      return json(data)
    } catch (error) {
      console.error('Payment refund failed', error)
      const status = Number((error as { status?: number })?.status) || 500
      return fail(error instanceof Error ? error.message : '환불 처리에 실패했습니다.', status >= 400 && status < 500 ? 400 : 500)
    }
  }

  if (path === '/payments/subscriptions/cancel' && method === 'POST') {
    const user = await requiredUser(request)
    const { data, error } = await db.from('subscriptions').update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('status', 'active').select('status,current_period_end,cancel_at_period_end').maybeSingle()
    if (error) return fail(error.message, 500)
    if (!data) return fail('활성 구독을 찾을 수 없습니다.', 404)
    return json(data)
  }

  return null
}
