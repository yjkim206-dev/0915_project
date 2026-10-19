import { useEffect, useRef, useState } from 'react'
import { paymentApi, formatPoints, formatPaymentDate, transactionNames } from './paymentApi.js'
import { PaymentHistory, PaymentPagination, PaymentStatusFilter } from './PaymentHistory.jsx'
import './toss-payments.css'
import './admin-payments.css'
import SubscriptionPanel from './SubscriptionPanel.jsx'

const adminApi = (path, options = {}) => paymentApi(path, { ...options, admin: true })

export default function AdminPayments({ initialUserId = '' }) {
  const [userId, setUserId] = useState(initialUserId)
  const [selectedUser, setSelectedUser] = useState(null)
  const [subscriptionInfo, setSubscriptionInfo] = useState(null)
  const [search, setSearch] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [users, setUsers] = useState({ items: [], total: 0, limit: 10 })
  const [userPage, setUserPage] = useState(1)
  const [orders, setOrders] = useState({ items: [], total: 0, limit: 10 })
  const [ledger, setLedger] = useState({ items: [], total: 0, limit: 10 })
  const [page, setPage] = useState(1)
  const [ledgerPage, setLedgerPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(true)
  const [error, setError] = useState('')
  const [userError, setUserError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [direction, setDirection] = useState('grant')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const pendingRequest = useRef(null)

  useEffect(() => {
    let active = true
    adminApi(`/admin/credits/users?search=${encodeURIComponent(searchTerm)}&page=${userPage}&limit=10`)
      .then((data) => { if (active) { setUsers(data); setUserError('') } })
      .catch((caught) => { if (active) setUserError(caught.message) })
      .finally(() => { if (active) setUsersLoading(false) })
    return () => { active = false }
  }, [searchTerm, userPage, revision])

  useEffect(() => {
    let active = true
    const query = userId ? `&userId=${encodeURIComponent(userId)}` : ''
    Promise.all([
      adminApi(`/admin/payments?page=${page}&limit=10&status=${status}${query}`),
      adminApi(`/admin/credits/transactions?page=${ledgerPage}&limit=10${query}`),
      userId ? adminApi(`/admin/credits/users?userId=${encodeURIComponent(userId)}`) : Promise.resolve(null),
      userId ? adminApi(`/admin/subscriptions/users/${encodeURIComponent(userId)}`) : Promise.resolve(null),
    ]).then(([payments, transactions, account, subscriptions]) => {
      if (!active) return
      setOrders(payments); setLedger(transactions); setSelectedUser(account?.items[0] || null); setSubscriptionInfo(subscriptions); setError('')
    }).catch((caught) => { if (active) setError(caught.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [userId, page, ledgerPage, status, revision])

  const selectUser = (id) => { setUserId(id); setSelectedUser(null); setPage(1); setLedgerPage(1); setLoading(true); setNotice(''); setRevision((value) => value + 1) }
  const refresh = () => { setLoading(true); setUsersLoading(true); setRevision((value) => value + 1) }
  const adjustCredits = async (event) => {
    event.preventDefault()
    if (busy || !selectedUser || selectedUser.id !== userId) return
    const points = Number(amount)
    if (!Number.isSafeInteger(points) || points < 1 || points > 10000000) return setNotice('1~10,000,000P의 정수를 입력해주세요.')
    if (reason.trim().length < 3) return setNotice('처리 사유를 3자 이상 입력해주세요.')
    if (direction === 'revoke' && points > Number(selectedUser.balance)) return setNotice('보유 잔액보다 많은 크레딧은 회수할 수 없습니다.')
    if (!window.confirm(`${selectedUser.name} (${selectedUser.email}) 회원에게 ${formatPoints(points)}를 ${direction === 'grant' ? '지급' : '회수'}할까요?\n사유: ${reason.trim()}`)) return
    const payload = { amount: direction === 'grant' ? points : -points, reason: reason.trim() }
    const signature = JSON.stringify({ userId, ...payload })
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, id: crypto.randomUUID() }
    setBusy(true); setNotice('')
    try {
      const result = await adminApi(`/admin/credits/users/${userId}/adjust`, { method: 'POST', body: JSON.stringify({ ...payload, requestId: pendingRequest.current.id }) })
      pendingRequest.current = null
      setNotice(`${result.alreadyProcessed ? '이미 처리된 요청입니다.' : '크레딧 처리가 완료됐습니다.'} 처리 후 잔액: ${formatPoints(result.balance)}`)
      setAmount(''); setReason(''); refresh()
    } catch (caught) { setNotice(caught.message) } finally { setBusy(false) }
  }
  const changeSubscription = async (action) => {
    if (!selectedUser || busy) return
    const reason = window.prompt(action === 'cancel' ? '자동갱신 해지 예약 사유를 입력해주세요.' : '해지 예약 철회 사유를 입력해주세요.')
    if (reason === null) return
    if (reason.trim().length < 3) return setNotice('처리 사유를 3자 이상 입력해주세요.')
    try {
      setBusy(true); setNotice('')
      await adminApi(`/admin/subscriptions/users/${userId}/${action}`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) })
      setNotice('구독 상태를 변경했습니다. 처리 이력에서 확인해주세요.'); refresh()
    } catch (caught) { setNotice(caught.message) } finally { setBusy(false) }
  }
  const refundSubscription = async (order) => {
    if (busy || order.product_type !== 'subscription') return
    const reason = window.prompt(`${order.user?.name || '회원'}의 ${Number(order.amount).toLocaleString('ko-KR')}원 구독 결제를 전액 환불하고 이용을 종료합니다. 처리 사유를 입력해주세요.`)
    if (reason === null) return
    if (reason.trim().length < 3) return setNotice('환불 사유를 3자 이상 입력해주세요.')
    try {
      setBusy(true); setNotice('')
      await adminApi(`/admin/subscriptions/orders/${encodeURIComponent(order.id)}/refund`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) })
      setNotice('구독 결제를 환불하고 이용을 종료했습니다.'); refresh()
    } catch (caught) { setNotice(caught.message) } finally { setBusy(false) }
  }

  return <section className="admin-payments">
    <div className="payment-history-heading"><div><p className="admin-kicker">PAYMENTS & CREDITS</p><h2>결제·크레딧 관리</h2><p>구매·취소·환불·영수증과 회원별 크레딧을 관리합니다.</p></div><button type="button" className="admin-action" disabled={loading || busy} onClick={refresh}>새로고침</button></div>
    {notice && <p className="shop-notice" role="status">{notice}</p>}
    {error && <p className="admin-payment-error" role="alert">결제정보 조회 실패: {error}</p>}
    <section className="dashboard-panel admin-credit-users"><h2>회원 찾기 및 크레딧 잔액</h2>
      <form className="admin-payment-search" onSubmit={(event) => { event.preventDefault(); setSearchTerm(search.trim()); setUserPage(1); setUsersLoading(true); setRevision((value) => value + 1) }}><label>이름·이메일<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder="회원 이름 또는 이메일" /></label><button className="admin-action" disabled={usersLoading}>검색</button><button type="button" className="admin-action" onClick={() => selectUser('')}>전체 회원 결제 보기</button></form>
      {userError && <p className="admin-payment-error" role="alert">{userError}</p>}
      {usersLoading ? <p role="status">회원 목록을 불러오는 중…</p> : !userError && <><div className="admin-credit-user-list">{users.items.map((user) => <button type="button" key={user.id} className={`admin-credit-user${userId === user.id ? ' selected' : ''}`} onClick={() => selectUser(user.id)}><span><strong>{user.name || '회원'}</strong><small>{user.email}</small></span><strong>{formatPoints(user.balance)}</strong></button>)}{!users.items.length && <p>일치하는 회원이 없습니다.</p>}</div><PaymentPagination page={userPage} total={users.total} limit={users.limit} disabled={usersLoading} onChange={(value) => { setUserPage(value); setUsersLoading(true) }} /></>}
    </section>
    {userId && !loading && !error && subscriptionInfo && <SubscriptionPanel subscription={subscriptionInfo.subscription} events={subscriptionInfo.events} admin busy={busy} onCancel={() => changeSubscription('cancel')} onResume={() => changeSubscription('resume')} />}
    <section className="dashboard-panel admin-credit-adjust"><h2>회원별 크레딧 지급·회수</h2>
      {!userId ? <p>위 목록에서 회원을 선택하면 잔액을 확인하고 지급·회수할 수 있습니다.</p> : loading ? <p role="status">선택한 회원 정보를 불러오는 중…</p> : selectedUser?.id === userId && !error ? <>
        <div className="admin-credit-selected"><div><strong>{selectedUser.name}</strong><p>{selectedUser.email}</p><small>회원번호 {selectedUser.id}</small></div><strong>보유 {formatPoints(selectedUser.balance)}</strong></div>
        <form onSubmit={adjustCredits}><fieldset disabled={busy || loading}><div className="admin-credit-fields"><label>처리 구분<select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="grant">크레딧 지급 (+)</option><option value="revoke">크레딧 회수 (-)</option></select></label><label>크레딧 (P)<input type="number" min="1" max="10000000" step="1" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label></div><label>처리 사유<textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="이벤트 지급, 운영 보상, 잘못 지급된 크레딧 회수 등" /></label><p>회수 후 잔액은 0P 미만이 될 수 없습니다. 처리 관리자·사유·변경 전후 잔액이 기록됩니다.</p><button className={`admin-button${direction === 'revoke' ? ' credit-revoke' : ''}`}>{busy ? '처리 중…' : direction === 'grant' ? '크레딧 지급' : '크레딧 회수'}</button></fieldset></form>
      </> : <p>선택한 회원 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해주세요.</p>}
    </section>
    <section className="dashboard-panel"><div className="payment-history-heading"><h2>{userId ? '선택 회원 결제내역' : '전체 회원 결제내역'}</h2><PaymentStatusFilter value={status} disabled={loading} onChange={(value) => { setStatus(value); setPage(1); setLoading(true) }} /></div>
      {loading ? <p role="status">결제내역을 불러오는 중…</p> : !error && (orders.items.length ? <PaymentHistory orders={orders.items} showUser busy={busy ? 'admin-action' : ''} onRefund={(order) => { if (order.product_type === 'subscription') return refundSubscription(order) }} subscriptionOnlyRefund /> : <p className="payment-empty">해당 결제내역이 없습니다.</p>)}
      {!error && <PaymentPagination page={page} total={orders.total} limit={orders.limit} disabled={loading} onChange={(value) => { setPage(value); setLoading(true) }} />}
    </section>
    <section className="dashboard-panel"><h2>{userId ? '선택 회원' : '전체 회원'} 크레딧 처리 기록</h2><p>구매 적립·환불·관리자 지급·회수 내역입니다.</p>
      {loading ? <p role="status">처리 기록을 불러오는 중…</p> : !error && <div className="admin-credit-ledger">{ledger.items.map((item) => <article key={item.id}><div><strong>{transactionNames[item.kind] || '크레딧 변동'} · {item.user?.name || '회원'}</strong><p>{item.user?.email}</p><p>{item.description}</p><small>{formatPaymentDate(item.created_at)} · 처리자: {item.actor?.name || (item.actor_id ? '삭제된 관리자' : '결제 시스템')}</small><small>주문번호: {item.order_id || '-'} · 처리번호: {item.id}</small></div><div><strong className={item.amount > 0 ? 'credit-plus' : 'credit-minus'}>{item.amount > 0 ? '+' : ''}{formatPoints(item.amount)}</strong>{item.balance_before != null && <small>{formatPoints(item.balance_before)} → {formatPoints(item.balance_after)}</small>}</div></article>)}{!ledger.items.length && <p className="payment-empty">크레딧 처리 기록이 없습니다.</p>}</div>}
      {!error && <PaymentPagination page={ledgerPage} total={ledger.total} limit={ledger.limit} disabled={loading} onChange={(value) => { setLedgerPage(value); setLoading(true) }} />}
    </section>
  </section>
}
