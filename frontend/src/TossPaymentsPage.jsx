import { useCallback, useEffect, useState } from 'react'
import { authStorage } from './authStorage.js'
import { paymentApi as api } from './paymentApi.js'
import { SITE_URL } from './deploymentConfig.js'
import { Link } from 'react-router-dom'
import { subscriptionStatusName } from './subscriptionFormat.js'
import './toss-payments.css'

const clientKey = import.meta.env.VITE_TOSS_CLIENT_KEY

function loadTossSdk() {
  if (window.TossPayments) return Promise.resolve(window.TossPayments)
  if (window.__moaTossSdk) return window.__moaTossSdk
  window.__moaTossSdk = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://js.tosspayments.com/v2/standard'
    script.onload = () => window.TossPayments ? resolve(window.TossPayments) : reject(new Error('토스페이먼츠 SDK를 불러오지 못했습니다.'))
    script.onerror = () => reject(new Error('토스페이먼츠 SDK 연결에 실패했습니다.'))
    document.head.appendChild(script)
  })
  return window.__moaTossSdk
}

function money(value) {
  return `${Number(value).toLocaleString('ko-KR')}원`
}

async function recordCheckoutClosure(orderId, error) {
  if (!orderId) return
  const code = String(error.code || '')
  const status = ['PAY_PROCESS_CANCELED', 'USER_CANCEL'].includes(code) ? 'cancelled' : 'failed'
  return api(`/payments/orders/${encodeURIComponent(orderId)}/close`, { method: 'POST', body: JSON.stringify({ status, code, message: error.message || '결제창이 종료되었습니다.' }) })
}

export default function TossPaymentsPage() {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [products, setProducts] = useState([])
  const [account, setAccount] = useState(null)
  const [subscriptionMode, setSubscriptionMode] = useState('manual')

  const refreshAccount = useCallback(async () => {
    if (!authStorage.getItem('token')) { setAccount(null); return }
    try { setAccount(await api('/payments/account')) } catch { setAccount(null) }
  }, [])

  useEffect(() => {
    let active = true
    api('/shop/products').then((items) => { if (active) setProducts(items) }).catch((error) => { if (active) setNotice(`상품 정보를 불러오지 못했습니다: ${error.message}`) })
    refreshAccount()
    const processRedirect = async () => {
      const path = window.location.pathname
      const params = new URLSearchParams(window.location.search)
      try {
        if (path === '/shop/credits/success') {
          const result = await api('/payments/confirm', { method: 'POST', body: JSON.stringify({ paymentKey: params.get('paymentKey'), orderId: params.get('orderId'), amount: Number(params.get('amount')) }) })
          if (!active) return
          setNotice(`${Number(result.credits).toLocaleString('ko-KR')}P 적립 완료 · 현재 잔액 ${Number(result.balance).toLocaleString('ko-KR')}P`)
          sessionStorage.removeItem('moa-credit-order-id')
          await refreshAccount()
          window.history.replaceState({}, document.title, '/shop')
        } else if (path === '/shop/subscription/success') {
          const orderId = params.get('orderId') || params.get('checkoutOrderId') || sessionStorage.getItem('moa-billing-order-id')
          const authKey = params.get('authKey')
          const paymentKey = params.get('paymentKey')
          if (!orderId || (!authKey && !paymentKey)) throw new Error('구독 주문 또는 결제 인증 정보를 찾지 못했습니다. 상점에서 다시 시도해 주세요.')
          const result = paymentKey
            ? await api('/payments/subscriptions/confirm', { method: 'POST', body: JSON.stringify({ orderId, paymentKey, amount: Number(params.get('amount')) }) })
            : await api('/payments/subscriptions/activate', { method: 'POST', body: JSON.stringify({ orderId, authKey }) })
          sessionStorage.removeItem('moa-billing-order-id')
          if (!active) return
          setNotice(`구독 결제가 완료됐습니다. 이용 종료일: ${new Date(result.currentPeriodEnd).toLocaleDateString('ko-KR')} · 프로필에서 구독과 결제내역을 확인하세요.`)
          await refreshAccount()
          window.history.replaceState({}, document.title, '/shop')
        } else if (path === '/shop/fail') {
          const orderId = params.get('checkoutOrderId') || params.get('orderId') || sessionStorage.getItem(params.get('flow') === 'subscription' ? 'moa-billing-order-id' : 'moa-credit-order-id')
          await recordCheckoutClosure(orderId, { code: params.get('code'), message: params.get('message') })
          sessionStorage.removeItem('moa-billing-order-id')
          sessionStorage.removeItem('moa-credit-order-id')
          await refreshAccount()
          if (active) setNotice(params.get('message') || '결제가 취소되었거나 실패했습니다.')
          window.history.replaceState({}, document.title, '/shop')
        }
      } catch (error) {
        if (active) setNotice(error.message)
        window.history.replaceState({}, document.title, '/shop')
      }
    }
    processRedirect()
    return () => { active = false }
  }, [refreshAccount])

  const ready = async () => {
    if (!authStorage.getItem('token')) throw new Error('결제를 진행하려면 먼저 로그인해 주세요.')
    if (!clientKey) throw new Error('Vercel 환경변수에 VITE_TOSS_CLIENT_KEY를 설정해 주세요.')
    if (!clientKey.startsWith('test_ck_')) throw new Error('현재 상점은 테스트 키(test_ck_)로만 결제를 진행할 수 있습니다.')
    return loadTossSdk()
  }

  const subscribe = async () => {
    let orderId
    try {
      setBusy(true); setNotice('')
      const TossPayments = await ready()
      const order = await api('/payments/subscriptions/orders', { method: 'POST', body: JSON.stringify({ mode: subscriptionMode }) })
      orderId = order.orderId
      sessionStorage.setItem('moa-billing-order-id', order.orderId)
      const payment = TossPayments(clientKey).payment({ customerKey: order.customerKey })
      if (subscriptionMode === 'manual') await payment.requestPayment({
        method: 'CARD', amount: { currency: 'KRW', value: order.amount }, orderId: order.orderId, orderName: order.orderName,
        successUrl: `${SITE_URL}/shop/subscription/success`,
        failUrl: `${SITE_URL}/shop/fail?flow=subscription&checkoutOrderId=${encodeURIComponent(order.orderId)}`,
      })
      else await payment.requestBillingAuth({
        method: 'CARD',
        successUrl: `${SITE_URL}/shop/subscription/success?checkoutOrderId=${encodeURIComponent(order.orderId)}`,
        failUrl: `${SITE_URL}/shop/fail?flow=subscription&checkoutOrderId=${encodeURIComponent(order.orderId)}`,
      })
    } catch (error) {
      let recordError = ''
      if (orderId && error.code) { try { await recordCheckoutClosure(orderId, error) } catch (caught) { recordError = ` 내역 기록 실패: ${caught.message}` } }
      setNotice(error.message + recordError); setBusy(false); await refreshAccount()
    }
  }

  const buyCredits = async (item) => {
    let orderId
    try {
      setBusy(true); setNotice('')
      const TossPayments = await ready()
      const order = await api('/payments/orders', { method: 'POST', body: JSON.stringify({ productId: item.id }) })
      orderId = order.orderId
      sessionStorage.setItem('moa-credit-order-id', order.orderId)
      const payment = TossPayments(clientKey).payment({ customerKey: order.customerKey })
      await payment.requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: order.amount },
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: `${SITE_URL}/shop/credits/success`,
        failUrl: `${SITE_URL}/shop/fail?flow=credits&checkoutOrderId=${encodeURIComponent(order.orderId)}`,
      })
    } catch (error) {
      let recordError = ''
      if (orderId && error.code) { try { await recordCheckoutClosure(orderId, error) } catch (caught) { recordError = ` 내역 기록 실패: ${caught.message}` } }
      setNotice(error.message + recordError); setBusy(false); await refreshAccount()
    }
  }

  const cancelSubscription = async () => {
    try {
      setBusy(true)
      const result = await api('/payments/subscriptions/cancel', { method: 'POST', body: '{}' })
      setNotice(`구독을 해지 예약했습니다. ${new Date(result.current_period_end).toLocaleDateString('ko-KR')}까지 이용할 수 있습니다.`)
      await refreshAccount()
    } catch (error) { setNotice(error.message) } finally { setBusy(false) }
  }

  const credits = products.filter((product) => product.product_type === 'credits')
  const subscription = products.find((product) => product.product_type === 'subscription')

  return <div className="shop-page">
    <div className="shop-content">
      <section className="shop-hero"><p className="eyebrow">MOA STORE · TEST MODE</p><h1>모아 상점</h1><p>멤버십과 크레딧으로 모아를 더 풍성하게 이용해 보세요.</p><span className="shop-test-note">테스트 결제입니다. 테스트 키로 실제 금액이 청구되지 않습니다.</span></section>
      {notice && <div className="shop-notice" role="status">{notice}</div>}
      {!authStorage.getItem('token') && <div className="shop-notice warning">결제와 포인트 적립 내역을 연결하려면 <a href="/login?next=/shop">로그인</a>해 주세요.</div>}
      {account && <section className="shop-notice shop-account-summary"><strong>내 결제 정보</strong><span>보유 포인트: {Number(account.balance).toLocaleString('ko-KR')}P</span><span>구독 상태: {subscriptionStatusName(account.subscription)}</span>{account.subscription?.is_active && account.subscription.billing_mode === 'automatic' && !account.subscription.cancel_at_period_end && <button className="shop-button secondary" disabled={busy} onClick={cancelSubscription}>자동갱신 해지 예약</button>}<Link to="/profile/payments" className="text-link">내 구독·결제내역 보기 →</Link></section>}
      {!clientKey && <div className="shop-notice warning">결제 키가 설정되지 않았습니다. Vercel의 VITE_TOSS_CLIENT_KEY를 확인해 주세요.</div>}

      <div className="shop-purchase-options">
      <section className="shop-section shop-option">
        <div className="shop-section-heading"><div><span className="shop-kicker">MONTHLY MEMBERSHIP</span><h2>월간 구독</h2><p>1개월 이용권과 자동갱신 구독 중 선택하세요.</p></div><span className="shop-pill">월간</span></div>
        <fieldset className="shop-subscription-mode" disabled={busy}><legend>구독 방식 선택</legend><label className={subscriptionMode === 'manual' ? 'selected' : ''}><input type="radio" name="subscription-mode" value="manual" checked={subscriptionMode === 'manual'} onChange={() => setSubscriptionMode('manual')} /><span><strong>1개월 이용권</strong><small>크레딧과 같은 결제창 · 자동 청구 없음</small></span></label><label className={subscriptionMode === 'automatic' ? 'selected' : ''}><input type="radio" name="subscription-mode" value="automatic" checked={subscriptionMode === 'automatic'} onChange={() => setSubscriptionMode('automatic')} /><span><strong>자동갱신 구독</strong><small>카드 등록 후 매월 자동 청구 · 해지 가능</small></span></label></fieldset>
        <article className="shop-subscription-card"><div className="shop-plan-copy"><span className="shop-plan-label">MOA PREMIUM</span><h3>{subscriptionMode === 'manual' ? '프리미엄 1개월 이용권' : '프리미엄 자동갱신 구독'}</h3><p>커뮤니티를 더 편리하게 이용할 수 있는 월간 플랜</p><ul><li>프리미엄 멤버십 1개월 이용</li><li>{subscriptionMode === 'manual' ? '이번 결제 한 번만 청구' : '등록한 카드로 매월 자동 결제'}</li><li>{subscriptionMode === 'manual' ? '기간 만료 시 자동 종료' : '프로필에서 자동갱신 해지 가능'}</li></ul></div><div className="shop-plan-price"><strong>{subscription ? money(subscription.amount) : '불러오는 중'}</strong><small>{subscriptionMode === 'manual' ? '1개월 이용 · 1회 결제' : '매월 1회 자동갱신'}</small><button className="shop-button primary" disabled={busy || !subscription || account?.subscription?.is_active} onClick={subscribe}>{busy ? '처리 중…' : account?.subscription?.is_active ? '현재 구독 이용 중' : subscriptionMode === 'manual' ? '1개월 이용권 결제' : '자동갱신 카드 등록 및 첫 결제'}</button><small className="shop-legal-note">{subscriptionMode === 'manual' ? '일반 카드결제창에서 결제 후 1개월 이용합니다.' : '자동 청구를 위한 별도 카드등록창이 열립니다.'}</small></div></article>
      </section>
      <section className="shop-section shop-option"><div className="shop-section-heading"><div><span className="shop-kicker">CREDIT POINTS</span><h2>크레딧 충전</h2><p>필요한 만큼 포인트를 충전해 보세요.</p></div><span className="shop-pill">1회 결제</span></div>
        <div className="shop-credit-grid">{credits.map((item, index) => <article className={`shop-credit-card${index === credits.length - 1 ? ' featured' : ''}`} key={item.id}><div className="shop-credit-icon">P</div><span className="shop-credit-label">포인트 충전</span><h3>{Number(item.credits).toLocaleString('ko-KR')}P</h3><p>{item.name}</p><div className="shop-credit-price">{money(item.amount)}</div><button className="shop-button secondary" disabled={busy} onClick={() => buyCredits(item)}>{busy ? '처리 중…' : '결제하고 포인트 충전'}</button></article>)}</div>
      </section></div>

      <aside className="shop-footer-note"><strong>결제·구독 안내</strong><p>1개월 이용권은 한 번만 결제되며 종료일에 자동으로 만료됩니다. 자동갱신 구독은 별도 카드등록 후 매월 결제되고, 프로필에서 해지 예약할 수 있습니다. 승인 완료된 결제만 이용권이 활성화됩니다. 최근 구독 결제를 전액 환불하면 이용이 즉시 종료됩니다.</p></aside>
    </div>
  </div>
}
