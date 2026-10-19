import { useEffect, useState } from 'react'
import { authStorage } from './authStorage.js'
import { apiFetch } from './api.js'

export default function AdminComments() {
  const [comments, setComments] = useState([])
  const [error, setError] = useState('')
  const token = authStorage.getItem('adminToken')

  useEffect(() => {
    let active = true
    apiFetch('/admin/comments', { headers: { Authorization: `Bearer ${token}` } })
      .then((data) => { if (active) { setComments(Array.isArray(data) ? data : []); setError('') } })
      .catch((requestError) => { if (active) setError(requestError.message || '댓글 목록을 불러오지 못했습니다.') })
    return () => { active = false }
  }, [token])

  const toggleVisibility = async (comment) => {
    setError('')
    try {
      const data = await apiFetch(`/admin/comments/${comment.id}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ hidden: !comment.is_hidden }),
      })
      setComments((current) => current.map((item) => item.id === comment.id ? { ...item, is_hidden: Boolean(data.is_hidden) } : item))
    } catch (requestError) {
      setError(requestError.message || '댓글 공개 상태를 변경하지 못했습니다.')
    }
  }

  const remove = async (comment) => {
    if (!window.confirm('댓글을 삭제하시겠습니까?')) return
    setError('')
    try {
      await apiFetch(`/admin/comments/${comment.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      setComments((current) => current.filter((item) => item.id !== comment.id))
    } catch (requestError) {
      setError(requestError.message || '댓글을 삭제하지 못했습니다.')
    }
  }

  return <section className="admin-comments-page">
    <div className="admin-topbar"><div><p className="admin-kicker">COMMENTS</p><h1>댓글 관리</h1></div><span className="admin-date">전체 {comments.length}개</span></div>
    {error && <p className="admin-posts-error" role="alert">{error}</p>}
    <div className="admin-posts-table admin-comments-table">
      <div className="admin-posts-table-head"><span>내용</span><span>작성자</span><span>게시글</span><span>작성일</span><span>공개 상태</span><span>관리</span></div>
      {comments.length ? comments.map((comment) => <div className={`admin-post-row${comment.is_hidden ? ' is-hidden' : ''}`} key={comment.id}>
        <strong>{comment.content}</strong><span>{comment.author || '알 수 없음'}</span><span>{comment.post_title || '-'}</span>
        <span>{new Date(comment.created_at).toLocaleDateString('ko-KR')}</span><span>{comment.is_hidden ? '숨김' : '공개'}</span>
        <div className="admin-post-actions"><button type="button" onClick={() => toggleVisibility(comment)}>{comment.is_hidden ? '공개' : '숨김'}</button><button type="button" className="delete" onClick={() => remove(comment)}>삭제</button></div>
      </div>) : <p className="empty">등록된 댓글이 없습니다.</p>}
    </div>
  </section>
}
