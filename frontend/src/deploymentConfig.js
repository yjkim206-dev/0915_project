// Public deployment addresses. Secrets remain in environment variables.
const projectUrl = 'https://ymprvqsfpwvoutwozwvn.supabase.co'
const frontendUrl = 'https://0915-project-ruby.vercel.app'

function deployedUrl(configured, fallback) {
  try {
    const url = new URL(configured || fallback)
    const expected = new URL(fallback)
    // Keep this deployment connected to its own HTTPS project even if a build
    // environment still contains a development address or another project URL.
    return url.origin === expected.origin && url.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '') && !url.search && !url.hash
      ? url.href.replace(/\/+$/, '') : fallback
  } catch { return fallback }
}

export const SUPABASE_URL = deployedUrl(import.meta.env.VITE_SUPABASE_URL, projectUrl)
export const API_URL = deployedUrl(import.meta.env.VITE_API_URL, `${projectUrl}/functions/v1/api`)
export const SITE_URL = deployedUrl(import.meta.env.VITE_SITE_URL, frontendUrl)
