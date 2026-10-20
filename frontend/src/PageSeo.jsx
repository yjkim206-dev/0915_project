import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { SITE, pageInfo, headHtml } from '../seo/site.mjs'
import { apiFetch } from './api.js'

export default function PageSeo({ posts }) {
  const { pathname } = useLocation()
  useEffect(() => {
    const path = pathname.replace(/\/+$/, '') || '/'
    let active = true
    const update = (item) => {
      if (!active) return
      const info = pageInfo(path,item)
      if (window.location.origin !== SITE && window.location.hostname !== 'www.onboardproject.shop') info.indexable = false
      // Replace only our managed metadata, leaving icons and unrelated head tags.
      document.head.querySelectorAll('[data-site-seo],title,meta[name="description"],meta[name="robots"],link[rel="canonical"],meta[property^="og:"],meta[name^="twitter:"],script[type="application/ld+json"]').forEach(node => node.remove())
      const fragment = document.createRange().createContextualFragment(headHtml(path,info))
      document.head.appendChild(fragment)
    }
    const detail = /^\/(board|notices)\/[1-9]\d*$/.test(path)
    const item = detail ? posts.find(post => String(post.id) === path.split('/')[2]) : null
    // Keep valid server-rendered article metadata while the public list loads.
    if (!(detail && !item && document.querySelector('link[rel="canonical"]')?.href === SITE + path)) update(item)
    if (path.startsWith('/notices/') && !item) {
      apiFetch('/notices').then(items => update(items.find(notice => String(notice.id) === path.split('/')[2]))).catch(() => {})
    }
    return () => { active = false }
  }, [pathname,posts])
  return null
}
