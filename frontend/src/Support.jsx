import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'
import { authStorage } from './authStorage.js'
import './support.css'

const userHeaders = () => ({ Authorization: `Bearer ${authStorage.getItem('token')}` })

export function NoticeModal({ notice, onClose }) {
  if (!notice) return null
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="modal-card notice-modal"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">NOTICE</p><h2>{notice.title}</h2><p className="modal-content">{notice.content}</p><button className="button small" onClick={onClose}>확인</button></section></div>
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
