import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authStorage } from './authStorage.js'
import './toss-payments.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${authStorage.getItem('token') || ''}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || '결제 정보를 불러오지 못했습니다.')
  return data
}

const formatDate = (value) => value ? new Date(value).toLocaleString('ko-KR') : '-'
const formatMoney = (value) => `${Number(value).toLocaleString('ko-KR')}원`
const statusNames = { pending: '결제 대기', paid: '승인 완료', failed: '실패', cancelled: '취소', refunded: '환불 완료' }

export default function PaymentCenter() {
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('all')
  const [busyOrder, setBusyOrder] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => setData(await request('/payments/account')), [])
  useEffect(() => { refresh().catch((error) => setNotice(error.message)) }, [refresh])

  const cancelSubscription = async () => {
    if (!window.confirm('현재 결제 기간이 끝나는 날 구독을 해지할까요?')) return
    try {
      setNotice(''); setBusyOrder('subscription')
      const result = await request('/payments/subscriptions/cancel', { method: 'POST', body: '{}' })
      setNotice(`${formatDate(result.current_period_end)}에 구독이 종료되도록 예약했습니다.`)
      await refresh()
    } catch (error) { setNotice(error.message) } finally { setBusyOrder('') }
  }

  const refundOrder = async (order) => {
    if (!window.confirm(`${formatMoney(order.amount)} 결제를 취소하고 ${Number(order.credits).toLocaleString('ko-KR')}P를 회수할까요? 포인트를 이미 사용해 잔액이 부족하면 환불이 거절됩니다.`)) return
    try {
      setNotice(''); setBusyOrder(order.id)
      const result = await request(`/payments/orders/${encodeURIComponent(order.id)}/refund`, { method: 'POST', body: JSON.stringify({ reason: '고객 요청 환불' }) })
      setNotice(result.alreadyProcessed ? '이미 취소된 주문입니다.' : `결제가 취소되고 ${Number(result.refundedCredits).toLocaleString('ko-KR')}P가 회수됐습니다.`)
      await refresh()
    } catch (error) { setNotice(error.message) } finally { setBusyOrder('') }
  }

  if (!data && !notice) return <div className="container narrow"><p className="empty">결제 정보를 불러오는 중...</p></div>
  const rows = (data?.orders || []).filter((order) => filter === 'all' || order.status === filter)
  const subscription = data?.subscription

  return <div className="container narrow payment-center">
    <Link className="back" to="/profile">← 프로필로 돌아가기</Link>
    <div className="title"><p className="eyebrow">MY ACCOUNT</p><h1>구독 · 크레딧 · 결제내역</h1><p>보유 포인트, 구독 상태, 승인 및 환불 내역을 확인하세요.</p></div>
    {notice && <div className="shop-notice" role="status">{notice}</div>}
    {data && <>
      <section className="payment-summary-grid">
        <article className="payment-summary-card"><span>보유 크레딧</span><strong>{Number(data.balance).toLocaleString('ko-KR')}P</strong><small>포인트 결제 내역과 함께 표시됩니다.</small></article>
        <article className="payment-summary-card"><span>구독 상태</span><strong>{subscription?.status === 'active' ? (subscription.cancel_at_period_end ? '해지 예약' : '이용 중') : '구독 없음'}</strong><small>{subscription?.status === 'active' ? `다음 결제일 ${new Date(subscription.current_period_end).toLocaleDateString('ko-KR')}` : '상점에서 프리미엄을 구독할 수 있습니다.'}</small></article>
      </section>
      {subscription?.status === 'active' && !subscription.cancel_at_period_end && <div className="payment-action-row"><span>구독은 현재 이용 기간까지 유지됩니다.</span><button type="button" className="shop-button secondary" disabled={Boolean(busyOrder)} onClick={cancelSubscription}>{busyOrder === 'subscription' ? '처리 중…' : '구독 해지 예약'}</button></div>}
      {subscription?.cancel_at_period_end && <div className="shop-notice warning">구독 해지가 예약되어 있습니다. 현재 기간 종료일은 {formatDate(subscription.current_period_end)}입니다.</div>}
      <section className="payment-history-section"><div className="payment-history-heading"><div><p className="eyebrow">PAYMENT HISTORY</p><h2>결제내역</h2></div><label>상태 <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">전체</option><option value="pending">대기</option><option value="paid">승인 완료</option><option value="failed">실패</option><option value="refunded">환불</option><option value="cancelled">취소</option></select></label></div>
        {rows.length ? <div className="payment-history-list">{rows.map((order) => <article className="payment-history-row" key={order.id}><div className="payment-history-main"><div><strong>{order.product_type === 'subscription' ? 'MOA Premium 월간 구독' : order.product_id === 'credits_1000' ? '포인트 1,000P 충전' : '포인트 5,500P 충전'}</strong><span className={`payment-status ${order.status}`}>{statusNames[order.status] || order.status}</span></div><small>{formatDate(order.paid_at || order.created_at)} · 주문번호 {order.id}</small></div><div className="payment-history-side"><strong>{formatMoney(order.amount)}</strong><div className="payment-history-actions">{order.receipt_url && <a className="payment-receipt-link" href={order.receipt_url} target="_blank" rel="noreferrer">영수증 보기</a>}{order.product_type === 'credits' && order.status === 'paid' && <button type="button" className="payment-refund-button" disabled={Boolean(busyOrder)} onClick={() => refundOrder(order)}>{busyOrder === order.id ? '처리 중…' : '결제 취소·환불'}</button>}</div></div></article>)}</div> : <p className="payment-empty">선택한 상태의 결제 내역이 없습니다.</p>}
      </section>
    </>}
    <div className="payment-center-footer"><Link to="/shop" className="shop-button primary">상점에서 상품 보기</Link><p>환불은 Toss 결제 취소를 완료한 뒤 잔여 크레딧을 회수합니다. 이미 사용한 크레딧 때문에 잔액이 부족하면 자동 환불이 제한됩니다.</p></div>
  </div>
}
