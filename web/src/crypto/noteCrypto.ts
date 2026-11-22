/**
 * Password-protected notes.
 *
 * A locked note is stored as an opaque text envelope, so it travels through
 * every existing path unchanged — the cloud `bits` row, the sync engine, and
 * the `.md`/`.txt` file on disk all just see text. Anyone opening the file
 * outside Moondash sees the envelope and nothing else; `content_preview` in
 * the database holds the start of the ciphertext, so the cloud copy leaks
 * nothing either.
 *
 * Crypto: PBKDF2-HMAC-SHA256 (fresh 16-byte salt) derives a 256-bit key, and
 * the note is sealed with AES-256-GCM under a fresh 12-byte IV per save.
 *
 * GCM is AUTHENTICATED: a wrong password fails to decrypt rather than
 * producing plausible-looking garbage. That is deliberate. In an editor,
 * silently showing garbage for a wrong password would be dangerous — the
 * autosave would then write that garbage back over the real note and the
 * original would be gone. Failing loudly keeps the ciphertext intact.
 *
 * What is NOT protected: the note's title / filename, its timestamps, and its
 * size. Only the body is encrypted.
 */

const BEGIN = '-----BEGIN MOONDASH ENCRYPTED NOTE-----'
const END = '-----END MOONDASH ENCRYPTED NOTE-----'

/** OWASP's floor for PBKDF2-HMAC-SHA256. Stored per note so it can be raised later. */
export const DEFAULT_ITERATIONS = 310_000

const SALT_BYTES = 16
const IV_BYTES = 12

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password')
    this.name = 'WrongPasswordError'
  }
}

export class CryptoUnavailableError extends Error {
  constructor() {
    super('This browser has no Web Crypto support, so notes cannot be encrypted here')
    this.name = 'CryptoUnavailableError'
  }
}

/** A derived key plus the parameters needed to re-seal the note with it. */
export interface NoteKey {
  key: CryptoKey
  salt: Uint8Array
  iterations: number
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto
  if (!c?.subtle) throw new CryptoUnavailableError()
  return c.subtle
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** True when `content` is a Moondash envelope rather than a normal note. */
export function isEncrypted(content: string): boolean {
  return content.trimStart().startsWith(BEGIN)
}

interface Envelope {
  iterations: number
  salt: Uint8Array
  iv: Uint8Array
  ciphertext: Uint8Array
}

function parseEnvelope(content: string): Envelope {
  const body = content.trim()
  if (!body.startsWith(BEGIN) || !body.endsWith(END)) {
    throw new Error('Not a Moondash encrypted note')
  }
  const payload = body.slice(BEGIN.length, body.length - END.length).trim()
  const parts = payload.split('.')
  if (parts.length !== 5 || parts[0] !== 'v1') {
    throw new Error('Unrecognised encrypted note format')
  }
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations < 1) {
    throw new Error('Unrecognised encrypted note format')
  }
  return {
    iterations,
    salt: fromBase64(parts[2]),
    iv: fromBase64(parts[3]),
    ciphertext: fromBase64(parts[4])
  }
}

function buildEnvelope(e: Envelope): string {
  const payload = [
    'v1',
    String(e.iterations),
    toBase64(e.salt),
    toBase64(e.iv),
    toBase64(e.ciphertext)
  ].join('.')
  return `${BEGIN}\n${payload}\n${END}\n`
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: the key can never be read back out
    ['encrypt', 'decrypt']
  )
}

/** Derive a fresh key for a note being locked for the first time. */
export async function createKey(
  password: string,
  iterations = DEFAULT_ITERATIONS
): Promise<NoteKey> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  return { key: await deriveKey(password, salt, iterations), salt, iterations }
}

/** Seal plaintext into an envelope. Each call uses a fresh IV. */
export async function encryptNote(plaintext: string, noteKey: NoteKey): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      noteKey.key,
      new TextEncoder().encode(plaintext)
    )
  )
  return buildEnvelope({ iterations: noteKey.iterations, salt: noteKey.salt, iv, ciphertext })
}

/**
 * Open an envelope with a key already derived in this session, so a note
 * unlocked once doesn't re-prompt on every reopen. Throws WrongPasswordError
 * if the key doesn't fit (e.g. the note was re-locked under a new password
 * elsewhere), which sends the caller back to the lock screen.
 */
export async function decryptNoteWithKey(content: string, noteKey: NoteKey): Promise<string> {
  const envelope = parseEnvelope(content)
  try {
    const plainBytes = await subtle().decrypt(
      { name: 'AES-GCM', iv: envelope.iv as BufferSource },
      noteKey.key,
      envelope.ciphertext as BufferSource
    )
    return new TextDecoder().decode(plainBytes)
  } catch {
    throw new WrongPasswordError()
  }
}

/**
 * Open an envelope with `password`.
 * Throws WrongPasswordError when the password doesn't match — the note itself
 * is never modified, so a failed attempt costs nothing.
 * Returns the plaintext and the key, so saves can re-seal without asking again.
 */
export async function decryptNote(
  content: string,
  password: string
): Promise<{ plaintext: string; noteKey: NoteKey }> {
  const envelope = parseEnvelope(content)
  const key = await deriveKey(password, envelope.salt, envelope.iterations)
  let plainBytes: ArrayBuffer
  try {
    plainBytes = await subtle().decrypt(
      { name: 'AES-GCM', iv: envelope.iv as BufferSource },
      key,
      envelope.ciphertext as BufferSource
    )
  } catch {
    // GCM's authentication tag failed: wrong password, or the file was edited.
    throw new WrongPasswordError()
  }
  return {
    plaintext: new TextDecoder().decode(plainBytes),
    noteKey: { key, salt: envelope.salt, iterations: envelope.iterations }
  }
}
