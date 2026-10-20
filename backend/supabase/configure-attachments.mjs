import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(source.split(/\r?\n/).map(line => line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/)).filter(Boolean).map(match => [match[1], match[2].replace(/^['"]|['"]$/g, '')]))
const ref = 'ymprvqsfpwvoutwozwvn'
if (env.SUPABASE_PROJECT_REF !== ref || !env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Project credentials mismatch')
async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Migration failed (${response.status}): ${(await response.text()).slice(0, 600)}`)
  return await response.json()
}
for (const [version, name] of [['025', 'post_attachments'], ['026', 'backup_snapshot_hardening']]) {
  if ((await sql(`select version from supabase_migrations.schema_migrations where version='${version}'`)).length) continue
  const migration = readFileSync(new URL(`./migrations/${version}_${name}.sql`, import.meta.url), 'utf8')
  await sql(`begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$storage_migration$${migration}$storage_migration$]);\nnotify pgrst,'reload schema';\ncommit;`)
}
const mimeTypes = ['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime','application/pdf','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation']
const url = `https://${ref}.supabase.co/storage/v1/bucket`
const headers = { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }
const existing = await fetch(url + '/post-attachments', { headers })
if (!existing.ok && ![400,404].includes(existing.status)) throw new Error(`Cannot inspect bucket (${existing.status})`)
const result = await fetch(existing.ok ? url + '/post-attachments' : url, { method: existing.ok ? 'PUT' : 'POST', headers, body: JSON.stringify({ ...(existing.ok ? {} : { id: 'post-attachments', name: 'post-attachments' }), public: false, file_size_limit: 52428800, allowed_mime_types: mimeTypes }) })
if (!result.ok) throw new Error(`Attachment bucket setup failed (${result.status})`)
console.log(JSON.stringify({ configured: true, status: await sql("select (select jsonb_agg(jsonb_build_object('name',id,'public',public,'file_size_limit',file_size_limit)) from storage.buckets where id in ('post-attachments','service-backups')) as buckets,(select jsonb_agg(jsonb_build_object('name',jobname,'active',active)) from cron.job where jobname in ('moa-service-backups','moa-attachment-cleanup')) as jobs,(select count(*) from pg_policies where schemaname='storage' and tablename='objects') as storage_policy_count") }))
