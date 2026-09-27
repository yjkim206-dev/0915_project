import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export default function PostComments({ postId, isLoggedIn }) {
  const [comments, setComments] = useState([])
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingContent, setEditingContent] = useState('')
  const [reaction, setReaction] = useState(null)
  const [counts, setCounts] = useState({ likes: 0, dislikes: 0 })
  const [error, setError] = useState('')
  const currentUserId = Number(sessionStorage.getItem('userId')) || null

  const loadComments = () => fetch(`${API}/posts/${postId}/comments`).then((response) => response.json()).then((data) => { if (Array.isArray(data)) setComments(data) }).catch(() => setError('댓글을 불러오지 못했습니다.'))

  useEffect(() => {
    loadComments()
    fetch(`${API}/posts/${postId}/reactions`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` } }).then((response) => response.json()).then((data) => { if (!data.message) { setCounts({ likes: data.likes || 0, dislikes: data.dislikes || 0 }); setReaction(data.reaction || null) } }).catch(() => {})
  }, [postId])

  const submit = async (event) => {
    event.preventDefault()
    if (!content.trim()) return
    setError('')
    const response = await fetch(`${API}/posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('token')}` }, body: JSON.stringify({ content }) })
    const data = await response.json()
    if (!response.ok) return setError(data.message || '댓글을 작성하지 못했습니다.')
    setComments((current) => [...current, data])
    setContent('')
  }

  const saveEdit = async (commentId) => {
    const response = await fetch(`${API}/comments/${commentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('token')}` }, body: JSON.stringify({ content: editingContent }) })
    const data = await response.json()
    if (!response.ok) return setError(data.message || '댓글을 수정하지 못했습니다.')
    setComments((current) => current.map((comment) => comment.id === commentId ? { ...comment, ...data } : comment))
    setEditingId(null)
    setEditingContent('')
  }

  const remove = async (commentId) => {
    if (!window.confirm('댓글을 삭제할까요?')) return
    const response = await fetch(`${API}/comments/${commentId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` } })
    if (!response.ok) { const data = await response.json(); return setError(data.message || '댓글을 삭제하지 못했습니다.') }
    setComments((current) => current.filter((comment) => comment.id !== commentId))
  }

  const toggleReaction = async (nextReaction) => {
    if (!isLoggedIn) return setError('좋아요와 싫어요는 로그인 후 이용할 수 있습니다.')
    setError('')
    const response = await fetch(`${API}/posts/${postId}/reactions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('token')}` }, body: JSON.stringify({ reaction: nextReaction }) })
    const data = await response.json()
    if (!response.ok) return setError(data.message || '반응을 저장하지 못했습니다.')
    setCounts({ likes: data.likes || 0, dislikes: data.dislikes || 0 })
    setReaction(data.reaction || null)
  }

  return <>
    <section className="post-reactions"><button type="button" className={reaction === 'like' ? 'reaction active' : 'reaction'} onClick={() => toggleReaction('like')}>👍 좋아요 <strong>{counts.likes}</strong></button><button type="button" className={reaction === 'dislike' ? 'reaction active dislike' : 'reaction dislike'} onClick={() => toggleReaction('dislike')}>👎 싫어요 <strong>{counts.dislikes}</strong></button></section>
    <section className="comments"><h2>댓글 <span>{comments.length}</span></h2><div className="comment-list">{comments.length ? comments.map((comment) => <article className="comment" key={comment.id}><div><strong>{comment.author}</strong><small>{new Date(comment.created_at).toLocaleDateString('ko-KR')}</small>{currentUserId === Number(comment.author_id) && <span className="comment-actions"><button type="button" onClick={() => { setEditingId(comment.id); setEditingContent(comment.content); setError('') }}>수정</button><button type="button" onClick={() => remove(comment.id)}>삭제</button></span>}</div>{editingId === comment.id ? <div className="comment-edit"><textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} maxLength="500" rows="3" /><div><button type="button" className="outline" onClick={() => setEditingId(null)}>취소</button><button type="button" className="button small" onClick={() => saveEdit(comment.id)}>저장</button></div></div> : <p>{comment.content}</p>}</article>) : <p className="empty">첫 댓글을 남겨보세요.</p>}</div>{isLoggedIn ? <form className="comment-form" onSubmit={submit}><textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength="500" rows="3" placeholder="댓글을 입력해주세요." /><div><small>{content.length}/500</small><button className="button small">댓글 등록</button></div></form> : <p className="comment-login">댓글을 작성하려면 로그인해주세요.</p>}{error && <p className="profile-message">{error}</p>}</section>
  </>
}
