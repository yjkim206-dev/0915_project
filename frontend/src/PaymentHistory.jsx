import { formatPaymentDate, formatMoney, formatPoints, statusNames } from './paymentApi.js'

export function PaymentStatusFilter({ value, onChange, disabled }) {
  return <label>결제 상태 <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    <option value="all">전체</option>{Object.entries(statusNames).map(([status, name]) => <option key={status} value={status}>{name}</option>)}
  </select></label>
}

export function PaymentHistory({ orders, busy, onRefund, onCancel, showUser = false }) {
  return <div className="payment-history-list">{orders.map((order) => <article className="payment-order-card" key={order.id}>
    <div className="payment-history-row">
      <div className="payment-history-main"><div><strong>{order.product_name || order.product_id}</strong><span className={`payment-status ${order.status}`}>{order.refund_pending ? '환불 처리 확인 중' : statusNames[order.status] || order.status}</span></div>
        {showUser && <small>{order.user?.name || '회원'} · {order.user?.email || order.user?.id}</small>}
        <small>{formatPaymentDate(order.paid_at || order.created_at)}</small>
      </div>
      <div className="payment-history-side"><strong>{formatMoney(order.amount)}</strong><div className="payment-history-actions">
        {order.receipt_url && <a className="payment-receipt-link" href={order.receipt_url} target="_blank" rel="noopener noreferrer">영수증 보기 ↗</a>}
        {order.cancel_receipt_url && order.status === 'refunded' && <a className="payment-receipt-link" href={order.cancel_receipt_url} target="_blank" rel="noopener noreferrer">취소 영수증 ↗</a>}
        {onRefund && order.product_type === 'credits' && order.status === 'paid' && <button type="button" className="payment-refund-button" disabled={Boolean(busy)} onClick={() => onRefund(order)}>{busy === order.id ? '처리 중…' : order.refund_pending ? '환불 처리 다시 확인' : '결제 취소·환불'}</button>}
        {onCancel && order.status === 'pending' && <button type="button" className="payment-refund-button" disabled={Boolean(busy)} onClick={() => onCancel(order)}>{busy === order.id ? '처리 중…' : '미결제 주문 취소'}</button>}
        {onRefund && order.product_type === 'subscription' && order.status === 'paid' && <Link className="payment-receipt-link" to="/inquiry">구독 환불 문의</Link>}
      </div></div>
    </div>
    <details className="payment-order-details"><summary>결제 상세정보</summary><dl>
      <div><dt>주문번호</dt><dd>{order.id}</dd></div><div><dt>상품 구분</dt><dd>{order.product_type === 'subscription' ? '월간 구독' : '크레딧 충전'}</dd></div>
      <div><dt>주문일</dt><dd>{formatPaymentDate(order.created_at)}</dd></div><div><dt>승인일</dt><dd>{formatPaymentDate(order.paid_at)}</dd></div>
      <div><dt>결제수단</dt><dd>{order.payment_method || '승인 정보 없음'}</dd></div>
      {order.product_type === 'credits' && <div><dt>충전 크레딧</dt><dd>{formatPoints(order.credits)}</dd></div>}
      {(order.canceled_at || order.cancel_reason) && <><div><dt>취소·환불일</dt><dd>{formatPaymentDate(order.canceled_at)}</dd></div><div><dt>취소·환불 사유</dt><dd>{order.cancel_reason || '-'}</dd></div></>}
      {order.status === 'refunded' && <div><dt>환불 금액</dt><dd>{formatMoney(order.refunded_amount)}</dd></div>}
      {order.failure_message && <><div><dt>실패일</dt><dd>{formatPaymentDate(order.failed_at)}</dd></div><div><dt>실패 사유</dt><dd>{order.failure_message}{order.failure_code ? ` (${order.failure_code})` : ''}</dd></div></>}
      <div><dt>영수증</dt><dd>{order.receipt_url ? '위 영수증 보기에서 확인할 수 있습니다.' : order.status === 'pending' || order.status === 'cancelled' || order.status === 'failed' ? '승인되지 않은 주문은 영수증이 발급되지 않습니다.' : '저장된 영수증 정보가 없습니다. 주문번호로 문의해주세요.'}</dd></div>
    </dl>{order.refund_pending && <p className="payment-cancel-event">환불 확인을 위해 해당 크레딧이 예약되어 잔액에서 제외되어 있습니다. 처리 확인이 끝나면 최종 내역에 반영됩니다.</p>}{order.cancellations?.map((item, index) => <p key={index} className="payment-cancel-event">{formatPaymentDate(item.canceled_at)} · {formatMoney(item.amount)} 취소 · {item.reason}</p>)}</details>
  </article>)}</div>
}

export function PaymentPagination({ page, total, limit, onChange, disabled }) {
  const pages = Math.max(1, Math.ceil(total / limit))
  return <nav className="payment-pagination" aria-label="내역 페이지 이동"><button type="button" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>이전</button><span>{page} / {pages} · 전체 {total.toLocaleString('ko-KR')}건</span><button type="button" disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>다음</button></nav>
}
import { Link } from 'react-router-dom'
