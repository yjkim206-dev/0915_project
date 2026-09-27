import { useEffect, useState } from 'react'
import AdminComments from './AdminComments.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
const emptyForm = { title: '', content: '', category: '자유' }

function formatDate(value) { return value ? new Date(value).toLocaleDateString('ko-KR') : '-' }

export default function AdminPosts() {
  const [posts, setPosts] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const token = sessionStorage.getItem('adminToken')

  const loadPosts = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API}/admin/posts`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setPosts(data)
    } catch (requestError) {
      setError(requestError.message || '게시글 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPosts() }, [])

  const updateForm = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))

  const startCreate = () => {
    setEditingId(null)
    setEditorOpen(true)
    setForm(emptyForm)
    setError('')
    setMessage('')
  }

  const startEdit = (post) => {
    setEditingId(post.id)
    setEditorOpen(true)
    setForm({ title: post.title, content: post.content, category: post.category || '자유' })
    setError('')
    setMessage('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditorOpen(false)
    setForm(emptyForm)
    setError('')
  }

  const save = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    const isEditing = editingId !== null
    try {
      const response = await fetch(`${API}/admin/posts${isEditing ? `/${editingId}` : ''}`, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      if (isEditing) setPosts((current) => current.map((post) => post.id === data.id ? { ...post, ...data } : post))
      else setPosts((current) => [data, ...current])
      setMessage(isEditing ? '게시글이 수정되었습니다.' : '게시글이 등록되었습니다.')
      setEditingId(null)
      setEditorOpen(false)
      setForm(emptyForm)
    } catch (requestError) {
      setError(requestError.message || '게시글을 저장하지 못했습니다.')
    }
  }

  const toggleVisibility = async (post) => {
    setError('')
    try {
      const response = await fetch(`${API}/admin/posts/${post.id}/visibility`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ hidden: !post.is_hidden }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, is_hidden: data.is_hidden } : item))
    } catch (requestError) {
      setError(requestError.message || '게시 상태를 변경하지 못했습니다.')
    }
  }

  const remove = async (post) => {
    if (!window.confirm('이 게시글을 삭제할까요?')) return
    setError('')
    try {
      const response = await fetch(`${API}/admin/posts/${post.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message)
      }
      setPosts((current) => current.filter((item) => item.id !== post.id))
      if (editingId === post.id) cancelEdit()
      setMessage('게시글이 삭제되었습니다.')
    } catch (requestError) {
      setError(requestError.message || '게시글을 삭제하지 못했습니다.')
    }
  }

  return <><section className="admin-posts-page">
    <div className="admin-topbar"><div><p className="admin-kicker">POSTS</p><h1>게시글 관리</h1></div><div className="admin-posts-toolbar"><span className="admin-date">전체 {posts.length}개</span><button type="button" className="admin-button" onClick={startCreate}>+ 새 글 작성</button></div></div>
    {(error || message) && <p className={error ? 'admin-posts-error' : 'admin-posts-message'}>{error || message}</p>}
    {editorOpen && <form className="admin-post-editor" onSubmit={save}>
      <h2>{editingId === null ? '새 글 작성' : '글 수정'}</h2>
      <label>카테고리<select name="category" value={form.category} onChange={updateForm}><option>자유</option><option>개발</option><option>모임</option></select></label>
      <label>제목<input name="title" value={form.title} onChange={updateForm} maxLength="120" required /></label>
      <label>내용<textarea name="content" value={form.content} onChange={updateForm} rows="8" maxLength="10000" required /></label>
      <div className="admin-post-editor-actions"><button type="button" className="admin-post-cancel" onClick={cancelEdit}>취소</button><button className="admin-button">{editingId === null ? '게시하기' : '수정 저장'}</button></div>
    </form>}
    <div className="admin-posts-table">
      <div className="admin-posts-table-head"><span>제목</span><span>작성자</span><span>카테고리</span><span>작성일</span><span>상태 · 조회</span><span>관리</span></div>
      {loading ? <p className="empty">게시글을 불러오는 중...</p> : posts.length ? posts.map((post) => <div className={`admin-post-row${post.is_hidden ? ' is-hidden' : ''}`} key={post.id}><strong>{post.title}</strong><span>{post.author || '알 수 없음'}</span><span className="category">{post.category || '자유'}</span><span>{formatDate(post.created_at)}</span><span>{post.is_hidden ? '비공개' : '공개'} · {post.views ?? 0}회</span><div className="admin-post-actions"><button type="button" onClick={() => startEdit(post)}>수정</button><button type="button" onClick={() => toggleVisibility(post)}>{post.is_hidden ? '공개' : '비공개'}</button><button type="button" className="delete" onClick={() => remove(post)}>삭제</button></div></div>) : <p className="empty">등록된 게시글이 없습니다.</p>}
    </div>
  </section><AdminComments /></>
}
