import { defineConfig } from 'vite'
import atlasApi from './server/api'

export default defineConfig({
  plugins: [atlasApi()],
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/data/**'] } },
  preview: { port: 5173, strictPort: true },
})
