// Explicit, scoped checks against this project's deployment. No real payments,
// destructive SQL, credential guessing, external callbacks or user data dumps.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, delimiter } from 'node:path'
if (!process.argv.includes('--allow-remote-fixtures')) throw new Error('Remote fixture opt-in required')
const env = {}
for (const file of ['.env','frontend/.env.local']) {
  try { for (const line of readFileSync(file,'utf8').split(/\r?\n/)) { const m=line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/); if(m && !env[m[1]]) env[m[1]]=m[2].replace(/^['"]|['"]$/g,'') } } catch {}
}
assert.equal(env.SUPABASE_PROJECT_REF,'ymprvqsfpwvoutwozwvn')
const base = 'https://ymprvqsfpwvoutwozwvn.supabase.co'
const site = 'https://onboardproject.shop'
const api = base + '/functions/v1/api'
const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
assert.ok(anon && env.SUPABASE_SERVICE_ROLE_KEY)
const prefix = 'moa-security-' + randomUUID().slice(0,8)
const users = [], posts = [], checks = []
const check = (name,passed,details = {}) => { checks.push({name,passed,...details}); console.log(JSON.stringify(checks.at(-1))) }
async function request(url,{method='GET',token,key,body,headers={}}={}) {
  const response = await fetch(url,{method,headers:{ ...(key?{apikey:key}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers },body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)})
  const text=await response.text(); let data;try{data=JSON.parse(text)}catch{data=text}
  return {response,status:response.status,data,text}
}
async function service(path,body,method=body?'POST':'GET') {
  const r=await request(base+path,{method,key:env.SUPABASE_SERVICE_ROLE_KEY,token:env.SUPABASE_SERVICE_ROLE_KEY,body})
  assert.ok(r.status<300,'Fixture service failed: '+r.status+' '+path.split('?')[0]);return r.data
}
async function account(label) {
  const email=prefix+'-'+label+'@example.com',password=randomUUID()+'!9'
  const user=await service('/auth/v1/admin/users',{email,password,email_confirm:true,user_metadata:{name:prefix+'-'+label}});users.push(user.id)
  const r=await request(api+'/auth/login',{method:'POST',body:{email,password}})
  assert.equal(r.status,200);return {id:user.id,token:r.data.token}
}
try {
  const owner=await account('owner'),other=await account('other')
  check('real temporary account login',true)
  for(const email of ["' OR '1'='1' --",'admin@example.com\" OR 1=1 --']) {
    const r=await request(api+'/auth/login',{method:'POST',body:{email,password:'security-test-invalid-password'}})
    check('SQL-injection login cannot authenticate',[400,401,403].includes(r.status) && !r.data.token,{status:r.status})
  }
  for(const [name,token]of [['anonymous',null],['ordinary user',other.token],['forged JWT','eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.']]) {
    const r=await request(api+'/admin/users',{token})
    check(name+' cannot read admin users',[401,403].includes(r.status),{status:r.status})
  }
  const payload='</script><script>window.__moaSecurityXss=1</script><img src=x onerror=window.__moaSecurityXss=1>'
  const create=await request(api+'/posts',{method:'POST',token:owner.token,body:{title:prefix,content:'Temporary security audit content',author_id:other.id,role:'admin',is_hidden:false}})
  if(create.status!==201)console.log(JSON.stringify({createBlocked:create.status,message:typeof create.data==='string'?create.data.slice(0,160):create.data.message}))
  assert.equal(create.status,201);const post=create.data;posts.push(post.id)
  check('mass assignment cannot spoof post ownership',post.author_id===owner.id)
  const edit=await request(api+'/posts/'+post.id,{method:'PUT',token:other.token,body:{title:prefix+'-unauthorized',content:'should not be saved'}})
  check('other user cannot edit owned post',edit.status===403,{status:edit.status})
  const injected=await request(api+'/posts/'+post.id,{method:'PUT',token:owner.token,body:{title:prefix,content:payload}})
  if(injected.status===200){
    const literal=await request(api+'/posts/'+post.id)
    check('XSS input is stored as literal text',literal.data.content===payload)
    const html=await request(site+'/board/'+post.id)
    check('public HTML escapes stored script and event handlers',html.status===200&&!html.text.includes('<script>window.__moaSecurityXss=1')&&!html.text.includes('<img src=x onerror=window.__moaSecurityXss=1>')&&html.text.includes('&lt;script&gt;window.__moaSecurityXss=1'),{status:html.status})
    if(process.argv.includes('--browser')) {
      const require=createRequire(import.meta.url)
      const directory=process.env.PATH.split(delimiter).map(dir=>join(dir,'..','playwright')).find(dir=>existsSync(join(dir,'package.json')))
      assert.ok(directory,'Run --browser through npm exec --package=playwright')
      const browser=await require(directory).chromium.launch({channel:'msedge',headless:true})
      try {
        const page=await browser.newPage()
        await page.goto(site+'/board/'+post.id)
        await page.locator('.detail h1').filter({hasText:prefix}).waitFor()
        const literal=await page.locator('.detail .content').first().textContent()
        const executed=await page.evaluate(()=>Boolean(window.__moaSecurityXss))
        check('stored XSS stays inert after real browser React rendering',literal===payload&&!executed)
      } finally { await browser.close() }
    }
  }else check('XSS write payload rejected',[400,403].includes(injected.status),{status:injected.status})
  const comment=await request(api+'/posts/'+post.id+'/comments',{method:'POST',token:owner.token,body:{content:prefix+'-hidden-comment'}})
  assert.equal(comment.status,201)
  await service('/rest/v1/posts?id=eq.'+post.id,{is_hidden:true},'PATCH')
  for(const [name,token]of [['anonymous',null],['other member',other.token]]) {
    const hidden=await request(api+'/posts/'+post.id,{token})
    check(name+' cannot read hidden post API',hidden.status===404,{status:hidden.status})
    const comments=await request(api+'/posts/'+post.id+'/comments',{token})
    check(name+' cannot read hidden post comments',comments.status===404,{status:comments.status})
    const reactions=await request(api+'/posts/'+post.id+'/reactions',{token})
    check(name+' cannot read hidden post reactions',reactions.status===404,{status:reactions.status})
  }
  for(const [name,token]of [['anonymous',anon],['other member',other.token]]) {
    const direct=await request(base+'/rest/v1/post_list?id=eq.'+post.id+'&select=id,title,content,is_hidden',{key:anon,token})
    check(name+' cannot bypass API via post_list view',[401,403,404].includes(direct.status)||Array.isArray(direct.data)&&direct.data.length===0,{status:direct.status,fixtureVisible:Array.isArray(direct.data)&&direct.data.some(row=>row.id===post.id)})
  }
  const promote=await request(base+'/rest/v1/profiles?id=eq.'+other.id,{method:'PATCH',key:anon,token:other.token,body:{role:'admin'}})
  const role=(await service('/rest/v1/profiles?id=eq.'+other.id+'&select=role'))[0]?.role
  if(role==='admin')await service('/rest/v1/profiles?id=eq.'+other.id,{role:'user'},'PATCH')
  check('direct profile update cannot self-promote',role==='user',{status:promote.status})
  const rpc=await request(base+'/rest/v1/rpc/admin_adjust_credits',{method:'POST',key:anon,token:other.token,body:{p_actor_id:other.id,p_user_id:other.id,p_amount:1,p_reason:prefix,p_request_id:randomUUID()}})
  check('member cannot call service-only credit RPC',[401,403,404].includes(rpc.status),{status:rpc.status})
  const billing=await request(base+'/rest/v1/subscriptions?user_id=eq.'+other.id+'&select=billing_key,customer_key',{key:anon,token:other.token})
  check('direct billing key read denied',[401,403].includes(billing.status),{status:billing.status})
  const rawPayment=await request(base+'/rest/v1/payment_orders?user_id=eq.'+other.id+'&select=toss_payment_key,toss_payment_data,toss_cancel_data',{key:anon,token:other.token})
  check('direct provider payment payload read denied',[401,403].includes(rawPayment.status),{status:rawPayment.status})
  const safePayment=await request(base+'/rest/v1/payment_orders?user_id=eq.'+other.id+'&select=id,status,amount',{key:anon,token:other.token})
  check('safe own-order columns remain available',safePayment.status===200,{status:safePayment.status})
  for(const path of ['/posts/'+encodeURIComponent("1 OR 1=1"),'/posts/'+encodeURIComponent("1;SELECT 1--")]) {
    const r=await request(api+path);check('injected resource identifier rejected',[400,403,404].includes(r.status),{status:r.status})
  }
  const proto=await request(api+'/posts',{method:'POST',token:other.token,body:JSON.parse('{"__proto__":{"role":"admin"},"title":"","content":""}')})
  const adminAfter=await request(api+'/admin/users',{token:other.token})
  check('prototype-pollution payload does not grant admin',proto.status===400&&adminAfter.status===403)
  const cron=await request(api+'/internal/subscriptions/renew',{method:'POST',body:{}})
  check('private renewal worker rejects public requests',cron.status===401,{status:cron.status})
  const ssrf=await request(site+'/api/seo?path='+encodeURIComponent('https://127.0.0.1/'))
  check('SEO renderer rejects an absolute upstream URL',ssrf.status===400,{status:ssrf.status})
  for(const path of ['/.env','/frontend/.env.local','/.git/config']) {
    const r=await request(site+path);check('sensitive filesystem path is not served',r.status===404,{path,status:r.status})
  }
} finally {
  for(const id of posts)await service('/rest/v1/posts?id=eq.'+id,undefined,'DELETE')
  for(const id of users)await service('/auth/v1/admin/users/'+id,undefined,'DELETE')
  for(const id of users)assert.equal((await service('/rest/v1/profiles?id=eq.'+id+'&select=id')).length,0)
  console.log(JSON.stringify({temporaryFixturesRemoved:true,checks:checks.length,passed:checks.filter(c=>c.passed).length,findings:checks.filter(c=>!c.passed).map(c=>c.name)}))
}
if (process.argv.includes('--strict') && checks.some(c=>!c.passed)) process.exitCode=1
