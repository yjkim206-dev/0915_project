import { Link } from 'react-router-dom'
import { formatPaymentDate } from './paymentApi.js'
import { subscriptionStatusName } from './subscriptionFormat.js'

export default function SubscriptionPanel({ subscription, events = [], busy, onCancel, onResume, admin = false }) {
  const active = subscription?.is_active
  const automatic = subscription?.billing_mode === 'automatic'
  return <section className="subscription-panel" aria-label="구독 관리">
    <div className="payment-history-heading"><div><p className="eyebrow">MY SUBSCRIPTION</p><h2>{admin ? '선택 회원 구독정보' : '내 구독 관리'}</h2></div><span className={`payment-status ${active ? 'paid' : ''}`}>{subscriptionStatusName(subscription)}</span></div>
    {subscription ? <>
      <dl className="subscription-facts"><div><dt>상품</dt><dd>MOA Premium</dd></div><div><dt>결제 방식</dt><dd>{automatic ? '월간 자동갱신 구독' : '1개월 이용권 · 자동갱신 없음'}</dd></div>
        <div><dt>이용 시작일</dt><dd>{formatPaymentDate(subscription.current_period_start)}</dd></div><div><dt>이용 종료일</dt><dd>{formatPaymentDate(subscription.current_period_end)}</dd></div>
        <div><dt>자동갱신</dt><dd>{subscription.auto_renew ? `설정됨 · 다음 결제 예정 ${formatPaymentDate(subscription.current_period_end)}` : '자동 청구되지 않음'}</dd></div>
      </dl>
      {subscription.last_error && <p className="shop-notice warning" role="status">최근 결제 실패: {subscription.last_error} {admin ? '회원에게 결제수단 재등록을 안내해주세요.' : '상점에서 결제수단을 다시 등록하거나 1개월 이용권을 구매해주세요.'}</p>}
      {active && automatic && <div className="subscription-actions">{!subscription.cancel_at_period_end ? <button type="button" className="shop-button secondary" disabled={busy} onClick={onCancel}>자동갱신 해지 예약</button> : <button type="button" className="shop-button secondary" disabled={busy} onClick={onResume}>해지 예약 철회</button>}<p>{subscription.cancel_at_period_end ? '현재 이용기간이 끝나면 종료되며 다음 결제는 진행하지 않습니다.' : '해지 예약 후에도 결제된 기간까지 이용할 수 있습니다.'}</p></div>}
      {active && !automatic && <p className="subscription-guide">이용 종료일에 자동으로 종료됩니다. 다음 달 결제를 원하면 기간 종료 후 상점에서 다시 구매해주세요.</p>}
      {!active && !admin && <Link className="text-link" to="/shop">상점에서 이용권·구독 선택 →</Link>}
      <p className="subscription-guide">구독 결제 환불은 아래 결제내역에서 신청할 수 있습니다. 현재 구독의 최근 결제를 전액 환불하면 이용이 즉시 종료됩니다.</p>
    </> : <p className="payment-empty">{admin ? '이 회원은 구독 이력이 없습니다.' : '구독 이력이 없습니다. 상점에서 1개월 이용권 또는 자동갱신 구독을 선택할 수 있습니다.'}</p>}
    {events.length > 0 && <details className="subscription-events"><summary>구독 처리 이력 (최근 20건)</summary><ul>{events.map((event) => <li key={event.id}><strong>{event.description}</strong><small>{formatPaymentDate(event.created_at)}{event.order_id ? ` · ${event.order_id}` : ''}</small></li>)}</ul></details>}
  </section>
}
