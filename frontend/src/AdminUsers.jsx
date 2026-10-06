import { useEffect, useMemo, useState } from 'react'
import { authStorage } from './authStorage.js'
import './admin-users.css'
import { apiFetch as fetch } from './api.js'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const token = authStorage.getItem('adminToken')

  const loadUsers = async () => {
    try {
      const response = await fetch(`${API}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setUsers(data)
    } catch (requestError) {
      setError(requestError.message || '??????꿔꺂??袁ㅻ븶筌믠뫀萸?????곗뵯????? ?꿔꺂??쭫?묒쒜?壤??????')
    }
  }

  useEffect(() => { loadUsers() }, [])

  const sortedUsers = useMemo(() => [...users].sort((a, b) => {
    if (a.role === b.role) return new Date(b.created_at) - new Date(a.created_at)
    return a.role === 'admin' ? -1 : 1
  }), [users])

  const adminCount = users.filter((user) => user.role === 'admin').length

  const changeRole = async (user, role) => {
    try {
      const response = await fetch(`${API}/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setUsers((current) => current.map((item) => item.id === user.id ? data : item))
    } catch (requestError) {
      setError(requestError.message || '??????????⑤슢堉??嚥▲굧????鶯? ?꿔꺂??쭫?묒쒜?壤??????')
    }
  }

  const remove = async (user) => {
    if (!window.confirm(`${user.email} ?????????????ャ렑???`)) return
    try {
      const response = await fetch(`${API}/admin/users/${user.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) { const data = await response.json(); throw new Error(data.message) }
      setUsers((current) => current.filter((item) => item.id !== user.id))
    } catch (requestError) {
      setError(requestError.message || '???????????? ?꿔꺂??쭫?묒쒜?壤??????')
    }
  }

  return <section className="admin-users-page">
    <div className="admin-topbar">
      <div><p className="admin-kicker">USERS</p><h1>????????援온??</h1></div>
      <div className="admin-users-summary"><span>????썹땟??{users.length}??</span><span className="admin-users-admin-count">???援온??잙갭큔???{adminCount}??</span></div>
    </div>
    {error && <p className="admin-posts-error">{error}</p>}
    <div className="admin-posts-table admin-users-table">
      <div className="admin-posts-table-head"><span>?????</span><span>???癲??</span><span>??醫딆쓧?????⑤８??/<span><span>???????</span><span>???援온??</span></div>
      {sortedUsers.length ? sortedUsers.map((user) => <div className={`admin-post-row${user.role === 'admin' ? ' is-admin' : ''}`} key={user.id}>
        <strong>{user.name}<small className={`admin-role-badge ${user.role === 'admin' ? 'is-admin' : ''}`}>{user.role === 'admin' ? '???援온??잙갭큔??? : '????Β??뼐 ?????}</small></strong>
        <span>{user.email}</span>
        <span>{new Date(user.created_at).toLocaleDateString('ko-KR')}</span>
        <span><select value={user.role} onChange={(event) => changeRole(user, event.target.value)}><option value="user">????Β??뼐 ?????</option><option value="admin">???援온??잙갭큔???</option></select></span>
        <div className="admin-post-actions"><button type="button" className="delete" onClick={() => remove(user)}>????</button></div>
      </div>) : <p className="empty">?嚥싲갭큔?댁쉩????????? ????ㅿ폍??????딅젩.</p>}
    </div>
  </section>
}





