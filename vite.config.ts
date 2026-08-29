import { defineConfig } from 'vite'
import atlasApi from './server/api'
import { cfg } from './server/config'

export default defineConfig({
  plugins: [atlasApi()],
  server: { port: cfg.port, strictPort: true, watch: { ignored: ['**/data/**'] } },
  preview: { port: cfg.port, strictPort: true },
})
