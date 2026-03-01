import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/bestdori-api': {
        target: 'https://bestdori.com/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bestdori-api/, '')
      },
      '/bestdori-assets': {
        target: 'https://bestdori.com/assets',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bestdori-assets/, '')
      }
    }
  }
})
