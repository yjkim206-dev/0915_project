import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'
import { authStorage } from './authStorage.js'
import { InquiryModal, ReportModal } from './Support.jsx'

const headers = () => ({ Authorization: `Bearer ${authStorage.getItem('token') || ''}` })

export default function PostComments({ postId, isLoggedIn }) {
  const [comments, setComments] = useState([])
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingContent, setEditingContent] = useState('')
  const [error, setError] = useState('')
  const [reportTarget, setReportTarget] = useState(null)
  const [inquiryOpen, setInquiryOpen] = useState(false)
  const [reactions, setReactions] = useState({ likes: 0, dislikes: 0, reaction: null })
  const userId = authStorage.getItem('userId')

  const load = () => apiFetch(`/posts/${postId}/comments`).then(setComments).catch((caught) => setError(caught.message))
  useEffect(() => { load(); apiFetch(`/posts/${postId}/reactions`, { headers: headers() }).then(setReactions).catch(() => {}) }, [postId])
  const submit = async (event) => { event.preventDefault(); try { const data = await apiFetch(`/posts/${postId}/comments`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }); setComments((items) => [...items, data]); setContent('') } catch (caught) { setError(caught.message) } }
  const saveEdit = async (id) => { try { const data = await apiFetch(`/comments/${id}`, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editingContent }) }); setComments((items) => items.map((item) => item.id === id ? data : item)); setEditingId(null) } catch (caught) { setError(caught.message) } }
  const deleteComment = async (id) => { if (!window.confirm('댓글을 삭제할까요?')) return; try { await apiFetch(`/comments/${id}`, { method: 'DELETE', headers: headers() }); setComments((items) => items.filter((item) => item.id !== id)) } catch (caught) { setError(caught.message) } }
  const react = async (reaction) => { if (!isLoggedIn) return setError('로그인 후 반응할 수 있습니다.'); try { setReactions(await apiFetch(`/posts/${postId}/reactions`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ reaction }) })) } catch (caught) { setError(caught.message) } }
  const commentItem = (comment) => {
    const isAuthor = String(userId) === String(comment.author_id)
    const editing = editingId === comment.id
    return <article className="comment" key={comment.id}>
      <div><strong>{comment.author || '사용자'}</strong><small>{new Date(comment.created_at).toLocaleDateString('ko-KR')}</small>{isLoggedIn && !isAuthor && <button className="text-action" onClick={() => setReportTarget({ type: 'comment', id: comment.id })}>신고</button>}{isAuthor && <><button className="text-action" onClick={() => { setEditingId(comment.id); setEditingContent(comment.content) }}>수정</button><button className="text-action danger" onClick={() => deleteComment(comment.id)}>삭제</button></>}</div>
      {editing ? <div className="comment-edit"><textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} maxLength="500" rows="3" /><button className="button small" type="button" onClick={() => saveEdit(comment.id)}>저장</button><button className="outline" type="button" onClick={() => setEditingId(null)}>취소</button></div> : <p>{comment.content}</p>}
    </article>
  }
  return <section className="comments">
    <div className="post-reactions"><button className={`reaction${reactions.reaction === 'like' ? ' active' : ''}`} onClick={() => react('like')}>좋아요 <strong>{reactions.likes}</strong></button><button className={`reaction dislike${reactions.reaction === 'dislike' ? ' active' : ''}`} onClick={() => react('dislike')}>싫어요 <strong>{reactions.dislikes}</strong></button>{isLoggedIn && <><button className="text-action" onClick={() => setInquiryOpen(true)}>문의하기</button><button className="text-action" onClick={() => setReportTarget({ type: 'post', id: postId })}>게시글 신고</button></>}</div>
    <div className="comment-title"><h2>댓글 <span>{comments.length}</span></h2></div>
    <div className="comment-list">{comments.map(commentItem)}</div>
    {isLoggedIn ? <form className="comment-form" onSubmit={submit}><textarea required value={content} onChange={(event) => setContent(event.target.value)} maxLength="500" rows="3" placeholder="댓글을 작성해 보세요." /><button className="button small">댓글 작성</button></form> : <p className="comment-login">댓글을 작성하려면 로그인해 주세요.</p>}
    {error && <p className="profile-message">{error}</p>}
    {inquiryOpen && <InquiryModal onClose={() => setInquiryOpen(false)} />}
    {reportTarget && <ReportModal targetType={reportTarget.type} targetId={reportTarget.id} onClose={() => setReportTarget(null)} />}
  </section>
}
