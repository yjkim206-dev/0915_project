import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/).map(line => line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/)).filter(Boolean).map(match => [match[1], match[2].replace(/^['"]|['"]$/g, '')]))
const ref = 'ymprvqsfpwvoutwozwvn'
if (env.SUPABASE_PROJECT_REF !== ref || !env.SUPABASE_ACCESS_TOKEN) throw new Error('Project credentials mismatch')
async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(90000) })
  if (!response.ok) throw new Error(`Shop migration failed (${response.status}): ${(await response.text()).slice(0, 500)}`)
  return await response.json()
}
if (!(await sql("select version from supabase_migrations.schema_migrations where version='027'")).length) {
  const migration = readFileSync(new URL('./migrations/027_shop_categories.sql', import.meta.url), 'utf8')
  await sql(`begin;\n${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('027','shop_categories',array[$shop_categories_migration$${migration}$shop_categories_migration$]);\nnotify pgrst,'reload schema';\ncommit;`)
}
console.log(JSON.stringify({ configured: true, categories: await sql('select id,name,category_type,sort_order,is_active from public.shop_categories order by sort_order') }))
