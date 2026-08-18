// Serves the built app (web/dist) under a subfolder path, exactly like
// production hosting (e.g. https://host/moondash/). Useful for verifying the
// relative-base build works from a subfolder.
//
// Usage: node scripts/preview-subfolder.mjs [basePath] [port]
//   default basePath=/moondash  port=4180
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(__dirname, '../dist')
// MOONDASH_BASE avoids MSYS path mangling when passing /-prefixed args
const basePath = (process.env.MOONDASH_BASE || process.argv[2] || '/moondash').replace(/\/+$/, '')
const port = Number(process.argv[3] || 4180)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json'
}

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (urlPath.startsWith(basePath)) urlPath = urlPath.slice(basePath.length)
    if (urlPath === '' || urlPath === '/') urlPath = '/index.html'

    const abs = path.join(dist, urlPath)
    if (!abs.startsWith(dist)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    fs.readFile(abs, (err, data) => {
      if (err) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' })
      res.end(data)
    })
  })
  .listen(port, () => {
    console.log(`Serving ${dist} at http://localhost:${port}${basePath}/`)
  })
