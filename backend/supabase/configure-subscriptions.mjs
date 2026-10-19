// Provision a private scheduler secret in the project .env, Supabase Edge
// secrets and Vault. Never print the secret or commit the project .env.
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
const file = new URL('../../.env', import.meta.url)
let source = readFileSync(file, 'utf8')
const env = {}
for (const line of source.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const ref = 'ymprvqsfpwvoutwozwvn'
if (env.SUPABASE_PROJECT_REF !== ref || !env.SUPABASE_ACCESS_TOKEN) throw new Error('Deployment project/token mismatch.')
const secret = env.SUBSCRIPTION_CRON_SECRET || randomBytes(32).toString('hex')
if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Scheduler secret must be a random 32-byte hex value.')
const line = 'SUBSCRIPTION_CRON_SECRET=' + secret
source = /^SUBSCRIPTION_CRON_SECRET=.*$/m.test(source) ? source.replace(/^SUBSCRIPTION_CRON_SECRET=.*$/m, line) : source.trimEnd() + '\n' + line + '\n'
writeFileSync(file, source)
async function management(path, body) {
  const response = await fetch('https://api.supabase.com/v1/projects/' + ref + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
  })
  if (!response.ok) throw new Error('Scheduler configuration request failed: ' + response.status + ' ' + path)
  const text = await response.text(); return text ? JSON.parse(text) : null
}
await management('/secrets', [{ name: 'SUBSCRIPTION_CRON_SECRET', value: secret }])
await management('/database/query', { query: `do $$ declare v_id uuid; begin
  select id into v_id from vault.secrets where name='moa_subscription_cron_secret' limit 1;
  if v_id is null then perform vault.create_secret('${secret}','moa_subscription_cron_secret');
  else perform vault.update_secret(v_id,'${secret}','moa_subscription_cron_secret'); end if;
end $$;` })
const jobs = await management('/database/query', { query: "select jobname,schedule,active from cron.job where jobname='moa-subscription-renewals'" })
if (!jobs?.[0]?.active) throw new Error('Subscription cron job is not active.')
console.log(JSON.stringify({ schedulerConfigured: true, secretStoredInEdgeAndVault: true, job: jobs[0] }))
