import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'
import { attachmentHeaders, fileSize } from './attachmentApi.js'
import './attachments.css'

export function AttachmentCard({ file }) {
  return <figure className="attachment-card">
    {file.mime_type.startsWith('image/') && <a href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={file.original_name} loading="lazy" /></a>}
    {file.mime_type.startsWith('video/') && <video controls playsInline preload="metadata" src={file.url} aria-label={file.original_name} />}
    <figcaption><span>{file.original_name} · {fileSize(file.size_bytes)}</span><a href={file.download_url} target="_blank" rel="noreferrer">다운로드</a></figcaption>
  </figure>
}
export default function PostAttachments({ postId }) {
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true); setError('')
    try { setFiles(await apiFetch(`/posts/${postId}/attachments`, { headers: attachmentHeaders() })) }
    catch (caught) { setError(caught.message); setFiles([]) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    const controller = new AbortController()
    apiFetch(`/posts/${postId}/attachments`, { headers: attachmentHeaders(), signal: controller.signal }).then(setFiles).catch(caught => { if (caught.name !== 'AbortError') setError(caught.message) })
    return () => controller.abort()
  }, [postId])
  if (!files.length && !error) return null
  return <section className="post-attachments" aria-label="게시글 첨부파일"><h2>첨부파일</h2>{error && <p role="alert">{error}</p>}<div className="attachment-grid">{files.map(file => <AttachmentCard key={file.id} file={file} />)}</div><button className="outline" type="button" disabled={busy} onClick={load}>첨부 링크 새로고침</button><small>파일이 열리지 않으면 링크를 새로고침해주세요.</small></section>
}
