// Launches the desktop app, building the web app first if needed.
import { existsSync } from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const webDist = path.resolve(root, '../web/dist/index.html')

if (!existsSync(webDist)) {
  console.log('Building the web app first…')
  execSync('npm --prefix ../web run build', { cwd: root, stdio: 'inherit' })
}

const require = createRequire(import.meta.url)
const electron = require('electron') // binary path when run under plain node
const child = spawn(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
})

child.on('error', (err) => {
  console.error('Failed to launch Electron:', err.message)
  process.exit(1)
})
