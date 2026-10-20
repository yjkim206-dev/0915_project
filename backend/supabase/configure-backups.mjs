// Run from the repository with a project-scoped management token in ignored .env.
// Generates the encryption key once, provisions a private bucket and the migration.
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
const envFile = new URL('../../.env', import.meta.url)
let source = readFileSync(envFile, 'utf8')
const env = Object.fromEntries(source.split(/\r?\n/).map(line => line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/)).filter(Boolean).map(match => [match[1], match[2].replace(/^['"]|['"]$/g, '')]))
const ref = 'ymprvqsfpwvoutwozwvn'
if (env.SUPABASE_PROJECT_REF !== ref || !env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Project credentials are unavailable or mismatched')
const key = env.BACKUP_ENCRYPTION_KEY || randomBytes(48).toString('hex')
if (!/^[a-f0-9]{96}$/.test(key)) throw new Error('BACKUP_ENCRYPTION_KEY must be a 48-byte random hex key')
if (!env.BACKUP_ENCRYPTION_KEY) {
  source = source.trimEnd() + '\nBACKUP_ENCRYPTION_KEY=' + key + '\n'
  writeFileSync(envFile, source)
}
async function management(path, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`Management request ${path} failed (${res.status}): ${path === '/database/query' ? (await res.text()).slice(0, 700) : 'check project access'}`)
  const text = await res.text(); return text ? JSON.parse(text) : null
}
await management('/secrets', [{ name: 'BACKUP_ENCRYPTION_KEY', value: key }])
const migration = readFileSync(new URL('./migrations/024_service_backups.sql', import.meta.url), 'utf8')
const applied = await management('/database/query', { query: "select version from supabase_migrations.schema_migrations where version='024'" })
if (!applied.length) await management('/database/query', { query: `begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('024','service_backups',array[$backup_migration$${migration}$backup_migration$]);\nnotify pgrst,'reload schema';\ncommit;` })
await management('/database/query', { query: "update public.backup_settings set next_run_at=((date_trunc('day',now() at time zone 'Asia/Seoul')+interval '3 hours'+case when (now() at time zone 'Asia/Seoul')::time >= time '03:00' then interval '1 day' else interval '0 day' end) at time zone 'Asia/Seoul') where next_run_at is null and enabled;" })
const storageUrl = `https://${ref}.supabase.co/storage/v1/bucket`
const storageHeaders = { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
let bucket = await fetch(storageUrl + '/service-backups', { headers: storageHeaders })
if (bucket.status === 404 || bucket.status === 400) {
  bucket = await fetch(storageUrl, { method: 'POST', headers: storageHeaders, body: JSON.stringify({ id: 'service-backups', name: 'service-backups', public: false }) })
} else if (bucket.ok) {
  bucket = await fetch(storageUrl + '/service-backups', { method: 'PUT', headers: storageHeaders, body: JSON.stringify({ public: false }) })
}
if (!bucket.ok) throw new Error(`Private backup bucket setup failed (${bucket.status})`)
const status = await management('/database/query', { query: "select (select public from storage.buckets where id='service-backups') as bucket_public,(select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active)) from cron.job where jobname='moa-service-backups') as jobs,(select row_to_json(s) from public.backup_settings s) as settings,(select count(*) from pg_policies where schemaname='storage' and tablename='objects') as storage_policy_count" })
console.log(JSON.stringify({ configured: true, encryptionKey: 'stored in ignored .env and Edge secrets; not displayed', status }))
