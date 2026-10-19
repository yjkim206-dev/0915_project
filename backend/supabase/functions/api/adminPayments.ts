import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { orderFields, orderSummary, pagination, paymentStatuses, validUuid } from './paymentHistory.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} })
const fail = (message: string, status = 400) => json({ message }, status)

export async function handleAdminPaymentRoutes(path: string, method: string, request: Request, db: SupabaseClient, requireAdmin: (request: Request) => Promise<any>) {
  const { user: actor } = await requireAdmin(request)
  const { params, page, limit, offset } = pagination(request)
  const userId = params.get('userId') || ''
  if (userId && !validUuid(userId)) return fail('유효한 회원을 선택해주세요.')

  if (path === '/admin/payments' && method === 'GET') {
    const status = params.get('status') || 'all'
    if (status !== 'all' && !paymentStatuses.includes(status)) return fail('올바른 결제 상태를 선택해주세요.')
    let query = db.from('payment_orders').select(orderFields, { count: 'exact' })
    if (userId) query = query.eq('user_id', userId)
    if (status !== 'all') query = query.eq('status', status)
    const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
    if (error) return fail(error.message, 500)
    const ids = [...new Set((data || []).map((row) => row.user_id))]
    const profiles = ids.length ? await db.from('profiles').select('id,name,email').in('id', ids) : { data: [], error: null }
    if (profiles.error) return fail(profiles.error.message, 500)
    const byId = new Map((profiles.data || []).map((row) => [row.id, row]))
    return json({ items: (data || []).map((row) => ({ ...orderSummary(row), user: byId.get(row.user_id) || { id: row.user_id, name: '회원', email: '' } })), total: count || 0, page, limit })
  }

  if (path === '/admin/credits/users' && method === 'GET') {
    let query = db.from('profiles').select('id,name,email,role', { count: 'exact' })
    if (userId) query = query.eq('id', userId)
    const search = (params.get('search') || '').trim().slice(0, 100)
    if (search) {
      // Strip PostgREST filter operators, preserving ordinary Korean/email text.
      const term = search.replace(/[%_(),*"\\]/g, '')
      if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%`)
    }
    const { data, count, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
    if (error) return fail(error.message, 500)
    const ids = (data || []).map((row) => row.id)
    const wallets = ids.length ? await db.from('credit_wallets').select('user_id,balance').in('user_id', ids) : { data: [], error: null }
    if (wallets.error) return fail(wallets.error.message, 500)
    const balances = new Map((wallets.data || []).map((row) => [row.user_id, row.balance]))
    return json({ items: (data || []).map((row) => ({ ...row, balance: balances.get(row.id) || 0 })), total: count || 0, page, limit })
  }

  if (path === '/admin/credits/transactions' && method === 'GET') {
    let query = db.from('credit_transactions').select('id,user_id,amount,description,kind,actor_id,balance_before,balance_after,request_id,created_at,order_id', { count: 'exact' })
    if (userId) query = query.eq('user_id', userId)
    const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
    if (error) return fail(error.message, 500)
    const ids = [...new Set((data || []).flatMap((row) => [row.user_id, row.actor_id]).filter(Boolean))]
    const profiles = ids.length ? await db.from('profiles').select('id,name,email').in('id', ids) : { data: [], error: null }
    if (profiles.error) return fail(profiles.error.message, 500)
    const byId = new Map((profiles.data || []).map((row) => [row.id, row]))
    return json({ items: (data || []).map((row) => ({ ...row, user: byId.get(row.user_id), actor: byId.get(row.actor_id) || null })), total: count || 0, page, limit })
  }

  const adjustMatch = path.match(/^\/admin\/credits\/users\/([^/]+)\/adjust$/)
  if (adjustMatch && method === 'POST') {
    const targetId = adjustMatch[1]
    let input: Record<string, unknown>
    try { input = await request.json() } catch { return fail('올바른 요청 정보를 입력해주세요.') }
    const amount = input.amount
    const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
    const requestId = String(input.requestId || '')
    if (!validUuid(targetId) || !validUuid(requestId)) return fail('회원 또는 요청 번호가 올바르지 않습니다.')
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 10000000) return fail('지급·회수량은 1~10,000,000P의 정수여야 합니다.')
    if (reason.length < 3 || reason.length > 500) return fail('처리 사유를 3~500자로 입력해주세요.')
    const { data, error } = await db.rpc('admin_adjust_credits', { p_actor_id: actor.id, p_user_id: targetId, p_amount: amount, p_reason: reason, p_request_id: requestId })
    if (error) {
      const message = error.message || ''
      if (message.includes('INSUFFICIENT_CREDIT_BALANCE')) return fail('보유 잔액보다 많은 크레딧을 회수할 수 없습니다.', 409)
      if (message.includes('REQUEST_ID_CONFLICT')) return fail('이미 다른 내용으로 처리된 요청입니다. 화면을 새로고침해주세요.', 409)
      if (message.includes('ADMIN_REQUIRED')) return fail('관리자 권한이 필요합니다.', 403)
      if (message.includes('USER_NOT_FOUND')) return fail('회원을 찾을 수 없습니다.', 404)
      return fail('크레딧 처리에 실패했습니다. 잠시 후 같은 요청으로 다시 시도해주세요.', 500)
    }
    return json(data)
  }
  return fail('요청한 결제 관리 API를 찾을 수 없습니다.', 404)
}
