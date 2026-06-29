import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const mirrorRoot = resolve(__dirname, 'mirror')

const contentTypes: Record<string, string> = {
  '.asset': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.moc': 'application/octet-stream',
  '.mtn': 'application/octet-stream',
  '.png': 'image/png',
}

const mirrorMiddleware = async (req: any, res: any, next: any) => {
  const requestUrl = req.url?.split('?')[0] || ''
  if (!requestUrl.startsWith('/mirror/')) {
    next()
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  try {
    const decodedPath = decodeURIComponent(requestUrl.replace(/^\/mirror\/?/, ''))
    const filePath = resolve(join(mirrorRoot, decodedPath))
    const safeRelative = relative(mirrorRoot, filePath)

    if (safeRelative.startsWith('..') || safeRelative === '') {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', contentTypes[extname(filePath)] || 'application/octet-stream')
    res.setHeader('Content-Length', String(fileStat.size))
    res.setHeader('Cache-Control', requestUrl.includes('/bestdori-api/') ? 'no-cache' : 'public, max-age=31536000, immutable')

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    createReadStream(filePath).pipe(res)
  } catch {
    res.statusCode = 404
    res.end('Not Found')
  }
}

const serveMirror = () => ({
  name: 'serve-local-bestdori-mirror',
  configureServer(server: any) {
    server.middlewares.use(mirrorMiddleware)
  },
  configurePreviewServer(server: any) {
    server.middlewares.use(mirrorMiddleware)
  },
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), serveMirror()],
})
