import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authStorage } from './authStorage.js'
import { apiFetch } from './api.js'

const headers = () => ({ Authorization: 'Bearer ' + authStorage.getItem('adminToken') })
const date = (value) => value ? new Date(value).toLocaleDateString('ko-KR') : '-'
const emptyMetrics = { posts: 0, comments: 0, users: 0, views: 0 }

export default function AdminPosts() {
  const [tab, setTab] = useState('dashboard')
  const [posts, setPosts] = useState([])
  const [comments, setComments] = useState([])
  const [metrics, setMetrics] = useState(emptyMetrics)
  const [reports, setReports] = useState([])
  const [settings, setSettings] = useState({ site_name: '', site_description: '', maintenance_mode: 'false' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [dashboard, reportData, settingData] = await Promise.all([
        apiFetch('/admin/dashboard', { headers: headers() }),
        apiFetch('/admin/reports', { headers: headers() }),
        apiFetch('/admin/settings', { headers: headers() }),
      ])
      setMetrics(dashboard.metrics || emptyMetrics)
      setPosts(dashboard.recentPosts || [])
      setComments(dashboard.recentComments || [])
      setReports(reportData || [])
      setSettings(Object.fromEntries((settingData || []).map((item) => [item.key, item.value])))
    } catch (caught) { setError(caught.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const updateReport = async (id, status) => { try { const data = await apiFetch('/admin/reports/' + id, { method: 'PATCH', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); setReports((items) => items.map((item) => item.id === id ? { ...item, ...data } : item)) } catch (caught) { setError(caught.message) } }
  const saveSettings = async (event) => { event.preventDefault(); try { const data = await apiFetch('/admin/settings', { method: 'PATCH', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); setSettings(Object.fromEntries(data.map((item) => [item.key, item.value]))); setError('Settings saved.') } catch (caught) { setError(caught.message) } }
  const logout = () => { authStorage.removeItem('adminToken'); window.location.href = '/admin/login' }
  const pending = reports.filter((item) => item.status === 'pending').length

  return <section className="admin-dashboard">
    <div className="admin-topbar"><div><p className="admin-kicker">ADMIN CENTER</p><h1>Dashboard</h1><p className="admin-subtitle">Manage your community in one place.</p></div><div className="admin-dashboard-actions"><Link to="/" className="admin-home">View site</Link><button className="admin-logout-top" onClick={logout}>Log out</button></div></div>
    <div className="admin-tabs"><button className={tab === 'dashboard' ? 'selected' : ''} onClick={() => setTab('dashboard')}>Dashboard</button><button className={tab === 'reports' ? 'selected' : ''} onClick={() => setTab('reports')}>Reports <b>{pending}</b></button><button className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}>Settings</button></div>
    {error && <p className="admin-posts-message">{error}</p>}
    {tab === 'dashboard' && <><div className="dashboard-metrics"><div><small>Posts</small><strong>{metrics.posts}</strong></div><div><small>Comments</small><strong>{metrics.comments}</strong></div><div><small>Users</small><strong>{metrics.users}</strong></div><div><small>Total views</small><strong>{metrics.views}</strong></div></div><div className="dashboard-grid"><section className="dashboard-panel"><h2>Recent posts</h2>{loading ? <p className="dashboard-empty">Loading...</p> : posts.map((post) => <Link className="dashboard-post" to={'/board/' + post.id} key={post.id}><span className="dashboard-dot" /><div><strong>{post.title}</strong><small>{post.author || 'User'} · {date(post.created_at)}</small></div><em>{post.views || 0} views</em></Link>)}</section><section className="dashboard-panel"><h2>Recent comments</h2>{comments.map((comment) => <div className="dashboard-comment" key={comment.id}><strong>{comment.author || 'User'}</strong><p>{comment.content}</p><small>{date(comment.created_at)}</small></div>)}</section></div></>}
    {tab === 'reports' && <section className="dashboard-panel admin-report-panel"><div className="dashboard-panel-head"><div><h2>Report management</h2><p>Review reported posts and comments.</p></div><button onClick={load}>Refresh</button></div>{reports.length ? reports.map((report) => <div className="admin-report-row" key={report.id}><div><strong>{report.target_type} #{report.target_id}</strong><p>{report.reason}</p><small>Reported by {report.reporter || 'User'} · {date(report.created_at)}</small></div><select value={report.status} onChange={(event) => updateReport(report.id, event.target.value)}><option value="pending">Pending</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></div>) : <p className="dashboard-empty">No reports.</p>}</section>}
    {tab === 'settings' && <form className="dashboard-panel admin-settings" onSubmit={saveSettings}><h2>Site settings</h2><label>Site name<input value={settings.site_name || ''} onChange={(event) => setSettings({ ...settings, site_name: event.target.value })} /></label><label>Description<textarea rows="4" value={settings.site_description || ''} onChange={(event) => setSettings({ ...settings, site_description: event.target.value })} /></label><label className="setting-check"><input type="checkbox" checked={settings.maintenance_mode === 'true'} onChange={(event) => setSettings({ ...settings, maintenance_mode: String(event.target.checked) })} /> Maintenance mode</label><button className="admin-button">Save settings</button></form>}
  </section>
}
