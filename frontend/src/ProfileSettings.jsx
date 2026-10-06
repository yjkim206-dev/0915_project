import { useState } from 'react'
import { apiFetch } from './api.js'
import { authStorage } from './authStorage.js'

export default function ProfileSettings({ profile, onSaved, panel }) {
  const [form, setForm] = useState({ name: profile.name || '', bio: profile.bio || '', email: profile.email || '', currentPassword: '', newPassword: '', confirmPassword: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  const saveProfile = async (event) => {
    event.preventDefault(); setMessage(''); setError('')
    try {
      const data = await apiFetch('/profile', { method: 'PUT', headers: { Authorization: `Bearer ${authStorage.getItem('token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, bio: form.bio, email: form.email }) })
      setMessage('프로필 정보를 저장했습니다.'); onSaved?.(data)
    } catch (caught) { setError(caught.message) }
  }
  const changePassword = async (event) => {
    event.preventDefault(); setMessage(''); setError('')
    if (form.newPassword !== form.confirmPassword) return setError('새 비밀번호가 서로 다릅니다.')
    try {
      await apiFetch('/profile', { method: 'PUT', headers: { Authorization: `Bearer ${authStorage.getItem('token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) })
      setForm((current) => ({ ...current, currentPassword: '', newPassword: '', confirmPassword: '' })); setMessage('비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용하세요.')
    } catch (caught) { setError(caught.message) }
  }
  if (!panel) return null
  return <section id="profile-settings" className="profile-settings">{panel === 'profile' && <><h2>프로필 편집</h2><form className="editor" onSubmit={saveProfile}><label>이름<input name="name" required value={form.name} onChange={update} /></label><label>이메일<input name="email" required type="email" value={form.email} onChange={update} /></label><label>소개<textarea name="bio" rows="3" value={form.bio} onChange={update} /></label><button className="button">프로필 저장</button></form></>}{panel === 'password' && <form id="password-settings" className="editor password-form" onSubmit={changePassword}><h2>비밀번호 변경</h2><label>현재 비밀번호<input name="currentPassword" required type="password" autoComplete="current-password" value={form.currentPassword} onChange={update} /></label><label>새 비밀번호<input name="newPassword" required minLength="8" type="password" autoComplete="new-password" value={form.newPassword} onChange={update} /></label><label>새 비밀번호 확인<input name="confirmPassword" required minLength="8" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={update} /></label><button className="outline">비밀번호 변경</button></form>}{(message || error) && <p className="profile-message">{message || error}</p>}</section>
}
