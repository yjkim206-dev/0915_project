export const orderFields = 'id,user_id,product_id,product_name,product_type,amount,credits,status,created_at,paid_at,canceled_at,cancel_reason,failure_code,failure_message,failed_at,refund_reserved,subscription_mode,subscription_id,subscription_period_start,subscription_period_end,toss_payment_data,toss_cancel_data'
export const subscriptionFields = 'id,user_id,product_id,status,billing_mode,current_period_start,current_period_end,cancel_at_period_end,last_order_id,last_error,canceled_at,updated_at'
export function subscriptionSummary(row: Record<string, any> | null) {
  if (!row) return null
  const isActive = row.status === 'active' && new Date(row.current_period_end).getTime() > Date.now()
  const safe = Object.fromEntries(subscriptionFields.split(',').map((key) => [key, row[key]]))
  return { ...safe, status: row.status === 'active' && !isActive ? (row.billing_mode === 'manual' || row.cancel_at_period_end ? 'expired' : 'renewal_due') : row.status,
    is_active: isActive, auto_renew: row.billing_mode === 'automatic' && !row.cancel_at_period_end && row.status === 'active' }
}
export const paymentStatuses = ['pending', 'paid', 'failed', 'cancelled', 'refunded']
export const validUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

function receiptUrl(value: unknown) {
  if (typeof value !== 'string') return null
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null } catch { return null }
}

// Return an allowlist: provider payloads may contain payment/billing secrets.
export function orderSummary(order: Record<string, any>) {
  const payment = order.toss_payment_data || {}
  const cancellation = order.toss_cancel_data || {}
  const cancels = Array.isArray(cancellation.cancels) ? cancellation.cancels : []
  return {
    id: order.id, product_id: order.product_id, product_name: order.product_name || payment.orderName || order.product_id,
    product_type: order.product_type, amount: order.amount, credits: order.credits, status: order.status,
    created_at: order.created_at, paid_at: order.paid_at, canceled_at: order.canceled_at, cancel_reason: order.cancel_reason,
    failure_code: order.failure_code, failure_message: order.failure_message, failed_at: order.failed_at,
    refund_pending: Boolean(order.refund_reserved),
    subscription_mode: order.subscription_mode, subscription_id: order.subscription_id,
    subscription_period_start: order.subscription_period_start, subscription_period_end: order.subscription_period_end,
    payment_method: payment.method || null,
    receipt_url: receiptUrl(payment.receipt?.url),
    cancel_receipt_url: receiptUrl(cancellation.receipt?.url),
    refunded_amount: order.status === 'refunded' ? (cancels.length ? cancels.reduce((sum: number, row: any) => sum + (Number(row.cancelAmount) || 0), 0) : order.amount) : 0,
    cancellations: cancels.map((row: any) => ({ amount: row.cancelAmount, reason: row.cancelReason, canceled_at: row.canceledAt })),
  }
}

export function pagination(request: Request) {
  const params = new URL(request.url).searchParams
  const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1))
  const limit = Math.max(1, Math.min(50, Number(params.get('limit')) || 10))
  return { params, page: Math.floor(page), limit: Math.floor(limit), offset: (Math.floor(page) - 1) * Math.floor(limit) }
}
