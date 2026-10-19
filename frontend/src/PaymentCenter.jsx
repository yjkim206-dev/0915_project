import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { paymentApi, formatPaymentDate, formatMoney, formatPoints, transactionNames } from './paymentApi.js'
import { PaymentHistory, PaymentPagination, PaymentStatusFilter } from './PaymentHistory.jsx'
import './toss-payments.css'
import SubscriptionPanel from './SubscriptionPanel.jsx'
import { subscriptionStatusName } from './subscriptionFormat.js'

export default function PaymentCenter({ embedded = false }) {
  const [data, setData] = useState(null)
  const [history, setHistory] = useState({ items: [], total: 0, limit: 10 })
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyOrder, setBusyOrder] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      paymentApi('/payments/account'),
      embedded ? Promise.resolve(null) : paymentApi(`/payments/orders?page=${page}&limit=10&status=${filter}`),
    ]).then(([account, orders]) => {
      if (!active) return
      setData(account); if (orders) setHistory(orders); setError('')
    }).catch((caught) => { if (active) setError(caught.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [embedded, page, filter, revision])

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const refresh = () => { setLoading(true); setRevision((value) => value + 1) }
  const changePage = (value) => { setPage(value); setLoading(true) }
  const cancelSubscription = async () => {
    if (!window.confirm('현재 이용 기간이 끝나는 날 구독이 종료되도록 예약할까요? 이미 결제된 금액의 환불과는 별개입니다.')) return
    try {
      setBusyOrder('subscription'); setNotice('')
      const result = await paymentApi('/payments/subscriptions/cancel', { method: 'POST', body: '{}' })
      setNotice(`${formatPaymentDate(result.current_period_end)}에 구독이 종료되도록 예약했습니다.`); refresh()
    } catch (caught) { setNotice(caught.message) } finally { setBusyOrder('') }
  }
  const refundOrder = async (order) => {
    const subscriptionOrder = order.product_type === 'subscription'
    if (!window.confirm(subscriptionOrder ? `${formatMoney(order.amount)} 구독 결제를 전액 환불할까요? 이용은 즉시 종료되고 자동갱신도 중단됩니다.` : `${formatMoney(order.amount)} 결제를 환불하고 ${formatPoints(order.credits)}를 회수할까요?`)) return
    try {
      setBusyOrder(order.id); setNotice('')
      const result = await paymentApi(`/payments/${subscriptionOrder ? 'subscriptions/' : ''}orders/${encodeURIComponent(order.id)}/refund`, { method: 'POST', body: JSON.stringify({ reason: '고객 요청 환불' }) })
      setNotice(result.alreadyProcessed ? '이미 취소·환불된 주문입니다.' : '환불 처리됐습니다. 결제내역과 크레딧 잔액을 확인해주세요.'); refresh()
    } catch (caught) { setNotice(caught.message) } finally { setBusyOrder('') }
  }
  const resumeSubscription = async () => {
    if (!window.confirm('해지 예약을 철회하고 다음 결제일부터 자동갱신을 다시 진행할까요?')) return
    try {
      setBusyOrder('subscription'); setNotice('')
      await paymentApi('/payments/subscriptions/resume', { method: 'POST', body: '{}' })
      setNotice('자동갱신 해지 예약을 철회했습니다.'); refresh()
    } catch (caught) { setNotice(caught.message) } finally { setBusyOrder('') }
  }
  const reconcileOrder = async (order) => {
    try {
      setBusyOrder(order.id); setNotice('')
      const result = await paymentApi(`/payments/subscriptions/orders/${encodeURIComponent(order.id)}/reconcile`, { method: 'POST', body: '{}' })
      setNotice(result.message || '구독 결제 상태를 확인했습니다. 최신 내역을 확인해주세요.'); refresh()
    } catch (caught) { setNotice(caught.message) } finally { setBusyOrder('') }
  }
  const cancelOrder = async (order) => {
    if (!window.confirm('아직 결제가 승인되지 않은 주문을 취소할까요? 진행 중인 결제창이 있다면 먼저 닫아주세요.')) return
    try {
      setBusyOrder(order.id); setNotice('')
      const result = await paymentApi(`/payments/orders/${encodeURIComponent(order.id)}/close`, { method: 'POST', body: JSON.stringify({ status: 'cancelled', message: '사용자가 미결제 주문 취소' }) })
      setNotice(result.status === 'cancelled' ? '미결제 주문을 취소했습니다.' : '주문 상태가 변경되어 취소하지 않았습니다. 최신 내역을 확인해주세요.'); refresh()
    } catch (caught) { setNotice(caught.message) } finally { setBusyOrder('') }
  }

  const subscription = data?.subscription
  const activeSubscription = subscription?.status === 'active' && new Date(subscription.current_period_end) > new Date()
  const rows = embedded ? data?.orders || [] : history.items
  const content = <>
    <div className="payment-history-heading"><div><p className="eyebrow">MY PAYMENTS</p>{embedded ? <h2>내 결제정보</h2> : <h1>구독 · 크레딧 · 결제내역</h1>}<p>구매, 취소·환불, 영수증과 크레딧 변동을 확인하세요.</p></div><button type="button" className="payment-refresh" onClick={refresh} disabled={loading || Boolean(busyOrder)}>새로고침</button></div>
    {notice && <div className="shop-notice" role="status">{notice}</div>}
    {error && <div className="shop-notice warning" role="alert">결제정보를 불러오지 못했습니다: {error} <button type="button" className="payment-refresh" onClick={refresh}>다시 시도</button></div>}
    {loading && <p className="payment-loading" role="status">결제정보를 불러오는 중…</p>}
    {data && <>
      <section className="payment-summary-grid" aria-label="결제 요약">
        <article className="payment-summary-card"><span>보유 크레딧</span><strong>{formatPoints(data.balance)}</strong><small>충전·관리자 지급·회수가 반영된 잔액</small></article>
        <article className="payment-summary-card"><span>구독 상태</span><strong>{subscriptionStatusName(subscription)}</strong><small>{activeSubscription ? `${subscription.billing_mode === 'automatic' ? '자동갱신 구독' : '1개월 이용권'} · 종료일 ${formatPaymentDate(subscription.current_period_end)}` : '상점에서 프리미엄을 구매할 수 있습니다.'}</small></article>
      </section>
      <SubscriptionPanel subscription={subscription} events={data.subscription_events} busy={Boolean(busyOrder)} onCancel={cancelSubscription} onResume={resumeSubscription} />
      <section className="payment-history-section" aria-busy={loading}>
        <div className="payment-history-heading"><h2>{embedded ? '최근 구매·취소·환불 내역' : '전체 결제내역'}</h2>{embedded ? <Link className="text-link" to="/profile/payments">전체 {data.order_count || 0}건 보기 →</Link> : <PaymentStatusFilter value={filter} disabled={loading} onChange={(value) => { setFilter(value); setPage(1); setLoading(true) }} />}</div>
        {!loading && !error && (rows.length ? <PaymentHistory orders={rows} busy={busyOrder} onRefund={refundOrder} onCancel={cancelOrder} onReconcile={reconcileOrder} subscriptionOrderId={subscription?.last_order_id || ''} /> : <p className="payment-empty">{filter === 'all' ? '아직 결제내역이 없습니다.' : '선택한 상태의 결제내역이 없습니다.'}</p>)}
        {!embedded && !error && <PaymentPagination page={page} total={history.total} limit={history.limit} disabled={loading} onChange={changePage} />}
      </section>
      <section className="payment-ledger"><h2>최근 크레딧 변동 내역</h2><p>구매 적립과 환불, 관리자 지급·회수를 최신 20건까지 표시합니다.</p>{data.transactions.length ? <ul>{data.transactions.map((item) => <li key={item.id}><div><strong>{transactionNames[item.kind] || '크레딧 변동'}</strong><span>{item.description}</span><small>{formatPaymentDate(item.created_at)}</small></div><div><strong className={Number(item.amount) > 0 ? 'credit-plus' : 'credit-minus'}>{Number(item.amount) > 0 ? '+' : ''}{formatPoints(item.amount)}</strong>{item.balance_after != null && <small>처리 후 {formatPoints(item.balance_after)}</small>}</div></li>)}</ul> : <p className="payment-empty">크레딧 변동 내역이 없습니다.</p>}</section>
    </>}
    <div className="payment-center-footer"><Link to="/shop" className="shop-button primary">상점에서 상품 보기</Link>{embedded && <Link to="/profile/payments" className="text-link">결제내역 자세히 보기 →</Link>}<p>미결제 주문 취소에는 환불이 발생하지 않습니다. 승인된 크레딧 구매의 환불은 결제 취소와 크레딧 회수를 함께 처리합니다.</p></div>
  </>
  return embedded ? <section className="profile-payments">{content}</section> : <div className="container narrow payment-center"><Link className="back" to="/profile">← 프로필로 돌아가기</Link>{content}</div>
}
