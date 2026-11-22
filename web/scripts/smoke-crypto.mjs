/**
 * Smoke test for password-protected notes.
 * Runs the REAL Web Crypto implementation (Node exposes the same
 * globalThis.crypto.subtle the browser and Electron do) and checks the
 * round-trip, the wrong-password path, and that the envelope leaks nothing.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

// btoa/atob exist in Node 16+ but the module reads them off the global scope.
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64')
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary')

const {
  isEncrypted,
  createKey,
  encryptNote,
  decryptNote,
  WrongPasswordError,
  DEFAULT_ITERATIONS
} = await import('./.tmp-notecrypto.mjs')

let n = 0
const ok = (label) => console.log(`\u2713 ${++n}. ${label}`)

const NOTE = [
  '# Bank details',
  '',
  'Recovery phrase: correct horse battery staple',
  'Path: C:\\Users\\CPU\\secrets',
  '',
  '- [ ] rotate quarterly',
  '',
  'Unicode: café — 日本語 — 🌙'
].join('\n')

const PASSWORD = 'a long passphrase with spaces & symbols £!'

// ---- 1. Round-trip ----
const key = await createKey(PASSWORD)
const sealed = await encryptNote(NOTE, key)
const { plaintext } = await decryptNote(sealed, PASSWORD)
assert.strictEqual(plaintext, NOTE, 'decrypted text must match the original exactly')
ok('a note round-trips through encrypt -> decrypt unchanged')

// ---- 2. The envelope is detected as encrypted, plain notes are not ----
assert.ok(isEncrypted(sealed), 'envelope should be detected')
assert.ok(!isEncrypted(NOTE), 'a plain note should not be detected as encrypted')
assert.ok(!isEncrypted(''), 'empty content should not be detected as encrypted')
assert.ok(isEncrypted('\n\n' + sealed), 'leading blank lines should not defeat detection')
ok('isEncrypted() tells envelopes and plain notes apart')

// ---- 3. The envelope leaks no plaintext ----
for (const secret of ['Bank details', 'correct horse', 'café', 'rotate quarterly', 'secrets']) {
  assert.ok(!sealed.includes(secret), `envelope must not contain "${secret}"`)
}
ok('the envelope contains none of the plaintext')

// ---- 4. A wrong password fails loudly instead of returning garbage ----
for (const wrong of ['', 'wrong', PASSWORD + ' ', PASSWORD.toUpperCase(), PASSWORD.slice(0, -1)]) {
  await assert.rejects(
    () => decryptNote(sealed, wrong),
    (err) => err instanceof WrongPasswordError,
    `wrong password ${JSON.stringify(wrong)} must throw WrongPasswordError`
  )
}
ok('every wrong password throws WrongPasswordError (never silent garbage)')

// ---- 5. Tampering with the ciphertext is caught ----
const lines = sealed.trim().split('\n')
const parts = lines[1].split('.')
const body = Buffer.from(parts[4], 'base64')
body[0] ^= 0xff // flip a bit
parts[4] = body.toString('base64')
const tampered = [lines[0], parts.join('.'), lines[2]].join('\n')
await assert.rejects(
  () => decryptNote(tampered, PASSWORD),
  (err) => err instanceof WrongPasswordError,
  'a modified envelope must not decrypt'
)
ok('a tampered envelope is rejected (GCM authentication)')

// ---- 6. Every save produces a different envelope (fresh IV) ----
const again = await encryptNote(NOTE, key)
assert.notStrictEqual(again, sealed, 'two encryptions of the same note must differ')
assert.strictEqual((await decryptNote(again, PASSWORD)).plaintext, NOTE, 'both still decrypt')
ok('re-encrypting uses a fresh IV and both copies still open')

// ---- 7. Two notes with the same password use different salts ----
const otherKey = await createKey(PASSWORD)
const otherSealed = await encryptNote(NOTE, otherKey)
const saltOf = (env) => env.trim().split('\n')[1].split('.')[2]
assert.notStrictEqual(saltOf(sealed), saltOf(otherSealed), 'salts must be per-note')
ok('each note gets its own salt')

// ---- 8. The iteration count is recorded so it can be raised later ----
assert.strictEqual(Number(sealed.trim().split('\n')[1].split('.')[1]), DEFAULT_ITERATIONS)
assert.ok(DEFAULT_ITERATIONS >= 310_000, 'PBKDF2 iterations must meet the OWASP floor')
ok(`the envelope records its iteration count (${DEFAULT_ITERATIONS})`)

// ---- 9. Empty and very large notes both work ----
assert.strictEqual((await decryptNote(await encryptNote('', key), PASSWORD)).plaintext, '')
const big = 'x'.repeat(500_000)
assert.strictEqual((await decryptNote(await encryptNote(big, key), PASSWORD)).plaintext, big)
ok('empty notes and 500 KB notes both round-trip')

// ---- 10. The key returned by decrypt can re-seal the same note ----
const { noteKey: reopened } = await decryptNote(sealed, PASSWORD)
const resealed = await encryptNote('edited after unlocking', reopened)
assert.strictEqual(
  (await decryptNote(resealed, PASSWORD)).plaintext,
  'edited after unlocking',
  'the cached key must re-seal under the same password'
)
ok('the cached key re-seals edits under the same password')

// ---- 11. Garbage input is rejected cleanly, not treated as a note ----
for (const bad of ['-----BEGIN MOONDASH ENCRYPTED NOTE-----\nnope\n-----END MOONDASH ENCRYPTED NOTE-----']) {
  await assert.rejects(() => decryptNote(bad, PASSWORD), 'malformed envelopes must be rejected')
}
ok('malformed envelopes are rejected cleanly')

// ---- 12. The source never marks the derived key extractable ----
const src = readFileSync(new URL('../src/crypto/noteCrypto.ts', import.meta.url), 'utf8')
assert.ok(/false, \/\/ non-extractable/.test(src), 'derived keys must be non-extractable')
ok('derived keys are non-extractable')

console.log('--- crypto: all assertions passed ---')
