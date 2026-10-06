import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'
import { authStorage } from './authStorage.js'
import './support.css'

const userHeaders = () => ({ Authorization: `Bearer ${authStorage.getItem('token')}` })

export function NoticeModal({ notice, onClose }) {
  const [hideForDay, setHideForDay] = useState(false)
  if (!notice) return null
  const close = () => onClose(hideForDay)
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="modal-card notice-modal"><button className="modal-close" onClick={close}>×</button><p className="eyebrow">NOTICE</p><h2>{notice.title}</h2><p className="modal-content">{notice.content}</p><label className="notice-hide-option"><input type="checkbox" checked={hideForDay} onChange={(event) => setHideForDay(event.target.checked)} /> 24시간 동안 보지 않기</label><button className="button small" onClick={close}>닫기</button></section></div>
}

export function InquiryModal({ onClose }) {
  const [content, setContent] = useState(''); const [message, setMessage] = useState('')
  const submit = async (event) => { event.preventDefault(); try { await apiFetch('/inquiries', { method: 'POST', headers: { ...userHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }); setMessage('문의가 접수되었습니다.'); setContent('') } catch (error) { setMessage(error.message) } }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="modal-card"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">SUPPORT</p><h2>1:1 문의하기</h2><form className="editor modal-form" onSubmit={submit}><label>문의 내용<textarea required rows="7" value={content} onChange={(event) => setContent(event.target.value)} placeholder="문의 내용을 입력해 주세요." /></label>{message && <p className="profile-message">{message}</p>}<button className="button">문의 등록</button></form></section></div>
}

export function ReportModal({ targetType, targetId, onClose }) {
  const [reason, setReason] = useState(''); const [message, setMessage] = useState('')
  const submit = async (event) => { event.preventDefault(); try { await apiFetch('/reports', { method: 'POST', headers: { ...userHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType, targetId, reason }) }); setMessage('신고가 접수되었습니다.'); setReason('') } catch (error) { setMessage(error.message) } }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="modal-card"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">REPORT</p><h2>신고하기</h2><form className="editor modal-form" onSubmit={submit}><label>신고 사유<textarea required maxLength="1000" rows="6" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="신고 사유를 입력해 주세요." /></label>{message && <p className="profile-message">{message}</p>}<button className="button">신고 접수</button></form></section></div>
}

export function MyInquiries() {
  const [items, setItems] = useState([]); const [error, setError] = useState('')
  useEffect(() => { apiFetch('/inquiries', { headers: userHeaders() }).then(setItems).catch((caught) => setError(caught.message)) }, [])
  return <section className="my-inquiries"><h2>내 문의 내역</h2>{error && <p className="profile-message">{error}</p>}{items.length ? items.map((item) => <article key={item.id}><strong>{item.status === 'answered' ? '답변 완료' : '답변 대기'}</strong><p>{item.content}</p><small>{new Date(item.created_at).toLocaleDateString('ko-KR')}</small>{item.answer && <div className="inquiry-answer"><b>관리자 답변</b><p>{item.answer}</p></div>}</article>) : <p className="empty">문의 내역이 없습니다.</p>}</section>
}

export function MyReports() {
  const [items, setItems] = useState([]); const [error, setError] = useState('')
  useEffect(() => { apiFetch('/reports', { headers: userHeaders() }).then(setItems).catch((caught) => setError(caught.message)) }, [])
  const label = { pending: '접수', reviewed: '검토 중', resolved: '처리 완료', dismissed: '반려' }
  return <section className="my-inquiries my-reports"><h2>내 신고 내역</h2>{error && <p className="profile-message">{error}</p>}{items.length ? items.map((item) => <article key={item.id}><strong>{label[item.status] || item.status}</strong><p>{item.reason}</p><small>{item.target_type === 'post' ? '게시글' : '댓글'} #{item.target_id} · {new Date(item.created_at).toLocaleDateString('ko-KR')}</small></article>) : <p className="empty">신고 내역이 없습니다.</p>}</section>
}

export function LegalModal({ type, onClose }) {
  const privacy = type === 'privacy'
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="modal-card legal-modal"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">{privacy ? 'PRIVACY' : 'TERMS'}</p><h2>{privacy ? '개인정보처리방침' : '이용약관'}</h2>{privacy ? <><h3>1. 수집 항목 및 목적</h3><p>회원 식별과 서비스 제공을 위해 이름, 이메일, 게시글·댓글·문의·신고 기록을 처리합니다.</p><h3>2. 보유 및 파기</h3><p>회원 탈퇴 또는 처리 목적 달성 시 지체 없이 파기합니다. 법령상 보관이 필요한 정보는 해당 기간 동안 보관합니다.</p><h3>3. 이용자 권리</h3><p>이용자는 자신의 개인정보에 대한 열람·정정·삭제를 요청할 수 있으며, 서비스 문의를 통해 요청할 수 있습니다.</p><h3>4. 제3자 제공 및 처리위탁</h3><p>법령상 근거가 있거나 이용자 동의가 있는 경우를 제외하고 개인정보를 제3자에게 제공하지 않습니다. 서비스 운영을 위해 Supabase와 Vercel을 사용합니다.</p></> : <><h3>1. 서비스 이용</h3><p>회원은 관련 법령과 본 약관을 준수하며, 다른 이용자의 권리 또는 서비스 운영을 방해하지 않아야 합니다.</p><h3>2. 게시물 및 신고</h3><p>불법·권리 침해·광고성 게시물은 삭제 또는 이용 제한될 수 있습니다. 신고된 내용은 운영자가 검토합니다.</p><h3>3. 계정 관리</h3><p>계정 정보 관리 책임은 회원에게 있으며, 부정 이용이 확인되면 이용을 제한할 수 있습니다.</p><h3>4. 약관 변경</h3><p>중요 변경은 서비스 내 공지로 안내하며, 변경 후 서비스를 계속 사용하면 변경 내용에 동의한 것으로 봅니다.</p></>}<p className="legal-note">본 문서는 기본 안내용입니다. 실제 서비스 운영 전에는 사업자 정보와 보유 기간을 반영한 법률 검토가 필요합니다.</p></section></div>
}
