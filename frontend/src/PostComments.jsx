import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'
import { authStorage } from './authStorage.js'

const headers = () => ({ Authorization: 'Bearer ' + (authStorage.getItem('token') || '') })
export default function PostComments({ postId, isLoggedIn }) {
  const [comments, setComments] = useState([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingContent, setEditingContent] = useState('')
  const userId = authStorage.getItem('userId')
  const load = () => apiFetch('/posts/' + postId + '/comments').then(setComments).catch((e) => setError(e.message))
  useEffect(() => { load() }, [postId])
  const submit = async (e) => { e.preventDefault(); if (!content.trim()) return; try { const data = await apiFetch('/posts/' + postId + '/comments', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.trim() }) }); setComments((items) => [...items, data]); setContent('') } catch (err) { setError(err.message) } }
  const save = async (id) => { try { const data = await apiFetch('/comments/' + id, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editingContent.trim() }) }); setComments((items) => items.map((item) => item.id === id ? { ...item, ...data } : item)); setEditingId(null) } catch (err) { setError(err.message) } }
  const remove = async (id) => { if (!window.confirm('댓글을 삭제할까요?')) return; try { await apiFetch('/comments/' + id, { method: 'DELETE', headers: headers() }); setComments((items) => items.filter((item) => item.id !== id)) } catch (err) { setError(err.message) } }
  return <section className="comments"><h2>댓글 <span>{comments.length}</span></h2><div className="comment-list">{comments.map((comment) => <article className="comment" key={comment.id}><div><strong>{comment.author || '사용자'}</strong><small>{new Date(comment.created_at).toLocaleDateString('ko-KR')}</small>{userId && String(userId) === String(comment.author_id) && <span className="comment-actions"><button onClick={() => { setEditingId(comment.id); setEditingContent(comment.content) }}>수정</button><button onClick={() => remove(comment.id)}>삭제</button></span>}</div>{editingId === comment.id ? <><textarea value={editingContent} onChange={(e) => setEditingContent(e.target.value)} /><button className="button small" onClick={() => save(comment.id)}>저장</button></> : <p>{comment.content}</p>}</article>)}</div>{isLoggedIn ? <form className="comment-form" onSubmit={submit}><textarea required value={content} onChange={(e) => setContent(e.target.value)} maxLength="500" rows="3" placeholder="댓글을 작성해 보세요." /><button className="button small">댓글 작성</button></form> : <p className="comment-login">댓글을 작성하려면 로그인해 주세요.</p>}{error && <p className="profile-message">{error}</p>}</section>
}
