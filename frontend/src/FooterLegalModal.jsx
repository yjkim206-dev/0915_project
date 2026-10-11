import { useEffect, useState } from 'react'
import { LegalModal } from './Support.jsx'

export default function FooterLegalModal() {
  const [type, setType] = useState(null)
  useEffect(() => {
    const open = (event) => {
      const link = event.target.closest('footer a[href]')
      if (!link) return
      const next = link.getAttribute('href') === '/privacy' ? 'privacy' : link.getAttribute('href') === '/terms' ? 'terms' : null
      if (!next) return
      event.preventDefault(); setType(next)
    }
    document.addEventListener('click', open, true)
    return () => document.removeEventListener('click', open, true)
  }, [])
  return type && <LegalModal type={type} onClose={() => setType(null)} />
}
