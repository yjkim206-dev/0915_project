import { useEffect, useState } from 'react'
import { authStorage } from './authStorage.js'
import { apiFetch as fetch } from './api.js'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export default function AdminComments() {
  const [comments, setComments] = useState([])
  const [error, setError] = useState('')
  const token = authStorage.getItem('adminToken')

  const loadComments = async () => {
    try {
      const response = await fetch(`${API}/admin/comments`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || '??? ?꿔꺂??袁ㅻ븶筌믠뫀萸?????곗뵯????? ?꿔꺂??쭫?묒쒜?壤??????')
      setComments(Array.isArray(data) ? data : [])
    } catch (requestError) {
      setError(requestError.message || '??? ?꿔꺂??袁ㅻ븶筌믠뫀萸?????곗뵯????? ?꿔꺂??쭫?묒쒜?壤??????')
    }
  }

  useEffect(() => { loadComments() }, [])

  const toggleVisibility = async (comment) => {
    setError('')
    const response = await fetch(`${API}/admin/comments/${comment.id}/visibility`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ hidden: !comment.is_hidden }) })
    const data = await response.json()
    if (!response.ok) return setError(data.message || '??? ??????????븐뻤?????⑤슢堉??嚥▲굧????鶯? ?꿔꺂??쭫?묒쒜?壤??????')
    setComments((current) => current.map((item) => item.id === comment.id ? { ...item, is_hidden: Boolean(data.is_hidden) } : item))
  }

  const remove = async (comment) => {
    if (!window.confirm('????????????ャ렑???')) return
    const response = await fetch(`${API}/admin/comments/${comment.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) { const data = await response.json(); return setError(data.message || '??????????? ?꿔꺂??쭫?묒쒜?壤??????') }
    setComments((current) => current.filter((item) => item.id !== comment.id))
  }

  return <section className="admin-comments-page"><div className="admin-topbar"><div><p className="admin-kicker">COMMENTS</p><h1>??? ???援온??</h1></div><span className="admin-date">????썹땟??{comments.length}??</span></div>{error && <p className="admin-posts-error">{error}</p>}<div className="admin-posts-table admin-comments-table"><div className="admin-posts-table-head"><span>???</span><span>???????</span><span>?嚥▲굧?????룸쮤?</span><span>???????</span><span>????븐뻤??</span><span>???援온??</span></div>{comments.length ? comments.map((comment) => <div className={`admin-post-row${comment.is_hidden ? ' is-hidden' : ''}`} key={comment.id}><strong>{comment.content}</strong><span>{comment.author || '????????ㅼ굡??}</span><span>{comment.post_title || '-'}</span><span>{new Date(comment.created_at).toLocaleDateString('ko-KR')}</span><span>{comment.is_hidden ? '?????嶺? : '??????}</span><div className="admin-post-actions"><button type="button" onClick={() => toggleVisibility(comment)}>{comment.is_hidden ? '?????? : '?????嶺?}</button><button type="button" className="delete" onClick={() => remove(comment)}>????</button></div></div>) : <p className="empty">?嚥싲갭큔?댁쉩????????????ㅿ폍??????딅젩.</p>}</div></section>
}





