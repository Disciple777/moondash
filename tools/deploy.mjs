#!/usr/bin/env node
/**
 * FTPS deploy for the parts of Moondash that live on shared hosting (no SSH).
 *
 * Credentials come from .env.deploy in the project root, which is gitignored
 * and must never be printed — not in logs, not in an error message.
 *
 * Usage:
 *   node tools/deploy.mjs --ls [remote path]      list a server directory
 *   node tools/deploy.mjs download --dry-run      show what would upload
 *   node tools/deploy.mjs download                upload the download page
 *   node tools/deploy.mjs download --with-zip     ...and the desktop zip
 */
import { Client } from 'basic-ftp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function env() {
  const file = path.join(root, '.env.deploy')
  if (!fs.existsSync(file)) {
    console.error('ERROR: .env.deploy not found in the project root.')
    process.exit(1)
  }
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  for (const key of ['FTP_HOST', 'FTP_USER', 'FTP_PASSWORD']) {
    if (!out[key]) {
      console.error(`ERROR: ${key} is missing from .env.deploy.`)
      process.exit(1)
    }
  }
  return out
}

/** The one place that knows what goes where. */
const TARGETS = {
  download: {
    remote: 'moondash/download',
    files: [
      { from: 'web/public/download/index.html', as: 'index.html' },
      {
        from: 'desktop/dist-release/Moondash-1.0.1-win32-x64.zip',
        as: 'Moondash-1.0.1-win32-x64.zip',
        // 100 MB+; only sent when asked for, so a page fix stays quick.
        optional: true
      }
    ]
  }
}

async function connect(cfg) {
  const client = new Client(60000)
  await client.access({
    host: cfg.FTP_HOST,
    port: Number(cfg.FTP_PORT || 21),
    user: cfg.FTP_USER,
    password: cfg.FTP_PASSWORD,
    secure: true,
    // Shared hosts serve a shared certificate that won't match the host name.
    secureOptions: { rejectUnauthorized: false }
  })
  return client
}

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const positional = args.filter((a) => !a.startsWith('--'))

const cfg = env()
const client = await connect(cfg)

try {
  if (flag('--ls')) {
    const dir = positional[0] ?? '.'
    console.log(`\n${dir}`)
    for (const item of await client.list(dir)) {
      const kind = item.isDirectory ? 'dir ' : 'file'
      console.log(`  ${kind} ${String(item.size).padStart(10)}  ${item.name}`)
    }
    process.exit(0)
  }

  const name = positional[0]
  const target = TARGETS[name]
  if (!target) {
    console.error(`Usage: node tools/deploy.mjs <${Object.keys(TARGETS).join('|')}> [--dry-run] [--with-zip]`)
    process.exit(1)
  }

  const picked = target.files.filter((f) => !f.optional || flag('--with-zip'))
  console.log(`\nTarget: ${target.remote}`)
  for (const file of picked) {
    const local = path.join(root, file.from)
    if (!fs.existsSync(local)) {
      console.error(`  MISSING  ${file.from}`)
      process.exit(1)
    }
    const mb = (fs.statSync(local).size / 1048576).toFixed(1)
    if (flag('--dry-run')) {
      console.log(`  would upload  ${file.from}  (${mb} MB)  ->  ${file.as}`)
      continue
    }
    console.log(`  uploading  ${file.from}  (${mb} MB)`)
    await client.ensureDir(target.remote)
    await client.cd('/')
    await client.uploadFrom(local, `${target.remote}/${file.as}`)
    console.log(`  done       ${file.as}`)
  }

  if (!flag('--dry-run')) {
    console.log('\nServer now holds:')
    for (const item of await client.list(target.remote)) {
      if (!item.isDirectory) console.log(`  ${String(item.size).padStart(10)}  ${item.name}`)
    }
  }
} finally {
  client.close()
}
