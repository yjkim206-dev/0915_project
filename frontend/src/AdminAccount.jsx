import { useEffect, useState } from 'react'
import './admin-account.css'

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/admin/account`

export default function AdminAccount() {
  const [form, setForm] = useState({ name: '', email: '', profileImage: '', currentPassword: '', newPassword: '', confirmPassword: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(API, { headers: { Authorization: `Bearer ${sessionStorage.getItem('adminToken')}` } })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.message)
        setForm((current) => ({ ...current, name: data.name, email: data.email, profileImage: data.profile_image || '' }))
      })
      .catch((requestError) => setError(requestError.message || '계정 정보를 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))

  const logout = () => {
    sessionStorage.removeItem('adminToken')
    window.location.href = '/admin/login'
  }

  const selectImage = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('이미지 파일만 선택해주세요.')
    if (file.size > 2 * 1024 * 1024) return setError('프로필 이미지는 2MB 이하로 선택해주세요.')
    const reader = new FileReader()
    reader.onload = () => { setForm((current) => ({ ...current, profileImage: reader.result })); setError('') }
    reader.readAsDataURL(file)
  }

  const save = async (event) => {
    event.preventDefault()
    setMessage('')
    setError('')
    if (form.newPassword && form.newPassword !== form.confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.')
      return
    }
    try {
      const response = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('adminToken')}` },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setForm((current) => ({ ...current, name: data.name, email: data.email, profileImage: data.profile_image || '', currentPassword: '', newPassword: '', confirmPassword: '' }))
      setMessage('관리자 계정 정보가 저장되었습니다.')
    } catch (requestError) {
      setError(requestError.message || '계정 정보를 저장하지 못했습니다.')
    }
  }

  if (loading) return <div className="admin-account-page"><p>계정 정보를 불러오는 중...</p></div>

  return <div className="admin-account-page">
    <div className="admin-account-head">
      <div><p className="admin-kicker">MOA ADMIN</p><h1>관리자 계정 설정</h1><p>관리자 이름, 이메일과 비밀번호를 변경할 수 있습니다.</p></div>
      <div className="admin-account-head-actions">
        <a href="/admin" className="admin-account-back">대시보드로 돌아가기</a>
        <button type="button" className="admin-account-logout" onClick={logout}>로그아웃</button>
      </div>
    </div>
    <form className="admin-account-form" onSubmit={save}>
      <label>관리자 이름<input name="name" value={form.name} onChange={update} maxLength="30" required /></label>
      <label>관리자 이메일<input name="email" type="email" value={form.email} onChange={update} required /></label>
      <label>프로필 이미지<input type="file" accept="image/*" onChange={selectImage} />{form.profileImage && <img className="admin-account-preview" src={form.profileImage} alt="프로필 미리보기" />}</label>
      <div className="admin-account-divider" />
      <h2>비밀번호 변경</h2><p className="admin-account-help">비밀번호를 변경하지 않으려면 아래 항목을 비워두세요.</p>
      <label>현재 비밀번호<input name="currentPassword" type="password" value={form.currentPassword} onChange={update} autoComplete="current-password" /></label>
      <label>새 비밀번호<input name="newPassword" type="password" minLength="8" value={form.newPassword} onChange={update} autoComplete="new-password" placeholder="8자 이상" /></label>
      <label>새 비밀번호 확인<input name="confirmPassword" type="password" value={form.confirmPassword} onChange={update} autoComplete="new-password" /></label>
      {error && <p className="admin-account-error">{error}</p>}
      {message && <p className="admin-account-message">{message}</p>}
      <div className="admin-account-actions"><button className="admin-button" type="submit">변경사항 저장</button></div>
    </form>
  </div>
}
