import { useEffect, useMemo, useState } from 'react'
import { authStorage } from './authStorage.js'
import { apiFetch } from './api.js'
import './admin-users.css'

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const token = authStorage.getItem('adminToken')

  useEffect(() => {
    let active = true
    apiFetch('/admin/users', { headers: { Authorization: `Bearer ${token}` } })
      .then((data) => { if (active) { setUsers(Array.isArray(data) ? data : []); setError('') } })
      .catch((requestError) => { if (active) setError(requestError.message || '회원 목록을 불러오지 못했습니다.') })
    return () => { active = false }
  }, [token])

  const sortedUsers = useMemo(() => [...users].sort((a, b) => {
    if (a.role === b.role) return new Date(b.created_at) - new Date(a.created_at)
    return a.role === 'admin' ? -1 : 1
  }), [users])
  const adminCount = users.filter((user) => user.role === 'admin').length

  const changeRole = async (user, role) => {
    setError('')
    try {
      const data = await apiFetch(`/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      })
      setUsers((current) => current.map((item) => item.id === user.id ? data : item))
    } catch (requestError) {
      setError(requestError.message || '회원 권한을 변경하지 못했습니다.')
    }
  }

  const remove = async (user) => {
    if (!window.confirm(`${user.email} 회원을 삭제하시겠습니까?`)) return
    setError('')
    try {
      await apiFetch(`/admin/users/${user.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      setUsers((current) => current.filter((item) => item.id !== user.id))
    } catch (requestError) {
      setError(requestError.message || '회원을 삭제하지 못했습니다.')
    }
  }

  return <section className="admin-users-page">
    <div className="admin-topbar">
      <div><p className="admin-kicker">USERS</p><h1>회원 관리</h1></div>
      <div className="admin-users-summary"><span>전체 {users.length}명</span><span className="admin-users-admin-count">관리자 {adminCount}명</span></div>
    </div>
    {error && <p className="admin-posts-error" role="alert">{error}</p>}
    <div className="admin-posts-table admin-users-table">
      <div className="admin-posts-table-head"><span>이름</span><span>이메일</span><span>가입일</span><span>권한</span><span>관리</span></div>
      {sortedUsers.length ? sortedUsers.map((user) => <div className={`admin-post-row${user.role === 'admin' ? ' is-admin' : ''}`} key={user.id}>
        <strong>{user.name}<small className={`admin-role-badge ${user.role === 'admin' ? 'is-admin' : ''}`}>{user.role === 'admin' ? '관리자' : '일반 회원'}</small></strong>
        <span>{user.email}</span>
        <span>{new Date(user.created_at).toLocaleDateString('ko-KR')}</span>
        <span><select aria-label={`${user.name} 권한`} value={user.role} onChange={(event) => changeRole(user, event.target.value)}><option value="user">일반 회원</option><option value="admin">관리자</option></select></span>
        <div className="admin-post-actions"><button type="button" className="delete" onClick={() => remove(user)}>삭제</button></div>
      </div>) : <p className="empty">등록된 회원이 없습니다.</p>}
    </div>
  </section>
}
