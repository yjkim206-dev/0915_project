import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'
import { authStorage } from './authStorage.js'
import { ReportModal } from './Support.jsx'

const headers = () => ({ Authorization: `Bearer ${authStorage.getItem('token') || ''}` })
export default function PostComments({ postId, isLoggedIn }) {
  const [comments, setComments] = useState([]); const [content, setContent] = useState(''); const [error, setError] = useState(''); const [reportTarget, setReportTarget] = useState(null); const userId = authStorage.getItem('userId')
  const load = () => apiFetch(`/posts/${postId}/comments`).then(setComments).catch((caught) => setError(caught.message))
  useEffect(() => { load() }, [postId])
  const submit = async (event) => { event.preventDefault(); try { const data = await apiFetch(`/posts/${postId}/comments`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }); setComments((items) => [...items, data]); setContent('') } catch (caught) { setError(caught.message) } }
  return <section className="comments"><div className="comment-title"><h2>댓글 <span>{comments.length}</span></h2>{isLoggedIn && <button className="text-action" onClick={() => setReportTarget({ type: 'post', id: postId })}>게시글 신고</button>}</div><div className="comment-list">{comments.map((comment) => <article className="comment" key={comment.id}><div><strong>{comment.author || '사용자'}</strong><small>{new Date(comment.created_at).toLocaleDateString('ko-KR')}</small>{isLoggedIn && String(userId) !== String(comment.author_id) && <button className="text-action" onClick={() => setReportTarget({ type: 'comment', id: comment.id })}>신고</button>}</div><p>{comment.content}</p></article>)}</div>{isLoggedIn ? <form className="comment-form" onSubmit={submit}><textarea required value={content} onChange={(event) => setContent(event.target.value)} maxLength="500" rows="3" placeholder="댓글을 작성해 보세요." /><button className="button small">댓글 작성</button></form> : <p className="comment-login">댓글을 작성하려면 로그인해 주세요.</p>}{error && <p className="profile-message">{error}</p>}{reportTarget && <ReportModal targetType={reportTarget.type} targetId={reportTarget.id} onClose={() => setReportTarget(null)} />}</section>
}
