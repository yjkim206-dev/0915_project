import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from './api.js'
import { SUPABASE_URL } from './deploymentConfig.js'
import { AttachmentCard } from './PostAttachments.jsx'
import { attachmentHeaders, fileSize } from './attachmentApi.js'

const allowed = {
  jpg: ['image/jpeg', 10], jpeg: ['image/jpeg', 10], png: ['image/png', 10], webp: ['image/webp', 10], gif: ['image/gif', 10], avif: ['image/avif', 10],
  mp4: ['video/mp4', 50], webm: ['video/webm', 50], mov: ['video/quicktime', 50], pdf: ['application/pdf', 20], txt: ['text/plain', 20], zip: ['application/zip', 20],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 20], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 20], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 20],
}
function upload(url, file, mime, progress, signal) {
  if (new URL(url).origin !== new URL(SUPABASE_URL).origin) throw new Error('업로드 주소가 올바르지 않습니다.')
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const done = callback => { signal.removeEventListener('abort', abort); callback() }
    xhr.open('PUT', url); xhr.timeout = 300000
    xhr.setRequestHeader('x-upsert', 'false')
    if (import.meta.env.VITE_SUPABASE_ANON_KEY) xhr.setRequestHeader('apikey', import.meta.env.VITE_SUPABASE_ANON_KEY)
    xhr.upload.onprogress = event => event.lengthComputable && progress(Math.round(event.loaded / event.total * 100))
    xhr.onload = () => done(() => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('파일 업로드에 실패했습니다. 다시 선택해주세요.')))
    xhr.onerror = () => done(() => reject(new Error('네트워크 오류로 업로드하지 못했습니다.')))
    xhr.ontimeout = () => done(() => reject(new Error('업로드 시간이 초과되었습니다.')))
    xhr.onabort = () => done(() => reject(new DOMException('취소되었습니다.', 'AbortError')))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { signal.removeEventListener('abort', abort); reject(new DOMException('취소되었습니다.', 'AbortError')); return }
    const form = new FormData(); form.append('cacheControl', '300'); form.append('', new Blob([file], { type: mime }), file.name)
    xhr.send(form)
  })
}
export default function PostComposer({ post, onSave, currentUser }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(post?.title || '')
  const [content, setContent] = useState(post?.content || '')
  const [category, setCategory] = useState(post?.category || '자유')
  const [files, setFiles] = useState([])
  const [ready, setReady] = useState(!post)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const drafts = useRef(new Set())
  const active = useRef(true)
  const transfer = useRef(null)
  const postId = post?.id
  const load = async signal => {
    try { setFiles(await apiFetch(`/posts/${post.id}/attachments`, { headers: attachmentHeaders(), signal })); setReady(true); setError('') }
    catch (caught) { if (caught.name !== 'AbortError') setError(caught.message) }
  }
  useEffect(() => {
    active.current = true
    const controller = new AbortController()
    const pendingDrafts = drafts.current
    if (postId) apiFetch(`/posts/${postId}/attachments`, { headers: attachmentHeaders(), signal: controller.signal })
      .then(value => { setFiles(value); setReady(true); setError('') })
      .catch(caught => { if (caught.name !== 'AbortError') setError(caught.message) })
    return () => {
      active.current = false; controller.abort(); transfer.current?.abort()
      for (const id of pendingDrafts) apiFetch(`/attachments/${id}`, { method: 'DELETE', headers: attachmentHeaders(), keepalive: true }).catch(() => {})
    }
  }, [postId])
  const add = async event => {
    const selected = [...event.target.files]; event.target.value = ''
    if (!selected.length || busy) return
    setError('')
    if (files.length + selected.length > 10) { setError('게시글당 파일은 최대 10개입니다.'); return }
    let total = files.reduce((sum, file) => sum + Number(file.size_bytes), 0)
    const uploadList = []
    for (const file of selected) {
      const rule = allowed[file.name.split('.').pop().toLowerCase()]
      if (!rule || !file.size || file.size > rule[1] * 1024 * 1024) { setError(`${file.name}: 지원 형식과 용량을 확인해주세요.`); return }
      total += file.size; uploadList.push({ file, mime: rule[0] })
    }
    if (total > 200 * 1024 * 1024) { setError('첨부파일 합계는 200MB까지 가능합니다.'); return }
    setBusy(true)
    const controller = new AbortController(); transfer.current = controller
    try {
      for (const { file, mime } of uploadList) {
        const reserved = await apiFetch('/attachments/uploads', { method: 'POST', headers: attachmentHeaders(), body: JSON.stringify({ name: file.name, mime_type: mime, size_bytes: file.size }), signal: controller.signal })
        drafts.current.add(reserved.id)
        try {
          await upload(reserved.upload_url, file, mime, value => active.current && setProgress(`${file.name} · ${value}% (${fileSize(file.size)})`), controller.signal)
          const done = await apiFetch(`/attachments/${reserved.id}/complete`, { method: 'POST', headers: attachmentHeaders(), signal: controller.signal })
          if (active.current) setFiles(current => [...current, done])
        } catch (caught) {
          apiFetch(`/attachments/${reserved.id}`, { method: 'DELETE', headers: attachmentHeaders() }).catch(() => {})
          throw caught
        }
      }
    } catch (caught) { if (active.current && caught.name !== 'AbortError') setError(caught.message) }
    finally { if (active.current) { setBusy(false); setProgress('') } transfer.current = null }
  }
  const remove = async file => {
    if (busy) return
    if (!file.post_id) {
      try { await apiFetch(`/attachments/${file.id}`, { method: 'DELETE', headers: attachmentHeaders() }); drafts.current.delete(file.id) }
      catch (caught) { setError(caught.message); return }
    }
    setFiles(current => current.filter(item => item.id !== file.id))
  }
  const submit = async event => {
    event.preventDefault(); if (busy || !ready) return
    if (!content.trim() && !files.length) { setError('내용 또는 첨부파일을 추가해주세요.'); return }
    setBusy(true); setError('')
    try {
      await onSave({ title, content, category, attachmentIds: files.map(file => file.id) })
      drafts.current.clear(); navigate(post ? `/board/${post.id}` : '/board')
    } catch (caught) { setError(caught.message); setBusy(false) }
  }
  return <div className="container"><div className="title"><p className="eyebrow">COMMUNITY</p><h1>{post ? '게시글 수정' : '글 작성'}</h1><p>이야기와 사진, 영상을 함께 나눠보세요.</p></div><div className="post-compose">
    <form className="editor" onSubmit={submit}>
      <label>카테고리<select value={category} disabled={busy} onChange={event => setCategory(event.target.value)}><option>자유</option><option>개발</option><option>모임</option></select></label>
      <label>제목<input required maxLength={300} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
      <label>내용<textarea rows="10" maxLength={100000} value={content} disabled={busy} onChange={event => setContent(event.target.value)} /></label>
      <label className="attachment-input">이미지·영상·파일 첨부<input type="file" multiple accept={Object.keys(allowed).map(ext => `.${ext}`).join(',')} disabled={busy || !ready || files.length >= 10} onChange={add} /></label>
      <p className="attachment-help">최대 10개, 합계 200MB · 이미지 10MB · 영상 50MB · PDF/TXT/ZIP/Office 문서 20MB</p>
      {!ready && <p>기존 첨부파일을 불러오는 중입니다. <button type="button" className="outline" onClick={() => load()}>다시 불러오기</button></p>}
      {progress && <p role="status">{progress}<button type="button" className="outline" onClick={() => transfer.current?.abort()}>업로드 중지</button></p>}
      <div className="attachment-grid">{files.map(file => <div key={file.id}><AttachmentCard file={file} /><button className="outline" disabled={busy} type="button" onClick={() => remove(file)}>첨부 제거</button></div>)}</div>
      {error && <p className="profile-message" role="alert">{error}</p>}
      <div className="form-actions"><Link to={post ? `/board/${post.id}` : '/board'} className="outline">취소</Link><button className="button" disabled={busy || !ready}>{busy ? '처리 중…' : post ? '수정사항 저장' : '등록하기'}</button></div>
    </form>
    <article className="detail post-preview"><span className="eyebrow">PREVIEW</span><span className="category">{category}</span><h1>{title || '제목 미리보기'}</h1><div className="meta">{currentUser?.name || post?.author || '회원'}</div><hr /><p className="content">{content || '내용을 입력하면 미리 표시됩니다.'}</p><p>첨부파일 {files.length}개</p></article>
  </div></div>
}
