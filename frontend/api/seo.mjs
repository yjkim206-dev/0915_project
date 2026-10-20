import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { API, SITE, DESCRIPTION, FAQS, escapeHtml as e, pageInfo, headHtml } from '../seo/site.mjs'

// This renderer only calls unauthenticated public endpoints. Never use a
// service-role key, cookies, or user-supplied upstream URLs to produce HTML.
let shellCache
async function template() {
  if (shellCache) return shellCache
  // Monorepo function working directories can differ from the Vite project root.
  for (const file of [new URL('../dist/index.html', import.meta.url), join(process.cwd(),'dist/index.html'), join(process.cwd(),'frontend/dist/index.html')]) {
    try { shellCache = readFileSync(file,'utf8'); return shellCache } catch { /* Try the next deployment layout. */ }
  }
  // /index.html is a static asset, never rewritten to this function. Pin the
  // origin so user headers/parameters cannot redirect this request elsewhere.
  const response = await fetch(SITE + '/index.html', { signal:AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('HTML shell unavailable')
  const html = await response.text()
  if (!html.includes('<!--seo:start-->') || !html.includes('/assets/')) throw new Error('Invalid HTML shell')
  shellCache = html
  return shellCache
}
async function publicData(path) {
  const response = await fetch(API + path, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('Public content unavailable')
  const data = await response.json()
  if (!Array.isArray(data)) throw new Error('Invalid public content')
  return data.filter(item => !item.is_hidden)
}
const isNotice = (post) => ['공지', '공지사항', 'notice'].includes(String(post.category || '').toLowerCase())
async function notices(existingPosts) {
  const [remote, posts] = await Promise.all([publicData('/notices'), existingPosts || publicData('/posts')])
  return [...remote, ...posts.filter(isNotice).filter(post => !remote.some(item => String(item.id) === String(post.id)))]
}
function list(items, prefix) {
  return items.length ? `<ul>${items.map(item => `<li><a href="${prefix}/${e(item.id)}">${e(item.title)}</a></li>`).join('')}</ul>` : '<p>등록된 글이 없습니다.</p>'
}
function documentBody(path, info, items = []) {
  let content = ''
  if (path === '/') content = `<p>CONNECT · SHARE · GROW</p><h1>생각을 나누고 함께 성장하는 공간</h1><p>${e(DESCRIPTION)}</p><p><a href="/board">게시판 둘러보기</a> · <a href="/shop">상점 둘러보기</a> · <a href="/about">모아 소개</a></p><img src="/images/moa-community-hero-v1.png" width="768" height="512" alt="말풍선과 사람들이 함께하는 모아 커뮤니티 일러스트" /><h2>최근 게시글</h2>${list(items.slice(0, 3),'/board')}`
  else if (path === '/about') content = `<h1>모아 소개</h1><p>${e(DESCRIPTION)}</p><h2>연결하고, 나누고, 함께 성장해요</h2><p>모아에서는 관심사가 비슷한 사람들과 게시글과 댓글로 이야기를 나눌 수 있습니다. 공지사항에서 서비스 소식을 확인하고, 상점에서 멤버십과 크레딧을 살펴보세요.</p><h2>자주 묻는 질문</h2>${FAQS.map(([q,a]) => `<section><h3>${e(q)}</h3><p>${e(a)}</p></section>`).join('')}`
  else if (info.item) {
    const item = info.item
    const date = item.published_at || item.created_at
    content = `<article><h1>${e(item.title)}</h1><p>${e(item.author || '모아 운영팀')}${date && Number.isFinite(Date.parse(date)) ? ` · <time datetime="${e(date)}">${e(new Date(date).toLocaleDateString('ko-KR',{ timeZone:'Asia/Seoul' }))}</time>` : ''}</p><div style="white-space:pre-wrap;overflow-wrap:anywhere">${e(item.content)}</div><p><a href="${path.startsWith('/board/') ? '/board' : '/notices'}">목록으로 돌아가기</a></p></article>`
  } else if (path === '/board' || path === '/notices') content = `<h1>${path === '/board' ? '커뮤니티 게시판' : '공지사항'}</h1><p>${e(info.description)}</p>${list(items,path)}`
  else if (path === '/shop') content = `<h1>모아 상점</h1><p>${e(info.description)}</p><h2>월간 멤버십</h2><p>1개월 이용권은 한 번 결제하며 자동으로 청구되지 않습니다. 자동갱신 구독은 별도 카드 등록 후 매월 청구되며, 프로필에서 해지 예약을 할 수 있습니다.</p><h2>크레딧 충전</h2><p>필요한 만큼 포인트를 충전하고 로그인 후 프로필에서 잔액과 결제내역을 확인하세요.</p><ul>${items.map(item => `<li>${e(item.name)}: ${e(Number(item.amount).toLocaleString('ko-KR'))}원</li>`).join('')}</ul><p>현재는 테스트 결제이며 실제 금액이 청구되지 않습니다.</p>`
  else if (path === '/privacy') content = '<h1>개인정보처리방침</h1><p>시행일: 2026년 1월 1일</p><h2>개인정보의 수집</h2><p>서비스는 회원가입과 서비스 이용에 필요한 이름과 이메일을 수집합니다.</p><h2>이용 목적</h2><p>회원 식별, 서비스 제공, 게시글과 댓글 관리에 사용합니다.</p><h2>보관 및 파기</h2><p>회원 탈퇴 시 법령상 보관이 필요한 정보를 제외하고 파기합니다.</p>'
  else if (path === '/terms') content = '<h1>개인정보 이용약관</h1><p>시행일: 2026년 1월 1일</p><h2>서비스 이용</h2><p>회원은 타인의 권리를 침해하지 않는 범위에서 서비스를 이용해야 합니다.</p><h2>이용 제한</h2><p>불법 정보, 광고, 명예훼손 또는 운영 방해 게시물은 제한될 수 있습니다.</p>'
  else content = `<h1>${e(info.title)}</h1><p>${e(info.description)}</p>`
  return `<header><nav aria-label="주요 메뉴"><a href="/">모아</a> · <a href="/about">서비스 소개</a> · <a href="/board">게시판</a> · <a href="/notices">공지사항</a> · <a href="/shop">상점</a></nav></header><main class="container">${content}</main><footer><p>모아 · 함께 나누고 함께 성장하는 커뮤니티</p><a href="/privacy">개인정보처리방침</a> · <a href="/terms">이용약관</a></footer>`
}
function send(res, status, body, type, cache = false) {
  res.statusCode = status
  res.setHeader('Content-Type', type + '; charset=utf-8')
  res.setHeader('Cache-Control', cache ? 'public, max-age=0, s-maxage=60, must-revalidate' : 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(body)
}
async function contentSitemap() {
  // Fetch failure must not cache an incomplete sitemap that drops existing URLs.
  const [posts, remoteNotices] = await Promise.all([publicData('/posts'), publicData('/notices')])
  const publishedNotices = [...remoteNotices, ...posts.filter(isNotice).filter(post => !remoteNotices.some(item => String(item.id) === String(post.id)))]
  const rows = []
  for (const [items,prefix] of [[posts,'/board'],[publishedNotices,'/notices']]) for (const item of items) {
    if (!/^[1-9]\d*$/.test(String(item.id))) continue
    rows.push({ path: prefix + '/' + item.id, modified: item.updated_at || item.published_at || item.created_at })
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.map(row => `<url><loc>${e(SITE+row.path)}</loc>${row.modified && Number.isFinite(Date.parse(row.modified)) ? `<lastmod>${new Date(row.modified).toISOString()}</lastmod>` : ''}</url>`).join('')}</urlset>`
}
export default async function handler(req, res) {
  if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow','GET, HEAD'); return send(res,405,'Method not allowed','text/plain') }
  const request = new URL(req.url, SITE)
  const rawPath = req.query?.path || request.searchParams.get('path') || (request.pathname.startsWith('/api/') ? '/' : request.pathname)
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/') || rawPath.includes('://')) return send(res,400,'Invalid path','text/plain')
  const path = rawPath.replace(/\/+$/,'') || '/'
  const host = String(req.headers.host || '').split(':')[0]
  const production = host === 'onboardproject.shop' || host === 'www.onboardproject.shop'
  if (path === '/sitemap.xml') {
    if (!production) res.setHeader('X-Robots-Tag','noindex, nofollow')
    // Normally served directly from public/sitemap.xml. This fallback also has
    // no dependency on database/API requests or the HTML shell.
    return send(res,200,`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${SITE}/sitemap-pages.xml</loc></sitemap><sitemap><loc>${SITE}/sitemap-content.xml</loc></sitemap></sitemapindex>`,'application/xml',production)
  }
  if (path === '/sitemap-content.xml') {
    if (!production) res.setHeader('X-Robots-Tag','noindex, nofollow')
    try { return send(res,200,await contentSitemap(),'application/xml',production) }
    catch { res.setHeader('Retry-After','60'); return send(res,503,'Sitemap temporarily unavailable','text/plain') }
  }
  if (path === '/robots.txt') {
    const body = production ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /auth/\nDisallow: /profile\nDisallow: /inquiry\nDisallow: /login\nDisallow: /signup\nDisallow: /consent\nDisallow: /board/new\nDisallow: /board/*/edit\nDisallow: /shop/credits/\nDisallow: /shop/subscription/\nDisallow: /shop/fail\nDisallow: /*?*\n# /admin is crawlable only to let compliant engines see its noindex header.\n# Authentication continues to protect all administration data.\nSitemap: ${SITE}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n'
    return send(res,200,body,'text/plain',production)
  }
  let info = pageInfo(path)
  let status = 200
  let items = []
  try {
    if (path === '/' || path === '/board') items = await publicData('/posts')
    else if (path === '/notices') items = await notices()
    else if (path === '/shop') items = await publicData('/shop/products')
    else if (/^\/(board|notices)\/[1-9]\d*$/.test(path)) {
      const fromBoard = path.startsWith('/board/')
      items = await publicData('/posts')
      const item = items.find(item => String(item.id) === path.split('/')[2]) || (!fromBoard ? (await publicData('/notices')).find(item => String(item.id) === path.split('/')[2]) : null)
      if (item) info = pageInfo(path,item)
      else { status = 404; info = { title:'페이지를 찾을 수 없습니다 · 모아', description:'삭제되었거나 공개되지 않은 글입니다.', indexable:false } }
    } else if (!info.indexable && !/^\/(admin|profile|auth|login|signup|consent|inquiry)(\/|$)/.test(path) && !/^\/board\/(new|[1-9]\d*\/edit)$/.test(path) && !/^\/shop\/(credits|subscription|fail)(\/|$)/.test(path)) {
      status = 404
      info = { title:'페이지를 찾을 수 없습니다 · 모아', description:'요청한 페이지가 없습니다.', indexable:false }
    }
  } catch {
    status = 503
    info = { title:'잠시 후 다시 방문해주세요 · 모아', description:'공개 정보를 일시적으로 불러오지 못했습니다.', indexable:false }
    res.setHeader('Retry-After','60')
  }
  if (!production) info = { ...info,indexable:false }
  res.setHeader('X-Robots-Tag',info.indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow, noarchive, nosnippet')
  let html
  try {
    html = (await template()).replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, `<!--seo:start-->${headHtml(path,info)}<!--seo:end-->`)
      .replace(/<div id="root">[\s\S]*?<\/div><!--app-shell:end-->/, `<div id="root">${info.indexable || status !== 200 ? documentBody(path,info,items) : ''}</div><!--app-shell:end-->`)
  } catch { res.setHeader('X-Robots-Tag','noindex, nofollow'); return send(res,503,'Page temporarily unavailable','text/plain') }
  if (req.method === 'HEAD') html = ''
  return send(res,status,html,'text/html',info.indexable && status === 200)
}
