export async function tossRequest(path: string, secret: string, body?: Record<string, unknown>, idempotencyKey?: string) {
  const response = await fetch(`https://api.tosspayments.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Basic ${btoa(`${secret}:`)}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || 'Toss 결제 요청에 실패했습니다.')
    Object.assign(error, { status: response.status, code: payload.code })
    throw error
  }
  return payload
}
