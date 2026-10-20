import type { SupabaseClient, User } from 'jsr:@supabase/supabase-js@2'
import { orderFields, orderSummary, pagination, paymentStatuses, subscriptionFields, subscriptionSummary } from './paymentHistory.ts'
import { tossRequest } from './provider.ts'

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
    const { data, error } = await db.from('shop_products').select('id,product_type,name,amount,credits,billing_interval,category_id').eq('is_active', true).order('amount')
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
    const { error: insertError } = await db.from('payment_orders').insert({ id: orderId, user_id: user.id, product_id: product.id, product_name: product.name, product_type: product.product_type, amount: product.amount, credits: product.credits })
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

  if (path === '/payments/account' && method === 'GET') {
    const user = await requiredUser(request)
    const [wallet, transactions, subscription, orders] = await Promise.all([
      db.from('credit_wallets').select('balance').eq('user_id', user.id).maybeSingle(),
      db.from('credit_transactions').select('id,amount,description,kind,balance_before,balance_after,created_at,order_id').eq('user_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20),
      db.from('subscriptions').select(subscriptionFields).eq('user_id', user.id).maybeSingle(),
      db.from('payment_orders').select(orderFields, { count: 'exact' }).eq('user_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(5),
    ])
    const queryError = [wallet, transactions, subscription, orders].find((result) => result.error)?.error
    if (queryError) return fail(queryError.message, 500)
    const { data: events, error: eventError } = await db.from('subscription_events').select('id,event_type,description,created_at,order_id').eq('user_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20)
    if (eventError) return fail(eventError.message, 500)
    return json({ balance: wallet.data?.balance || 0, transactions: transactions.data || [], subscription: subscriptionSummary(subscription.data), subscription_events: events || [], orders: (orders.data || []).map(orderSummary), order_count: orders.count || 0 })
  }

  if (path === '/payments/orders' && method === 'GET') {
    const user = await requiredUser(request)
    const { params, page, limit, offset } = pagination(request)
    const status = params.get('status') || 'all'
    if (status !== 'all' && !paymentStatuses.includes(status)) return fail('올바른 결제 상태를 선택해주세요.')
    let query = db.from('payment_orders').select(orderFields, { count: 'exact' }).eq('user_id', user.id)
    if (status !== 'all') query = query.eq('status', status)
    const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
    if (error) return fail(error.message, 500)
    return json({ items: (data || []).map(orderSummary), total: count || 0, page, limit })
  }

  // Only unfinished orders may be marked as closed by the checkout UI.
  // Approved payments always require the provider-backed refund route below.
  const closeMatch = path.match(/^\/payments\/orders\/([^/]+)\/close$/)
  if (closeMatch && method === 'POST') {
    const user = await requiredUser(request)
    const input = await parseBody(request)
    const status = input.status === 'cancelled' ? 'cancelled' : input.status === 'failed' ? 'failed' : ''
    if (!status) return fail('취소 또는 실패 상태만 기록할 수 있습니다.')
    const now = new Date().toISOString()
    const reason = String(input.message || (status === 'cancelled' ? '결제창에서 취소' : '결제 실패')).slice(0, 500)
    const values = status === 'cancelled' ? { status, cancel_reason: reason, canceled_at: now }
      : { status, failure_code: String(input.code || '').slice(0, 100), failure_message: reason, failed_at: now }
    const id = decodeURIComponent(closeMatch[1])
    const { data, error } = await db.from('payment_orders').update(values).eq('id', id).eq('user_id', user.id).eq('status', 'pending').select('id,status').maybeSingle()
    if (error) return fail(error.message?.includes('PAYMENT_IN_PROGRESS') ? '결제 승인을 확인 중입니다. 잠시 후 주문 상태를 확인해주세요.' : error.message, error.message?.includes('PAYMENT_IN_PROGRESS') ? 409 : 500)
    if (data) return json(data)
    const { data: existing, error: readError } = await db.from('payment_orders').select('id,status').eq('id', id).eq('user_id', user.id).maybeSingle()
    if (readError) return fail(readError.message, 500)
    return existing ? json({ ...existing, alreadyProcessed: true }) : fail('주문을 찾을 수 없습니다.', 404)
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
    if (!tossSecret) return fail('결제 서비스 설정을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', 503)
    const { data: reservation, error: reserveError } = await db.rpc('reserve_credit_refund', { p_order_id: orderId, p_reason: reason })
    if (reserveError) return fail(reserveError.message?.includes('INSUFFICIENT_CREDIT_BALANCE') ? '크레딧 잔액이 부족하여 환불할 수 없습니다.' : '환불 준비에 실패했습니다. 잠시 후 다시 시도해주세요.', 409)
    if (reservation.alreadyProcessed) return json({ orderId, alreadyProcessed: true })
    const refundReason = reservation.reason || reason
    try {
      // Query the provider first, including on retry after an ambiguous timeout.
      // A completed provider cancellation must finalize the ledger, not release credits.
      const providerPayment = await tossRequest(`payments/${encodeURIComponent(order.toss_payment_key)}`, tossSecret)
      if (providerPayment.orderId !== orderId || providerPayment.totalAmount !== order.amount) return fail('결제 정보가 주문과 일치하지 않습니다. 주문번호로 문의해주세요.', 409)
      if (!['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(providerPayment.status)) return fail('결제 취소 상태 확인이 필요합니다. 주문번호로 문의해주세요.', 409)
      const cancellation = providerPayment.status === 'CANCELED' ? providerPayment
        : await tossRequest(`payments/${encodeURIComponent(order.toss_payment_key)}/cancel`, tossSecret, { cancelReason: refundReason }, reservation.requestId)
      const { data, error: refundError } = await db.rpc('refund_credit_order', { p_order_id: orderId, p_cancel_reason: refundReason, p_cancel_data: cancellation })
      if (refundError) {
        console.error('Toss refund succeeded but credit refund record failed', refundError)
        return fail('결제 취소는 완료됐지만 포인트 원장 반영에 실패했습니다. 고객센터에 주문번호를 알려 주세요.', 500)
      }
      return json(data)
    } catch (error) {
      console.error('Payment refund failed', error)
      const status = Number((error as { status?: number })?.status) || 500
      // A timeout/5xx/409 can leave the cancellation in flight. Keep the
      // reservation and reuse the same provider idempotency key on retry.
      if (status >= 400 && status < 500 && status !== 409 && (error as { code?: string })?.code !== 'ALREADY_CANCELED_PAYMENT') {
        const { error: releaseError } = await db.rpc('release_credit_refund', { p_order_id: orderId })
        if (releaseError) return fail('환불 실패 후 크레딧 예약 해제에 실패했습니다. 주문번호로 문의해주세요.', 500)
      }
      return fail(error instanceof Error ? error.message : '환불 처리에 실패했습니다.', status >= 400 && status < 500 ? 400 : 500)
    }
  }

  return null
}
