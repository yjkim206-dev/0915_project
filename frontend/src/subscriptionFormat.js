export const subscriptionStatusName = (subscription) => {
  if (!subscription) return '구독 없음'
  if (subscription.status === 'past_due') return '갱신 결제 실패'
  if (subscription.status === 'renewal_due') return '갱신 확인 중'
  if (subscription.status === 'cancelled') return '이용 종료'
  if (subscription.status === 'expired') return '기간 만료'
  if (subscription.is_active) return subscription.cancel_at_period_end ? '해지 예약 · 이용 중' : '이용 중'
  return '구독 없음'
}
