import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import atlasApi from './server/api'
import { cfg } from './server/config'

export default defineConfig({
  plugins: [atlasApi(), tailwindcss()],
  server: { port: cfg.port, strictPort: true, watch: { ignored: ['**/data/**', '**/.codebase-memory/**'] } },
  preview: { port: cfg.port, strictPort: true },
})
