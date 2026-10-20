import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api.js'
import { authStorage } from './authStorage.js'
import './backups.css'

const headers = () => ({ Authorization: `Bearer ${authStorage.getItem('adminToken')}`, 'Content-Type': 'application/json' })
const date = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'
const size = value => `${(Number(value || 0) / 1024 / 1024).toFixed(2)} MB`
const status = { running: '진행 중', completed: '완료', failed: '실패', deleting: '보관 만료·정리 중', deleted: '보관 만료·삭제 완료' }
export default function AdminBackups() {
  const [data, setData] = useState(null)
  const [settings, setSettings] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloads, setDownloads] = useState(null)
  const [page, setPage] = useState(0)
  const load = useCallback(async (initialize = false) => {
    const value = await apiFetch(`/admin/backups?page=${page}`, { headers: headers() })
    setData(value)
    if (initialize) setSettings({ ...value.settings, time_kst: value.settings.time_kst.slice(0, 5) })
  }, [page])
  useEffect(() => {
    let active = true
    apiFetch(`/admin/backups?page=${page}`, { headers: headers() }).then(value => {
      if (!active) return
      setData(value); setSettings(current => current || { ...value.settings, time_kst: value.settings.time_kst.slice(0, 5) })
    }).catch(error => active && setMessage(error.message))
    const timer = setInterval(() => { if (active) load().catch(error => setMessage(error.message)) }, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [page, load])
  const action = async (path, body) => {
    setBusy(true); setMessage('')
    try {
      const result = await apiFetch(path, { method: body ? 'PATCH' : 'POST', headers: headers(), ...(body ? { body: JSON.stringify(body) } : {}) })
      setMessage(result.message || '백업 설정을 저장했습니다. 변경한 보관 기간은 새 백업부터 적용됩니다.')
      await load(Boolean(body))
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  const files = async (run, page = 0) => {
    setBusy(true)
    try { setDownloads({ ...await apiFetch(`/admin/backups/${run}/files?page=${page}`, { headers: headers() }), run, page }) }
    catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  const change = (key, value) => setSettings(current => ({ ...current, [key]: value }))
  return <section className="dashboard-panel backup-panel">
    <h2>서비스 백업</h2>
    <p>DB·회원 계정·업로드 파일을 비공개 Supabase Storage에 저장합니다. DB 파일은 암호화됩니다. 소스코드는 GitHub에서 관리합니다.</p>
    {message && <p role="status" className="profile-message">{message}</p>}
    {data && settings && <>
      {!data.configured && <p role="alert">서버의 백업 암호화 키 설정이 필요합니다.</p>}
      <form className="admin-settings backup-fields" onSubmit={event => { event.preventDefault(); action('/admin/backups/settings', settings) }}>
        <label><span>자동 백업 사용</span><input type="checkbox" checked={settings.enabled} onChange={event => change('enabled', event.target.checked)} /></label>
        <label>백업 주기<select value={settings.frequency} onChange={event => change('frequency', event.target.value)}>
          <option value="daily">일별</option><option value="weekly">주별</option><option value="monthly">월별</option><option value="quarterly">분기별</option><option value="yearly">년별</option>
        </select></label>
        {settings.frequency === 'weekly' && <label>실행 요일<select value={settings.weekday} onChange={event => change('weekday', Number(event.target.value))}>{['일', '월', '화', '수', '목', '금', '토'].map((label, index) => <option key={label} value={index}>{label}요일</option>)}</select></label>}
        <label>실행 시각 (한국 시간)<input type="time" required value={settings.time_kst} onChange={event => change('time_kst', event.target.value)} /></label>
        <label>보관 기간 (년)<input type="number" min="1" max="10" required value={settings.retention_years} onChange={event => change('retention_years', Number(event.target.value))} /></label>
        <p>월별: 매월 1일 · 분기별: 1·4·7·10월 1일 · 년별: 매년 1월 1일. 예약 시각부터 약 1분 안에 시작하며, 파일 수에 따라 순차 처리됩니다.</p>
        <button className="admin-button" disabled={busy}>백업 설정 저장</button>
      </form>
      <div className="backup-summary"><p>다음 예약: <strong>{data.settings.enabled ? date(data.settings.next_run_at) : '자동 백업 중지'}</strong></p><p>백업 Storage 사용량: <strong>{size(data.usage?.storage_bytes)}</strong> ({data.usage?.storage_objects || 0}개 파일)</p></div>
      <p>보관 기간이 끝난 백업은 자동 삭제됩니다. 같은 프로젝트 안의 백업이므로 프로젝트 삭제에 대비한 외부 사본은 별도로 보관해주세요. 암호화 키는 서버 .env의 BACKUP_ENCRYPTION_KEY이며, 분실하면 DB 백업을 복호화할 수 없습니다.</p>
      <button type="button" className="admin-button" disabled={busy || !data.configured || data.runs.some(run => run.status === 'running')} onClick={() => action('/admin/backups/run')}>지금 전체 백업 실행</button>
      <h3>실행 이력 ({page + 1}페이지)</h3>
      {!data.runs.length && <p>아직 백업 이력이 없습니다.</p>}
      <div className="backup-history">{data.runs.map(run => <article key={run.id}>
        <strong>{status[run.status]} · {run.trigger_type === 'manual' ? '수동' : '예약'}</strong>
        <p>시작 {date(run.created_at)} · 완료 {date(run.completed_at)}</p>
        <p>{run.completed_items}/{run.total_items}개 · {size(run.bytes)} · 보관 만료 {date(run.expires_at)}</p>
        {run.status === 'running' && <progress value={run.completed_items} max={Math.max(1, run.total_items)} aria-label="백업 진행률" />}
        {run.error && <p role="alert">{run.error}</p>}
        {run.status === 'completed' && <button type="button" className="admin-action" disabled={busy} onClick={() => files(run.id)}>백업 파일·명세서 받기</button>}
      </article>)}</div>
      <div className="backup-pagination"><button type="button" className="admin-action" disabled={busy || page === 0} onClick={() => setPage(current => current - 1)}>이전 이력</button><button type="button" className="admin-action" disabled={busy || !data.has_more} onClick={() => setPage(current => current + 1)}>다음 이력</button></div>
      {downloads && <section className="backup-downloads"><h3>백업 파일 목록</h3><p>다운로드 링크는 60초간 유효합니다. 만료되면 파일 목록을 다시 열어주세요.</p>{downloads.files.map(file => <a key={file.path} href={file.url} target="_blank" rel="noreferrer">{file.path} ({size(file.bytes)})</a>)}<div>{downloads.page > 0 && <button type="button" disabled={busy} onClick={() => files(downloads.run, downloads.page - 1)}>이전</button>}{downloads.has_more && <button type="button" disabled={busy} onClick={() => files(downloads.run, downloads.page + 1)}>다음</button>}<button type="button" onClick={() => setDownloads(null)}>닫기</button></div></section>}
    </>}
  </section>
}
