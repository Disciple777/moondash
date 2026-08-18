// Generates the PWA icons (PNG) for Moondash with zero dependencies.
// Run: npm run icons
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')

// ---- minimal PNG encoder -------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(size, pixelFn) {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y)
      const o = y * stride + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---- drawing --------------------------------------------------------------
function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function render(size, maskable) {
  const s = maskable ? 0.64 : 1
  const map = (u, v) => [0.5 + (u - 0.5) * s, 0.5 + (v - 0.5) * s]
  return (x, y) => {
    const u = x / size
    const v = y / size
    const [mu, mv] = map(u, v)

    // indigo diagonal gradient background
    const bg = lerp([0x6a, 0x64, 0xe8], [0x37, 0x2e, 0x9e], (u + v) / 2)
    let [r, g, b] = bg.map(Math.round)

    // crescent moon
    const dMoon = Math.hypot(mu - 0.52, mv - 0.46)
    const dHole = Math.hypot(mu - 0.65, mv - 0.35)
    if (dMoon <= 0.3 && dHole > 0.26) {
      r = 0xff
      g = 0xe9
      b = 0xa8
    }

    // little stars
    for (const [sx, sy, sr] of [
      [0.3, 0.3, 0.022],
      [0.7, 0.72, 0.016],
      [0.24, 0.64, 0.014],
      [0.76, 0.26, 0.012]
    ]) {
      const [mx, my] = map(sx, sy)
      if (Math.hypot(mu - mx, mv - my) <= sr) {
        r = 0xff
        g = 0xea
        b = 0xb8
      }
    }

    return [r, g, b, 255]
  }
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'icon-192.png'), encodePng(192, render(192, false)))
writeFileSync(join(outDir, 'icon-512.png'), encodePng(512, render(512, false)))
writeFileSync(join(outDir, 'maskable-icon-512.png'), encodePng(512, render(512, true)))
console.log('Icons written to', outDir)
