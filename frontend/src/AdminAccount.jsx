import { useEffect, useState } from 'react'
import { authStorage } from './authStorage.js'
import './admin-account.css'
import { apiFetch as fetch } from './api.js'

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/admin/account`

export default function AdminAccount() {
  const [form, setForm] = useState({ name: '', email: '', profileImage: '', currentPassword: '', newPassword: '', confirmPassword: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(API, { headers: { Authorization: `Bearer ${authStorage.getItem('adminToken')}` } })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.message)
        setForm((current) => ({ ...current, name: data.name, email: data.email, profileImage: data.profile_image || '' }))
      })
      .catch((requestError) => setError(requestError.message || '??影??낟???癲ル슢???ъ쒜?????곗뵯????? ?꿔꺂??쭫?묒쒜?壤??????'))
      .finally(() => setLoading(false))
  }, [])

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))

  const logout = () => {
    authStorage.removeItem('adminToken')
    window.location.href = '/admin/login'
  }

  const selectImage = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('?????꿔꺂??? ?????쀫굞??????ｋ?????κ땁??癲ル슢????')
    if (file.size > 2 * 1024 * 1024) return setError('????썹땟怨⒲뀋???????꿔꺂?????2MB ???ш끽維???????ｋ?????κ땁??癲ル슢????')
    const reader = new FileReader()
    reader.onload = () => { setForm((current) => ({ ...current, profileImage: reader.result })); setError('') }
    reader.readAsDataURL(file)
  }

  const save = async (event) => {
    event.preventDefault()
    setMessage('')
    setError('')
    if (form.newPassword && form.newPassword !== form.confirmPassword) {
      setError('???????筌????????? ??濚밸Ŧ遊얕맱??? ??????????딅젩.')
      return
    }
    try {
      const response = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authStorage.getItem('adminToken')}` },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setForm((current) => ({ ...current, name: data.name, email: data.email, profileImage: data.profile_image || '', currentPassword: '', newPassword: '', confirmPassword: '' }))
      setMessage('???援온??잙갭큔?????影??낟???癲ル슢???ъ쒜筌믡굥夷???쎛 ???逆곷틳源얗??????????딅젩.')
    } catch (requestError) {
      setError(requestError.message || '??影??낟???癲ル슢???ъ쒜?????嚥싳쇎紐??鶯? ?꿔꺂??쭫?묒쒜?壤??????')
    }
  }

  if (loading) return <div className="admin-account-page"><p>??影??낟???癲ル슢???ъ쒜?????곗뵯??????紐꾪닓 嚥?..</p></div>

  return <div className="admin-account-page">
    <div className="admin-account-head">
      <div><p className="admin-kicker">MOA ADMIN</p><h1>???援온??잙갭큔?????影??낟?????繹먮냱??</h1><p>???援온??잙갭큔???????? ???癲????釉띾툞 ?????筌?????沃섃뮧嫄???⑤슢堉??嚥▲굧????????????????딅젩.</p></div>
      <div className="admin-account-head-actions">
        <a href="/admin" className="admin-account-back">????嶺뚮㉡????嶺뚮Ĳ?됲걫 ?????誘⑹º???쎛??</a>
        <button type="button" className="admin-account-logout" onClick={logout}>?汝??吏?????썹땟??</button>
      </div>
    </div>
    <form className="admin-account-form" onSubmit={save}>
      <label>???援온??잙갭큔????????<input name="name" value={form.name} onChange={update} maxLength="30" required /></label>
      <label>???援온??잙갭큔??????癲??<input name="email" type="email" value={form.email} onChange={update} required /></label>
      <label>프로필 이미지<input type="file" accept="image/*" onChange={selectImage} />{form.profileImage && <img className="admin-account-preview" src={form.profileImage} alt="프로필 미리보기" />}</label>
      <div className="admin-account-divider" />
      <h2>?????筌???????⑤슢堉???</h2><p className="admin-account-help">?????筌?????沃섃뮧嫄???⑤슢堉??嚥▲굧????鶯? ????⑤짅嫄????ル봾諭?????썹땟?????????????????</p>
      <label>????썹땟???????筌?????<input name="currentPassword" type="password" value={form.currentPassword} onChange={update} autoComplete="current-password" /></label>
      <label>새 비밀번호<input name="newPassword" type="password" minLength="8" value={form.newPassword} onChange={update} autoComplete="new-password" placeholder="8자 이상" /></label>
      <label>???????筌??????癲ル슢캉????<input name="confirmPassword" type="password" value={form.confirmPassword} onChange={update} autoComplete="new-password" /></label>
      {error && <p className="admin-account-error">{error}</p>}
      {message && <p className="admin-account-message">{message}</p>}
      <div className="admin-account-actions"><button className="admin-button" type="submit">??⑤슢堉??嚥▲굧?????뮏??????</button></div>
    </form>
  </div>
}





