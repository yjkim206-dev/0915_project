import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const bucket = 'service-backups'
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
})
function check(result: { error: unknown }) { if (result.error) throw new Error('Backup storage or database operation failed') }
export function nextBackup(settings: any, after = new Date()) {
  const local = new Date(after.getTime() + 9 * 3600000)
  const [hour, minute] = settings.time_kst.split(':').map(Number)
  for (let offset = 0; offset < 370; offset++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset, hour, minute))
    const eligible = settings.frequency === 'daily'
      || settings.frequency === 'weekly' && day.getUTCDay() === settings.weekday
      || settings.frequency === 'monthly' && day.getUTCDate() === 1
      || settings.frequency === 'quarterly' && day.getUTCDate() === 1 && day.getUTCMonth() % 3 === 0
      || settings.frequency === 'yearly' && day.getUTCDate() === 1 && day.getUTCMonth() === 0
    const utc = new Date(day.getTime() - 9 * 3600000)
    if (eligible && utc > after) return utc.toISOString()
  }
  throw new Error('Invalid backup schedule')
}
async function settingsOf(db: SupabaseClient) {
  const result = await db.from('backup_settings').select('*').eq('id', true).single(); check(result)
  return result.data!
}
async function begin(db: SupabaseClient, trigger: string, settings: any, key: string) {
  const result = await db.rpc('backup_start', { p_key: key, p_trigger: trigger, p_next: trigger === 'scheduled' ? nextBackup(settings) : null })
  check(result); return result.data
}
async function expireBackups(db: SupabaseClient) {
  // Each tick removes one batch; long runs do not exhaust an Edge invocation.
  const result = await db.from('backup_runs').select('id,prefix,status').or(`and(status.eq.completed,expires_at.lt.${new Date().toISOString()}),and(status.eq.failed,expires_at.lt.${new Date().toISOString()}),status.eq.deleting`).order('created_at').limit(1)
  check(result)
  const run = result.data?.[0]; if (!run) return
  check(await db.from('backup_runs').update({ status: 'deleting' }).eq('id', run.id))
  const batch = await db.from('backup_items').select('id,destination').eq('run_id', run.id).limit(100); check(batch)
  if (batch.data?.length) {
    check(await db.storage.from(bucket).remove(batch.data.map(item => item.destination)))
    check(await db.from('backup_items').delete().in('id', batch.data.map(item => item.id)))
  } else {
    check(await db.storage.from(bucket).remove([`${run.prefix}/manifest.json`]))
    check(await db.from('backup_runs').update({ status: 'deleted', manifest: null }).eq('id', run.id))
  }
}
async function work(db: SupabaseClient, key: string) {
  if (key.length < 40) return response({ message: '백업 암호화 키가 서버에 설정되지 않았습니다.' }, 503)
  const settings = await settingsOf(db)
  if (settings.enabled && (!settings.next_run_at || new Date(settings.next_run_at) <= new Date())) await begin(db, 'scheduled', settings, key)
  const claim = await db.rpc('backup_claim'); check(claim)
  const job = claim.data
  if (!job) { await expireBackups(db); return response({ status: 'idle' }) }
  const { run, token, items } = job
  try {
    for (const item of items) {
      if (item.kind === 'database') {
        const bytes = Uint8Array.from(atob(item.payload.replace(/\s/g, '')), c => c.charCodeAt(0))
        check(await db.storage.from(bucket).upload(item.destination, bytes, { contentType: 'application/octet-stream', upsert: true }))
      } else {
        const before = await db.rpc('backup_storage_version', { p_bucket: item.source_bucket, p_path: item.source_path }); check(before)
        if (!before.data || before.data !== item.source_version) throw new Error('Source file changed during backup; create a new snapshot')
        const copied = await db.storage.from(item.source_bucket).copy(item.source_path, item.destination, { destinationBucket: bucket })
        if (copied.error) {
          // A retry may find the destination of an interrupted previous attempt.
          if (!['409', 'Duplicate', 'ResourceAlreadyExists'].includes(String((copied.error as any).statusCode)) && !/already exists|duplicate/i.test(copied.error.message)) check(copied)
        }
        const after = await db.rpc('backup_storage_version', { p_bucket: item.source_bucket, p_path: item.source_path }); check(after)
        if (before.data !== after.data) throw new Error('Source file changed during backup; create a new snapshot')
      }
      check(await db.rpc('backup_finish_item', { p_run: run.id, p_token: token, p_item: item.id }))
    }
    const pending = await db.from('backup_items').select('id', { count: 'exact', head: true }).eq('run_id', run.id).eq('completed', false); check(pending)
    if (pending.count === 0) {
      // Build a paginated manifest, including hashes and the original Storage paths.
      const entries: any[] = []
      for (let page = 0; ; page++) {
        const part = await db.from('backup_items').select('kind,destination,source_bucket,source_path,source_version,sha256,bytes').eq('run_id', run.id).order('id').range(page * 500, page * 500 + 499); check(part)
        entries.push(...part.data!); if (part.data!.length < 500) break
      }
      const tables = [...new Set(entries.filter(item => item.kind === 'database').map(item => item.destination.split('/database/')[1].split('/')[0]))]
      const manifest = { ...run.manifest, tables, run_id: run.id, completed_at: new Date().toISOString(), expires_at: run.expires_at, items: entries }
      check(await db.storage.from(bucket).upload(`${run.prefix}/manifest.json`, JSON.stringify(manifest), { contentType: 'application/json', upsert: true }))
      check(await db.from('backup_runs').update({ status: 'completed', completed_at: manifest.completed_at, lease_until: null }).eq('id', run.id).eq('lease_token', token))
      // Encrypted staging data is no longer needed once every item is in Storage.
      check(await db.from('backup_items').update({ payload: null }).eq('run_id', run.id))
    } else check(await db.from('backup_runs').update({ lease_until: null }).eq('id', run.id).eq('lease_token', token))
    await expireBackups(db)
    return response({ status: 'processed', run_id: run.id, items: items.length })
  } catch (caught) {
    console.error('Backup worker failed', run.id, caught instanceof Error ? caught.message : 'unknown')
    // Preserve partial files and report failure; never advertise a partial backup as complete.
    const failed = await db.from('backup_runs').update({ status: 'failed', error: '백업 처리에 실패했습니다. Storage 용량·원본 파일 변경·서버 로그를 확인하고 다시 실행해주세요.', lease_until: null }).eq('id', run.id).eq('lease_token', token).eq('status', 'running').select('id')
    if (failed.data?.length) await db.from('backup_items').update({ payload: null }).eq('run_id', run.id)
    return response({ status: 'failed', run_id: run.id }, 500)
  }
}
export async function handleBackups(path: string, method: string, request: Request, db: SupabaseClient, adminUser: (request: Request) => Promise<unknown>, secret: string) {
  const key = Deno.env.get('BACKUP_ENCRYPTION_KEY') || ''
  if (path === '/internal/backups/tick') {
    if (method !== 'POST' || !secret || request.headers.get('x-subscription-cron-secret') !== secret) return response({ message: '접근할 수 없습니다.' }, 403)
    return await work(db, key)
  }
  await adminUser(request)
  if (path === '/admin/backups' && method === 'GET') {
    const page = Number(new URL(request.url).searchParams.get('page') || '0')
    if (!Number.isSafeInteger(page) || page < 0) return response({ message: '잘못된 페이지입니다.' }, 400)
    const settings = await settingsOf(db)
    const result = await db.from('backup_runs').select('id,status,trigger_type,created_at,completed_at,expires_at,total_items,completed_items,bytes,error').order('created_at', { ascending: false }).range(page * 50, page * 50 + 49); check(result)
    const usage = await db.rpc('backup_usage'); check(usage)
    return response({ settings, runs: result.data, has_more: result.data!.length === 50, usage: usage.data, configured: key.length >= 40 })
  }
  if (path === '/admin/backups/settings' && method === 'PATCH') {
    const body = await request.json()
    if (typeof body.enabled !== 'boolean' || !['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(body.frequency)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time_kst) || !Number.isInteger(body.weekday) || body.weekday < 0 || body.weekday > 6
      || !Number.isInteger(body.retention_years) || body.retention_years < 1 || body.retention_years > 10) return response({ message: '백업 설정값을 확인해주세요.' }, 400)
    const value = { enabled: body.enabled, frequency: body.frequency, time_kst: body.time_kst, weekday: body.weekday, retention_years: body.retention_years, updated_at: new Date().toISOString() }
    const result = await db.from('backup_settings').update({ ...value, next_run_at: body.enabled ? nextBackup(value) : null }).eq('id', true).select().single(); check(result)
    return response(result.data)
  }
  if (path === '/admin/backups/run' && method === 'POST') {
    if (key.length < 40) return response({ message: '백업 암호화 키가 서버에 설정되지 않았습니다.' }, 503)
    const id = await begin(db, 'manual', await settingsOf(db), key)
    return response({ id, message: '백업을 접수했습니다. 예약 작업이 순차적으로 저장합니다.' }, 202)
  }
  const match = path.match(/^\/admin\/backups\/([a-f0-9-]{36})\/files$/)
  if (match && method === 'GET') {
    const job = await db.from('backup_runs').select('id,status,prefix').eq('id', match[1]).maybeSingle(); check(job)
    if (!job.data || job.data.status !== 'completed') return response({ message: '완료된 백업이 없습니다.' }, 404)
    const url = new URL(request.url); const page = Number(url.searchParams.get('page') || '0')
    if (!Number.isSafeInteger(page) || page < 0) return response({ message: '잘못된 페이지입니다.' }, 400)
    const result = await db.from('backup_items').select('destination,kind,bytes').eq('run_id', match[1]).order('id').range(page * 100, page * 100 + 99); check(result)
    const files = result.data!.map(item => ({ path: item.destination, kind: item.kind, bytes: item.bytes }))
    if (page === 0) files.unshift({ path: `${job.data.prefix}/manifest.json`, kind: 'manifest', bytes: 0 })
    const signed = await db.storage.from(bucket).createSignedUrls(files.map(item => item.path), 60, { download: true }); check(signed)
    return response({ files: files.map((file, index) => ({ ...file, url: signed.data![index].signedUrl })), has_more: result.data!.length === 100 })
  }
  return response({ message: '요청한 백업 API가 없습니다.' }, 404)
}
