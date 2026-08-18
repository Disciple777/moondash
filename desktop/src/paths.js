// Safe path resolution: every file operation is scoped to the bound root
// so the renderer can never read/write outside the user's synced folder.
const path = require('path')

function resolveInRoot(root, relativePath) {
  const clean = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (clean === '' || clean === '.') throw new Error('Invalid relative path')
  const rootAbs = path.resolve(root)
  const abs = path.resolve(rootAbs, clean)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error('Path escapes the bound folder')
  }
  return abs
}

module.exports = { resolveInRoot }
