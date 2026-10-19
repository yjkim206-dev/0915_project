import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { tossRequest } from './provider.ts'
import { subscriptionFields, subscriptionSummary, validUuid } from './paymentHistory.ts'

const subscriptionJson = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} })
const subscriptionError = (message: string, status = 400) => subscriptionJson({ message }, status)
const subscriptionBody = async (request: Request) => { try { return await request.json() } catch { return {} } }
const subscriptionErrors: Record<string, string> = {
  SUBSCRIPTION_ACTIVE: '이미 이용 중인 구독이 있습니다. 종료 후 다시 결제해주세요.',
  SUBSCRIPTION_NOT_ACTIVE: '변경할 활성 구독이 없습니다.',
  PAYMENT_IN_PROGRESS: '결제를 확인 중입니다. 잠시 후 다시 시도해주세요.',
  REFUND_IN_PROGRESS: '구독 환불을 확인 중입니다. 완료 후 다시 시도해주세요.',
  LATEST_PAYMENT_ONLY: '현재 구독에 연결된 가장 최근 결제만 환불할 수 있습니다.',
  ORDER_NOT_PENDING: '취소되거나 종료된 주문입니다. 상점에서 다시 주문해주세요.',
  RENEWAL_CANCELED: '자동갱신이 해지된 주문입니다.',
  RESTART_NOT_ALLOWED: '자동갱신 구독의 이용기간 안에서만 해지 예약을 철회할 수 있습니다.',
}
function subscriptionFailure(error: any) {
  const code = Object.keys(subscriptionErrors).find((key) => String(error?.message || '').includes(key))
  return subscriptionError(code ? subscriptionErrors[code] : '구독 처리 상태를 확인하지 못했습니다. 잠시 후 같은 주문으로 다시 시도해주세요.', code ? 409 : 503)
}
function validSubscriptionPayment(payment: any, order: any) {
  return payment.orderId === order.id && payment.totalAmount === order.amount && payment.status === 'DONE' && typeof payment.paymentKey === 'string'
}

export async function subscriptionAccount(db: SupabaseClient, userId: string) {
  const [subscription, events] = await Promise.all([
    db.from('subscriptions').select(subscriptionFields).eq('user_id', userId).maybeSingle(),
    db.from('subscription_events').select('id,event_type,description,created_at,order_id,actor_id').eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20),
  ])
  if (subscription.error || events.error) throw subscription.error || events.error
  return { subscription: subscriptionSummary(subscription.data), events: events.data || [] }
}

export async function chargeSubscription(db: SupabaseClient, order: any, secret: string, input: any = {}, renewalBillingKey?: string) {
  if (!secret) return subscriptionError('구독 결제 서비스가 설정되지 않았습니다.', 503)
  if (order.status === 'paid') return subscriptionJson({ orderId: order.id, alreadyProcessed: true, currentPeriodEnd: order.subscription_period_end })
  const { data: claim, error: claimError } = await db.rpc('claim_subscription_payment', { p_order_id: order.id })
  if (claimError) return subscriptionFailure(claimError)
  if (claim.alreadyProcessed) return subscriptionJson({ orderId: order.id, alreadyProcessed: true, currentPeriodEnd: order.subscription_period_end })
  try {
    const { data: attempt, error: attemptError } = await db.from('subscription_payment_attempts').select('billing_key').eq('order_id', order.id).single()
    if (attemptError) throw attemptError
    let billingKey = renewalBillingKey || attempt.billing_key
    let payment
    try { payment = await tossRequest(`payments/orders/${encodeURIComponent(order.id)}`, secret) }
    catch (error) { if (Number((error as any)?.status) !== 404) throw error }
    if (order.subscription_mode === 'automatic' && !billingKey) {
      if (!input.authKey || String(input.authKey).length > 300) throw Object.assign(new Error('카드등록 인증정보를 찾지 못했습니다. 다시 등록해주세요.'), { status: 400 })
      const billing = await tossRequest('billing/authorizations/issue', secret, { authKey: input.authKey, customerKey: `moa_${order.user_id.replaceAll('-', '')}` }, `billing-${order.id}`)
      billingKey = billing.billingKey
      if (!billingKey) throw new Error('Missing billing key')
      const { error } = await db.from('subscription_payment_attempts').update({ billing_key: billingKey }).eq('order_id', order.id)
      if (error) throw error
    }
    if (!payment || payment.status !== 'DONE') {
      payment = order.subscription_mode === 'manual'
        ? await tossRequest('payments/confirm', secret, { paymentKey: input.paymentKey, orderId: order.id, amount: order.amount }, claim.requestId)
        : await tossRequest(`billing/${encodeURIComponent(billingKey)}`, secret, { customerKey: `moa_${order.user_id.replaceAll('-', '')}`, amount: order.amount, orderId: order.id, orderName: order.product_name }, claim.requestId)
    }
    if (!validSubscriptionPayment(payment, order)) throw new Error('Provider payment mismatch')
    const { data, error } = await db.rpc('settle_subscription_purchase', { p_order_id: order.id, p_payment_key: payment.paymentKey, p_payment_data: payment, p_billing_key: order.subscription_mode === 'automatic' ? billingKey : null })
    if (error) throw error
    return subscriptionJson(data)
  } catch (error: any) {
    const status = Number(error?.status)
    if (status >= 400 && status < 500 && status !== 409 && !['ALREADY_PROCESSED_PAYMENT', 'ALREADY_CANCELED_PAYMENT'].includes(error?.code)) {
      // Only definite provider rejection ends an order. Timeouts retain the
      // durable request id/lease, allowing reconciliation without double charge.
      const message = String(error.message || '구독 결제 실패').slice(0, 500)
      const { error: recordError } = await db.rpc('record_subscription_failure', { p_order_id: order.id, p_code: String(error.code || 'PAYMENT_REJECTED').slice(0, 100), p_message: message })
      if (recordError) return subscriptionFailure(recordError)
      return subscriptionError(message, 400)
    }
    console.error('Subscription processing requires reconciliation', order.id)
    return subscriptionFailure(error)
  }
}

export async function refundSubscription(db: SupabaseClient, order: any, actorId: string, reason: string, secret: string) {
  if (!secret) return subscriptionError('구독 결제 서비스가 설정되지 않았습니다.', 503)
  const { data: reservation, error } = await db.rpc('prepare_subscription_refund', { p_order_id: order.id, p_actor_id: actorId, p_reason: reason })
  if (error) return subscriptionFailure(error)
  if (reservation.alreadyProcessed) return subscriptionJson({ orderId: order.id, alreadyProcessed: true })
  try {
    let payment = await tossRequest(`payments/${encodeURIComponent(order.toss_payment_key)}`, secret)
    if (payment.orderId !== order.id || payment.totalAmount !== order.amount) throw new Error('Provider payment mismatch')
    if (!['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(payment.status)) throw new Error('Unexpected cancellation state')
    if (payment.status !== 'CANCELED') payment = await tossRequest(`payments/${encodeURIComponent(order.toss_payment_key)}/cancel`, secret, { cancelReason: reservation.reason }, reservation.requestId)
    const { data, error: finishError } = await db.rpc('finish_subscription_refund', { p_order_id: order.id, p_actor_id: actorId, p_cancel_data: payment })
    if (finishError) throw finishError
    return subscriptionJson(data)
  } catch (error: any) {
    const status = Number(error?.status)
    if (status >= 400 && status < 500 && status !== 409 && error?.code !== 'ALREADY_CANCELED_PAYMENT') {
      const { error: recordError } = await db.from('payment_orders').update({ refund_reserved: false, refund_request_id: null }).eq('id', order.id).eq('status', 'paid')
      if (recordError) return subscriptionFailure(recordError)
      return subscriptionError(`${error.message} 자동갱신 해지 예약은 유지됩니다.`, 400)
    }
    return subscriptionError('환불 승인 상태를 확인 중입니다. 결제내역의 환불 처리 다시 확인을 눌러주세요. 자동갱신은 중단됩니다.', 503)
  }
}

export async function reconcileSubscription(db: SupabaseClient, order: any, secret: string) {
  if (order.status !== 'pending') return subscriptionJson({ orderId: order.id, status: order.status, currentPeriodEnd: order.subscription_period_end })
  const { data: attempt, error } = await db.from('subscription_payment_attempts').select('billing_key').eq('order_id', order.id).maybeSingle()
  if (error) return subscriptionFailure(error)
  if (!attempt) return subscriptionJson({ orderId: order.id, status: 'pending', message: '아직 결제가 승인되지 않았습니다. 결제창에서 완료하거나 미결제 주문을 취소해주세요.' })
  if (!secret) return subscriptionError('구독 결제 서비스가 설정되지 않았습니다.', 503)
  const { data: claim, error: claimError } = await db.rpc('claim_subscription_payment', { p_order_id: order.id })
  if (claimError) return subscriptionFailure(claimError)
  if (claim.alreadyProcessed) return subscriptionJson({ orderId: order.id, status: 'paid' })
  try {
    let payment
    try { payment = await tossRequest(`payments/orders/${encodeURIComponent(order.id)}`, secret) }
    catch (error: any) { if (error?.status !== 404) throw error }
    if (payment?.status === 'DONE') {
      if (!validSubscriptionPayment(payment, order)) throw new Error('Provider payment mismatch')
      const { data, error } = await db.rpc('settle_subscription_purchase', { p_order_id: order.id, p_payment_key: payment.paymentKey, p_payment_data: payment, p_billing_key: attempt.billing_key })
      if (error) throw error
      return subscriptionJson(data)
    }
    if (!payment || ['EXPIRED', 'ABORTED', 'CANCELED'].includes(payment.status)) {
      const { error: updateError } = await db.rpc('record_subscription_failure', { p_order_id: order.id, p_code: 'NO_APPROVED_PAYMENT', p_message: '승인된 구독 결제를 찾지 못했습니다. 다시 결제해주세요.' })
      if (updateError) throw updateError
      return subscriptionJson({ orderId: order.id, status: 'failed', message: '승인된 결제가 없어 주문을 종료했습니다. 상점에서 다시 결제해주세요.' })
    }
    const { error: releaseError } = await db.from('subscription_payment_attempts').update({ lease_until: new Date().toISOString() }).eq('order_id', order.id)
    if (releaseError) throw releaseError
    return subscriptionError('카드 인증이 진행 중입니다. 결제창에서 완료한 후 다시 확인해주세요.', 409)
  } catch (error) { return subscriptionFailure(error) }
}

export async function runSubscriptionRenewals(request: Request, db: SupabaseClient, secret: string, cronSecret: string) {
  if (!cronSecret || request.headers.get('x-subscription-cron-secret') !== cronSecret) return subscriptionError('접근 권한이 없습니다.', 401)
  if (!secret) return subscriptionError('구독 결제 서비스가 설정되지 않았습니다.', 503)
  const { data: expired, error: expireError } = await db.rpc('expire_subscriptions')
  if (expireError) return subscriptionFailure(expireError)
  const { data: due, error } = await db.from('subscriptions').select('id,billing_key').eq('status', 'active').eq('billing_mode', 'automatic').eq('cancel_at_period_end', false).not('last_order_id', 'is', null).lte('current_period_end', new Date().toISOString()).order('current_period_end').limit(2)
  if (error) return subscriptionFailure(error)
  const results = []
  for (const subscription of due || []) {
    const { data: orderId, error } = await db.rpc('prepare_subscription_renewal', { p_subscription_id: subscription.id })
    if (error) { results.push({ subscriptionId: subscription.id, status: 'prepare_failed' }); continue }
    if (!orderId) continue
    const { data: order, error: readError } = await db.from('payment_orders').select('*').eq('id', orderId).single()
    if (readError) { results.push({ subscriptionId: subscription.id, status: 'read_failed' }); continue }
    const response = await chargeSubscription(db, order, secret, {}, subscription.billing_key)
    results.push({ subscriptionId: subscription.id, orderId, status: response.status })
  }
  return subscriptionJson({ expired, results })
}

export async function handleSubscriptionRoutes(path: string, method: string, request: Request, db: SupabaseClient, requiredUser: (request: Request) => Promise<any>, requireAdmin: (request: Request) => Promise<any>, secret: string) {
  const isAdmin = path.startsWith('/admin/subscriptions/')
  const actor = isAdmin ? (await requireAdmin(request)).user : await requiredUser(request)
  const userMatch = path.match(/^\/admin\/subscriptions\/users\/([^/]+)(?:\/(cancel|resume))?$/)
  if (isAdmin && userMatch && !validUuid(userMatch[1])) return subscriptionError('유효한 회원을 선택해주세요.')
  const userId = userMatch ? userMatch[1] : actor.id
  if (method === 'GET' && (path === '/payments/subscriptions/account' || userMatch)) {
    try { return subscriptionJson(await subscriptionAccount(db, userId)) } catch (error) { return subscriptionFailure(error) }
  }
  if (method === 'POST' && (path === '/payments/subscriptions/cancel' || path === '/payments/subscriptions/resume' || userMatch?.[2])) {
    const input = await subscriptionBody(request)
    const cancel = !path.endsWith('/resume')
    const reason = String(input.reason || (cancel ? '사용자 구독 해지 예약' : '자동갱신 해지 예약 철회')).trim().slice(0, 500)
    if (reason.length < 3) return subscriptionError('처리 사유를 3자 이상 입력해주세요.')
    const { data, error } = await db.rpc('change_subscription_renewal', { p_user_id: userId, p_actor_id: actor.id, p_cancel: cancel, p_reason: reason })
    return error ? subscriptionFailure(error) : subscriptionJson(data)
  }
  if (path === '/payments/subscriptions/orders' && method === 'POST') {
    const input = await subscriptionBody(request)
    if (!['manual', 'automatic'].includes(input.mode)) return subscriptionError('1개월 이용권 또는 자동갱신 구독을 선택해주세요.')
    const { data, error } = await db.rpc('create_subscription_purchase', { p_user_id: actor.id, p_mode: input.mode })
    return error ? subscriptionFailure(error) : subscriptionJson(data, 201)
  }
  if (method === 'POST' && ['/payments/subscriptions/confirm', '/payments/subscriptions/activate'].includes(path)) {
    const input = await subscriptionBody(request)
    const { data: order, error } = await db.from('payment_orders').select('*').eq('id', String(input.orderId || '')).eq('user_id', actor.id).maybeSingle()
    if (error) return subscriptionFailure(error)
    if (!order || order.product_type !== 'subscription') return subscriptionError('구독 주문을 찾을 수 없습니다.', 404)
    const manual = path.endsWith('/confirm')
    if (order.subscription_mode !== (manual ? 'manual' : 'automatic')) return subscriptionError('선택한 구독 결제 방식이 주문과 일치하지 않습니다.')
    if (manual && (typeof input.paymentKey !== 'string' || !input.paymentKey || !Number.isSafeInteger(input.amount) || input.amount !== order.amount)) return subscriptionError('구독 주문 금액 또는 승인 정보가 일치하지 않습니다.')
    return chargeSubscription(db, order, secret, input)
  }
  const refundMatch = path.match(/^\/(?:payments|admin)\/subscriptions\/orders\/([^/]+)\/refund$/)
  const reconcileMatch = path.match(/^\/payments\/subscriptions\/orders\/([^/]+)\/reconcile$/)
  if (reconcileMatch && method === 'POST') {
    const { data: order, error } = await db.from('payment_orders').select('*').eq('id', decodeURIComponent(reconcileMatch[1])).eq('user_id', actor.id).eq('product_type', 'subscription').maybeSingle()
    if (error) return subscriptionFailure(error)
    if (!order) return subscriptionError('구독 주문을 찾을 수 없습니다.', 404)
    return reconcileSubscription(db, order, secret)
  }
  if (refundMatch && method === 'POST') {
    const input = await subscriptionBody(request)
    let query = db.from('payment_orders').select('*').eq('id', decodeURIComponent(refundMatch[1])).eq('product_type', 'subscription')
    if (!isAdmin) query = query.eq('user_id', actor.id)
    const { data: order, error } = await query.maybeSingle()
    if (error) return subscriptionFailure(error)
    if (!order) return subscriptionError('구독 주문을 찾을 수 없습니다.', 404)
    if (!order.toss_payment_key) return subscriptionError('승인된 구독 결제만 환불할 수 있습니다.', 409)
    const reason = String(input.reason || '사용자 구독 결제 환불 요청').trim().slice(0, 100)
    if (reason.length < 3) return subscriptionError('환불 사유를 3자 이상 입력해주세요.')
    return refundSubscription(db, order, actor.id, reason, secret)
  }
  return subscriptionError('구독 API를 찾을 수 없습니다.', 404)
}
