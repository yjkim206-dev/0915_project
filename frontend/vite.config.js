import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, '..', 'TOSS_CLIENT_KEY')
  const frontendEnv = loadEnv(mode, '.', 'VITE_TOSS_CLIENT_KEY')

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_TOSS_CLIENT_KEY': JSON.stringify(
        frontendEnv.VITE_TOSS_CLIENT_KEY || rootEnv.TOSS_CLIENT_KEY || '',
      ),
    },
  }
})
