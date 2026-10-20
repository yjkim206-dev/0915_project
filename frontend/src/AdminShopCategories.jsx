import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'
import { authStorage } from './authStorage.js'
import './shop-categories.css'

const headers = () => ({ Authorization: `Bearer ${authStorage.getItem('adminToken')}`, 'Content-Type': 'application/json' })
const empty = { name: '', description: '', sort_order: 60, is_active: true }
function CategoryFields({ value, onChange, disabled }) {
  const change = (key, next) => onChange({ ...value, [key]: next })
  return <fieldset disabled={disabled} className="category-fields">
    <label>카테고리 이름<input required maxLength={60} value={value.name} onChange={event => change('name', event.target.value)} /></label>
    <label>소개<textarea maxLength={500} rows={2} value={value.description} onChange={event => change('description', event.target.value)} /></label>
    <label>표시 순서<input required type="number" min={0} max={9999} value={value.sort_order} onChange={event => change('sort_order', Number(event.target.value))} /></label>
    <label className="category-checkbox"><input type="checkbox" checked={value.is_active} onChange={event => change('is_active', event.target.checked)} /> 상점에 표시</label>
  </fieldset>
}
export default function AdminShopCategories() {
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    apiFetch('/admin/shop/categories', { headers: headers(), signal: controller.signal }).then(data => { setItems(data); setLoaded(true) }).catch(error => { if (error.name !== 'AbortError') setMessage(error.message) })
    return () => controller.abort()
  }, [])
  const save = async (event, item, create = false) => {
    event.preventDefault(); if (busy) return
    setBusy(true); setMessage('')
    try {
      const data = await apiFetch(create ? '/admin/shop/categories' : `/admin/shop/categories/${item.id}`, { method: create ? 'POST' : 'PATCH', headers: headers(), body: JSON.stringify(item) })
      setItems(current => (create ? [...current, data] : current.map(row => row.id === data.id ? data : row)).sort((a, b) => a.sort_order - b.sort_order))
      if (create) setDraft(empty)
      setMessage('카테고리를 저장했습니다. 상점 페이지를 새로 열면 반영됩니다.')
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <section className="dashboard-panel admin-category-panel"><h2>상점 카테고리 관리</h2><p>전자책·자료, 템플릿·디자인, 영상·강의를 기본으로 제공합니다. 분류명·소개·표시 순서와 공개 여부를 변경할 수 있습니다.</p>
    {message && <p className="profile-message" role="status">{message}</p>}
    {!loaded && !message && <p>카테고리를 불러오는 중입니다.</p>}
    <div className="admin-category-list">{items.map(item => <form className="admin-category-card" key={item.id} onSubmit={event => save(event, item)}><h3>{item.name} <small>{item.category_type === 'content' ? '디지털 콘텐츠' : '기존 결제 상품'}</small></h3><CategoryFields value={item} disabled={busy} onChange={value => setItems(current => current.map(row => row.id === item.id ? value : row))} /><button className="admin-button" disabled={busy}>변경 저장</button></form>)}</div>
    <form className="admin-category-card" onSubmit={event => save(event, draft, true)}><h3>새 디지털 콘텐츠 카테고리</h3><CategoryFields value={draft} onChange={setDraft} disabled={busy || !loaded} /><button className="admin-button" disabled={busy || !loaded}>카테고리 추가</button></form>
  </section>
}
