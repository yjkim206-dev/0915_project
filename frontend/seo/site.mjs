// Shared by the public HTML renderer and client navigation. No credentials here.
export const SITE = 'https://onboardproject.shop'
export const API = 'https://ymprvqsfpwvoutwozwvn.supabase.co/functions/v1/api'
export const IMAGE = `${SITE}/images/moa-og-v1.jpg`
export const DESCRIPTION = '모아는 관심사를 나누고 새로운 사람들과 이야기를 시작하는 커뮤니티입니다. 게시판, 공지사항과 멤버십 서비스를 만나보세요.'
export const FAQS = [
  ['모아는 어떤 서비스인가요?', '모아는 관심사를 공유하고 게시글과 댓글로 소통하는 온라인 커뮤니티입니다. 생각을 나누고 함께 성장하는 공간을 지향합니다.'],
  ['어떻게 시작하나요?', '공개 게시판과 공지사항은 로그인 없이 둘러볼 수 있습니다. 이메일로 가입하거나 카카오로 로그인한 뒤 게시글과 댓글을 작성할 수 있습니다.'],
  ['멤버십과 크레딧은 어디에서 확인하나요?', '상점에서 1개월 이용권, 자동갱신 구독과 크레딧을 선택할 수 있습니다. 구독 상태와 이용기간, 결제내역과 영수증은 로그인 후 프로필에서 확인합니다. 현재 상점은 실제 금액이 청구되지 않는 테스트 결제 모드입니다.'],
  ['서비스 소식이나 문의는 어디에서 확인하나요?', '공지사항에서 주요 안내와 업데이트를 확인할 수 있습니다. 개인적인 문의는 로그인 후 1:1 문의 기능을 이용해주세요.'],
]
export const PAGES = {
  '/': ['모아 · 생각을 나누고 함께 성장하는 커뮤니티', DESCRIPTION],
  '/about': ['모아 소개 · 서비스 안내와 자주 묻는 질문', '모아 커뮤니티의 게시판, 카카오 로그인, 멤버십과 크레딧, 공지사항 및 문의 이용 방법을 안내합니다.'],
  '/board': ['커뮤니티 게시판 · 모아', '관심사와 일상, 다양한 생각을 나누는 모아 커뮤니티 게시판입니다. 새로운 이야기를 읽고 함께 소통해보세요.'],
  '/notices': ['공지사항 · 모아', '모아 서비스의 주요 안내와 업데이트 소식을 확인하세요.'],
  '/shop': ['상점 · 이용권·구독·크레딧 안내 | 모아', '모아의 1개월 이용권, 자동갱신 구독과 크레딧을 확인하세요. 현재 상점은 실제 금액이 청구되지 않는 테스트 결제 모드입니다.'],
  '/privacy': ['개인정보처리방침 · 모아', '모아 서비스의 개인정보 처리에 관한 안내입니다.'],
  '/terms': ['이용약관 · 모아', '모아 서비스 이용에 적용되는 약관을 확인하세요.'],
}
export const PUBLIC_PATHS = Object.keys(PAGES)
export const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export function pageInfo(path, item) {
  const parts = PAGES[path]
  const detail = /^\/(board|notices)\/[1-9]\d*$/.test(path)
  if (detail && item) return { title: `${cleanText(item.title)} · 모아`, description: cleanText(item.content).slice(0, 160) || '모아 커뮤니티의 공개 게시글입니다.', indexable: true, type: 'article', item }
  if (parts) return { title: parts[0], description: parts[1], indexable: true, type: 'website' }
  return { title: path.startsWith('/admin') ? '관리자 · 모아' : '모아', description: '', indexable: false, type: 'website' }
}
export function structuredData(path, info) {
  if (!info.indexable) return null
  const url = SITE + path
  const graph = [
    { '@type': 'Organization', '@id': SITE + '/#organization', name: '모아', alternateName: 'MOA', url: SITE + '/', logo: { '@type': 'ImageObject', url: SITE + '/brand/moa-icon-v1.png', width: 512, height: 512 } },
    { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: '모아', alternateName: 'MOA', inLanguage: 'ko-KR', description: DESCRIPTION, publisher: { '@id': SITE + '/#organization' } },
    { '@type': path === '/about' ? 'AboutPage' : ['/board','/notices','/shop'].includes(path) ? 'CollectionPage' : 'WebPage', '@id': url + '#webpage', url, name: info.title, description: info.description, inLanguage: 'ko-KR', isPartOf: { '@id': SITE + '/#website' }, primaryImageOfPage: { '@type': 'ImageObject', url: IMAGE, width: 1200, height: 630 } },
  ]
  if (path !== '/') graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '모아', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: info.title.split(' · ')[0], item: url }] })
  if (info.item) {
    const item = info.item
    const article = { '@type': path.startsWith('/board/') ? 'DiscussionForumPosting' : 'Article', '@id': url + '#article', url, headline: cleanText(item.title), articleBody: String(item.content || ''), inLanguage: 'ko-KR', mainEntityOfPage: { '@id': url + '#webpage' }, author: item.author ? { '@type': 'Person', name: cleanText(item.author) } : { '@id': SITE + '/#organization' }, publisher: { '@id': SITE + '/#organization' } }
    for (const [key,value] of [['datePublished',item.published_at || item.created_at],['dateModified',item.updated_at]]) if (value && Number.isFinite(Date.parse(value))) article[key] = new Date(value).toISOString()
    graph.push(article)
  }
  return { '@context': 'https://schema.org', '@graph': graph }
}
export function headHtml(path, info) {
  const e = escapeHtml
  const meta = (key,value,property = false) => `<meta ${property ? 'property' : 'name'}="${key}" content="${e(value)}" data-site-seo="true" />`
  const tags = [`<title>${e(info.title)}</title>`, meta('description',info.description), meta('robots',info.indexable ? 'index,follow,max-image-preview:large' : 'noindex,nofollow,noarchive,nosnippet')]
  if (info.indexable) {
    tags.push(`<link rel="canonical" href="${e(SITE + path)}" data-site-seo="true" />`)
    for (const [key,value] of Object.entries({ 'og:type':info.type, 'og:site_name':'모아', 'og:locale':'ko_KR', 'og:title':info.title, 'og:description':info.description, 'og:url':SITE+path, 'og:image':IMAGE, 'og:image:secure_url':IMAGE, 'og:image:type':'image/jpeg', 'og:image:width':1200, 'og:image:height':630, 'og:image:alt':'모아 — 생각을 나누고 함께 성장하는 공간' })) tags.push(meta(key,value,true))
    for (const [key,value] of Object.entries({ 'twitter:card':'summary_large_image', 'twitter:title':info.title, 'twitter:description':info.description, 'twitter:image':IMAGE, 'twitter:image:alt':'모아 — 생각을 나누고 함께 성장하는 공간' })) tags.push(meta(key,value))
    const data = structuredData(path,info)
    tags.push(`<script type="application/ld+json" data-site-seo="true">${JSON.stringify(data).replace(/</g,'\\u003c')}</script>`)
  }
  return tags.join('\n    ')
}
