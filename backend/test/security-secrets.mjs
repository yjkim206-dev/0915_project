// Report secret types and file paths only. Never print matched values.
import { readFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const git = (...args) => execFileSync('git',args,{encoding:'utf8',maxBuffer:128*1024*1024})
const env = {}
const configuredValues = []
for(const file of ['.env','.env.local','frontend/.env.local','backend/.env']) {
  try { for(const line of readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/);if(m){const value=m[2].replace(/^['"]|['"]$/g,'');configuredValues.push([file+':'+m[1],value]);if(!env[m[1]])env[m[1]]=value}} }catch{}
}
const secrets = configuredValues.filter(([key,value])=>value.length>=8&&/SECRET|SERVICE_ROLE|ACCESS_TOKEN|:VERCEL_TOKEN$|PASSWORD|PRIVATE_KEY/.test(key)&&!key.includes(':VITE_'))
function matches(text) {
  const types=new Set()
  for(const [key,value]of secrets)if(text.includes(value))types.add('current:'+key)
  for(const [kind,pattern]of [
    ['Supabase account token',/\bsbp_[a-zA-Z0-9]{24,}\b/g],
    ['Supabase secret API key',/\bsb_secret_[a-zA-Z0-9_-]{20,}\b/g],
    ['Toss secret key',/\b(?:test|live)_sk_[a-zA-Z0-9]{24,}\b/g],
    ['GitHub token',/\bgh[pousr]_[a-zA-Z0-9]{30,}\b/g],
    ['OpenAI secret key',/\bsk-proj-[a-zA-Z0-9_-]{30,}\b/g],
    ['PEM private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ])if(pattern.test(text))types.add(kind)
  for(const jwt of text.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g)||[]) {
    try{if(JSON.parse(Buffer.from(jwt.split('.')[1],'base64url')).role==='service_role')types.add('Supabase service-role JWT')}catch{}
  }
  return [...types]
}
const files=git('ls-files','-z').split('\0').filter(Boolean)
const current=[]
for(const file of files){if(!existsSync(file)||statSync(file).size>4000000||/\.(png|jpg|ico)$/i.test(file))continue;const found=matches(readFileSync(file,'utf8'));if(found.length)current.push({file,types:found})}
console.log(JSON.stringify({check:'currentTrackedFiles',files:files.length,findings:current}))
const objects=git('rev-list','--all','--objects').trim().split('\n').map(line=>{const i=line.indexOf(' ');return {oid:line.slice(0,i),file:line.slice(i+1)}}).filter(x=>x.oid&&/\.(?:js|mjs|cjs|jsx|ts|tsx|json|md|yml|yaml|toml|sql|ps1|html|txt)$|(?:^|\/)\.env(?:\.|$)/i.test(x.file))
const data=execFileSync('git',['cat-file','--batch'],{input:objects.map(x=>x.oid).join('\n')+'\n',maxBuffer:128*1024*1024})
let offset=0;const historical=[]
for(const object of objects){const end=data.indexOf(10,offset);const header=data.subarray(offset,end).toString();offset=end+1;const size=Number(header.split(' ')[2]);if(!Number.isFinite(size))continue;const body=data.subarray(offset,offset+size);offset+=size+1;const found=matches(body.toString('utf8'));if(found.length)historical.push({file:object.file,object:object.oid.slice(0,8),types:found})}
console.log(JSON.stringify({check:'reachableGitHistory',blobs:objects.length,findings:historical}))
if(process.argv.includes('--deployed')) {
  const origin='https://onboardproject.shop'
  const html=await(await fetch(origin,{signal:AbortSignal.timeout(20000)})).text()
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)].map(m=>m[1])
  const deployed=[]
  for(const asset of assets){const text=await(await fetch(origin+asset,{signal:AbortSignal.timeout(20000)})).text();const found=matches(text);if(found.length)deployed.push({asset,types:found});console.log(JSON.stringify({check:'publicAssetKeyClassification',asset,publicTossClientKey:/test_ck_[a-zA-Z0-9]+/.test(text),privateKeyMatches:found.length}))}
  console.log(JSON.stringify({check:'deployedAssets',assets:assets.length,findings:deployed}))
}
