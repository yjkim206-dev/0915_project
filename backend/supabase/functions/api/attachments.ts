import type { SupabaseClient, User } from 'jsr:@supabase/supabase-js@2'
const bucket = 'post-attachments'
const fields = 'id,post_id,original_name,mime_type,size_bytes,position,object_path'
const types: Record<string, [string, number]> = {
  'image/jpeg': ['jpg', 10], 'image/png': ['png', 10], 'image/webp': ['webp', 10], 'image/gif': ['gif', 10], 'image/avif': ['avif', 10],
  'video/mp4': ['mp4', 50], 'video/webm': ['webm', 50], 'video/quicktime': ['mov', 50],
  'application/pdf': ['pdf', 20], 'text/plain': ['txt', 20], 'application/zip': ['zip', 20],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx', 20],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx', 20],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx', 20],
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } })
function checked(result: { error: unknown }) { if (result.error) throw new Error('Attachment database or storage operation failed') }
async function signed(db: SupabaseClient, rows: any[]) {
  return await Promise.all(rows.map(async row => {
    const preview = await db.storage.from(bucket).createSignedUrl(row.object_path, 300); checked(preview)
    const download = await db.storage.from(bucket).createSignedUrl(row.object_path, 300, { download: row.original_name }); checked(download)
    const { object_path: _path, ...safe } = row
    return { ...safe, url: preview.data!.signedUrl, download_url: download.data!.signedUrl }
  }))
}
function validMagic(bytes: Uint8Array, mime: string) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  if (mime === 'image/avif') return ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 64))
  if (mime === 'video/mp4' || mime === 'video/quicktime') return ascii(4, 8) === 'ftyp' && !/avif|avis|heic/.test(ascii(8, 12))
  if (mime === 'video/webm') return [26, 69, 223, 163].every((value, index) => bytes[index] === value)
  if (mime === 'application/pdf') return ascii(0, 5) === '%PDF-'
  if (mime === 'application/zip' || mime.includes('openxmlformats')) return ascii(0, 2) === 'PK' && [3, 5, 7].includes(bytes[2])
  if (mime === 'text/plain') { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true }); return !bytes.includes(0) } catch { return false } }
  return false
}
async function magic(db: SupabaseClient, path: string, mime: string) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const url = Deno.env.get('SUPABASE_URL') + '/storage/v1/object/authenticated/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/')
  const result = await fetch(url, { headers: { Authorization: `Bearer ${key}`, apikey: key, Range: 'bytes=0-511' }, signal: AbortSignal.timeout(15000) })
  if (!result.ok || !result.body) throw new Error('Cannot verify uploaded attachment')
  const reader = result.body.getReader(); const bytes = new Uint8Array(512); let length = 0
  try { while (length < 512) { const chunk = await reader.read(); if (chunk.done) break; const part = chunk.value.slice(0, 512 - length); bytes.set(part, length); length += part.length } }
  finally { await reader.cancel() }
  return validMagic(bytes.slice(0, length), mime)
}
export async function cleanupAttachments(db: SupabaseClient) {
  checked(await db.from('post_attachments').delete().is('post_id', null).lt('created_at', new Date(Date.now() - 86400000).toISOString()))
  const queued = await db.from('attachment_delete_queue').select('*').lte('next_attempt_at', new Date().toISOString()).limit(100); checked(queued)
  if (!queued.data?.length) return
  checked(await db.storage.from(bucket).remove(queued.data.map(item => item.object_path)))
  for (const item of queued.data) {
    if (new Date(item.recheck_until) <= new Date()) checked(await db.from('attachment_delete_queue').delete().eq('object_path', item.object_path))
    else checked(await db.from('attachment_delete_queue').update({ next_attempt_at: new Date(Date.now() + 300000).toISOString() }).eq('object_path', item.object_path))
  }
}
export async function saveAttachedPost(db: SupabaseClient, user: User, input: any, postId: number | null) {
  if (input.attachmentIds !== undefined && (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > 10 || input.attachmentIds.some((id: unknown) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))) return json({ message: '첨부파일 목록이 올바르지 않습니다.' }, 400)
  const result = await db.rpc('save_post_attachments', {
    p_actor: user.id, p_post: postId, p_title: String(input.title || '').trim(), p_content: String(input.content || '').trim(),
    p_category: String(input.category || '자유').trim() || '자유', p_ids: input.attachmentIds ?? null,
  })
  if (result.error) {
    if (['P0001', '22P02'].includes(result.error.code)) return json({ message: '제목·내용 또는 첨부파일을 확인해주세요. 첨부는 최대 10개, 합계 200MB까지 가능합니다.' }, 400)
    throw new Error('Cannot save post and attachments')
  }
  // Queue processing is retried by cron if a transient Storage error occurs.
  try { await cleanupAttachments(db) } catch { console.error('Attachment cleanup will retry') }
  const post = await db.from('post_list').select('*').eq('id', result.data).single(); checked(post)
  return json(post.data, postId ? 200 : 201)
}
export async function handleAttachments(path: string, method: string, request: Request, db: SupabaseClient, requiredUser: (request: Request) => Promise<User>, readablePost: (id: number, request: Request) => Promise<boolean>, secret: string) {
  if (path === '/internal/attachments/cleanup') {
    if (method !== 'POST' || !secret || request.headers.get('x-subscription-cron-secret') !== secret) return json({ message: '접근할 수 없습니다.' }, 403)
    await cleanupAttachments(db); return json({ status: 'ok' })
  }
  const postMatch = path.match(/^\/posts\/(\d+)\/attachments$/)
  if (postMatch && method === 'GET') {
    if (!await readablePost(Number(postMatch[1]), request)) return json({ message: '게시글을 찾을 수 없습니다.' }, 404)
    const rows = await db.from('post_attachments').select(fields).eq('post_id', Number(postMatch[1])).eq('status', 'ready').order('position'); checked(rows)
    return json(await signed(db, rows.data || []))
  }
  if (!path.startsWith('/attachments/')) return null
  const user = await requiredUser(request)
  if (path === '/attachments/uploads' && method === 'POST') {
    const input = await request.json(); const mime = String(input.mime_type || '').toLowerCase(); const size = Number(input.size_bytes)
    const name = String(input.name || '').replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 200)
    const allowed = types[mime]
    if (!allowed || !name || !Number.isSafeInteger(size) || size < 1 || size > allowed[1] * 1024 * 1024) return json({ message: '지원하지 않는 파일이거나 용량을 초과했습니다. 이미지 10MB, 영상 50MB, 문서 20MB까지 가능합니다.' }, 400)
    const id = crypto.randomUUID(); const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
    const path = `${date}/${user.id}/${id}.${allowed[0]}`
    const reserved = await db.rpc('reserve_post_attachment', { p_actor: user.id, p_id: id, p_path: path, p_name: name, p_mime: mime, p_size: size })
    if (reserved.error?.code === 'P0001') return json({ message: '작성 중인 첨부파일이 너무 많습니다. 기존 파일을 삭제하거나 나중에 다시 시도해주세요.' }, 429)
    checked(reserved)
    const upload = await db.storage.from(bucket).createSignedUploadUrl(path, { upsert: false }); checked(upload)
    return json({ id, upload_url: upload.data!.signedUrl }, 201)
  }
  const match = path.match(/^\/attachments\/([a-f0-9-]{36})(\/complete)?$/)
  if (!match) return json({ message: '첨부 API가 없습니다.' }, 404)
  const row = await db.from('post_attachments').select('*').eq('id', match[1]).eq('owner_id', user.id).maybeSingle(); checked(row)
  if (!row.data) return json({ message: '첨부파일을 찾을 수 없습니다.' }, 404)
  const item = row.data
  if (match[2] && method === 'POST') {
    if (item.status !== 'ready') {
      const metadata = await db.rpc('attachment_object_metadata', { p_path: item.object_path }); checked(metadata)
      if (!metadata.data || Number(metadata.data.size) !== Number(item.size_bytes) || metadata.data.mimetype?.split(';')[0] !== item.mime_type || !await magic(db, item.object_path, item.mime_type)) {
        checked(await db.from('post_attachments').delete().eq('id', item.id).is('post_id', null))
        try { await cleanupAttachments(db) } catch { /* retry by cron */ }
        return json({ message: '업로드한 파일의 형식 또는 크기가 일치하지 않습니다.' }, 400)
      }
      checked(await db.from('post_attachments').update({ status: 'ready' }).eq('id', item.id).eq('status', 'pending'))
    }
    return json((await signed(db, [item]))[0])
  }
  if (!match[2] && method === 'DELETE') {
    if (item.post_id) return json({ message: '게시글 수정에서 첨부파일을 제거한 후 저장해주세요.' }, 409)
    checked(await db.from('post_attachments').delete().eq('id', item.id).eq('owner_id', user.id).is('post_id', null))
    try { await cleanupAttachments(db) } catch { /* retry by cron */ }
    return json({ deleted: true })
  }
  return json({ message: '지원하지 않는 요청입니다.' }, 405)
}
