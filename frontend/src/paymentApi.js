import { apiFetch } from './api.js'
import { authStorage } from './authStorage.js'

export function paymentApi(path, { admin = false, ...options } = {}) {
  return apiFetch(path, { ...options, headers: {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${authStorage.getItem(admin ? 'adminToken' : 'token') || ''}`,
    ...options.headers,
  } })
}

export const formatPaymentDate = (value) => value ? new Date(value).toLocaleString('ko-KR') : '-'
export const formatMoney = (value) => `${Number(value || 0).toLocaleString('ko-KR')}원`
export const formatPoints = (value) => `${Number(value || 0).toLocaleString('ko-KR')}P`
export const statusNames = { pending: '결제 대기', paid: '구매 완료', failed: '결제 실패', cancelled: '구매 취소', refunded: '환불 완료' }
export const transactionNames = { purchase: '구매 적립', refund: '환불 회수', admin_grant: '관리자 지급', admin_revoke: '관리자 회수' }
