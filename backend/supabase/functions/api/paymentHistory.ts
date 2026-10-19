export const orderFields = 'id,user_id,product_id,product_name,product_type,amount,credits,status,created_at,paid_at,canceled_at,cancel_reason,failure_code,failure_message,failed_at,refund_reserved,toss_payment_data,toss_cancel_data'
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
