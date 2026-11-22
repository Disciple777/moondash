import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Lock, LockOpen, Loader2, ShieldCheck } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { CryptoUnavailableError, WrongPasswordError } from '../crypto/noteCrypto'

/**
 * The screen shown instead of the editor when a password-protected note is
 * opened. The note stays sealed until the right password arrives — a wrong one
 * is reported as such and changes nothing on disk.
 */
export function LockScreen() {
  const { lockedDoc, lockedQuickFile, unlockDoc, cancelUnlock } = useApp()
  const title = lockedQuickFile?.fileName ?? lockedDoc?.title ?? ''
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    setPassword('')
    setFailed(null)
  }, [lockedDoc, lockedQuickFile])

  if (!lockedDoc && !lockedQuickFile) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || password === '') return
    setBusy(true)
    setFailed(null)
    try {
      await unlockDoc(password)
    } catch (err) {
      setFailed(
        err instanceof WrongPasswordError
          ? 'Wrong password — the note was not changed.'
          : err instanceof CryptoUnavailableError
            ? err.message
            : 'Could not open this note.'
      )
      setPassword('')
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <span className="lock-badge">
          <Lock size={22} />
        </span>
        <h2 className="lock-title">{title}</h2>
        <p className="lock-sub">This note is password-protected.</p>

        <input
          ref={inputRef}
          type="password"
          className="lock-input"
          value={password}
          placeholder="Password"
          autoComplete="current-password"
          onChange={(e) => {
            setPassword(e.target.value)
            setFailed(null)
          }}
          disabled={busy}
        />

        {failed && (
          <p className="lock-error" role="alert">
            <AlertTriangle size={13} /> {failed}
          </p>
        )}

        <div className="lock-actions">
          <button type="button" className="btn ghost" onClick={cancelUnlock} disabled={busy}>
            Back
          </button>
          <button type="submit" className="btn primary" disabled={busy || password === ''}>
            {busy ? (
              <>
                <Loader2 size={14} className="spin" /> Unlocking…
              </>
            ) : (
              <>
                <LockOpen size={14} /> Unlock
              </>
            )}
          </button>
        </div>

        <p className="lock-note">
          There is no way to recover the text without this password — not from the app, the
          file, or the cloud copy.
        </p>
      </form>
    </div>
  )
}

/**
 * Dialog for putting a password on the open note, or taking it off again.
 * `markdown` is the live editor content, so nothing typed since the last save
 * is lost when the note is sealed.
 */
export function ProtectDialog({
  markdown,
  onClose
}: {
  markdown: string
  onClose: () => void
}) {
  const { activeDocProtected, protectDoc, unprotectDoc } = useApp()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const removing = activeDocProtected

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!removing) {
      if (password.length < 8) {
        setProblem('Use at least 8 characters.')
        return
      }
      if (password !== confirm) {
        setProblem('The two passwords do not match.')
        return
      }
    }
    setBusy(true)
    setProblem(null)
    try {
      if (removing) await unprotectDoc(markdown)
      else await protectDoc(password, markdown)
      onClose()
    } catch (err) {
      // Show what actually went wrong — protectDoc verifies the note really was
      // written in its sealed form, and that failure must never look like success.
      setProblem(err instanceof Error ? err.message : 'Could not update this note.')
      setBusy(false)
    }
  }

  return (
    // .modal-backdrop is the centering CONTAINER, not a separate overlay layer:
    // .modal has to be its child or the backdrop paints over the dialog and
    // swallows every click.
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form className="modal protect-modal" onSubmit={submit}>
        <h3 className="modal-title">
          {removing ? <LockOpen size={16} /> : <Lock size={16} />}
          {removing ? 'Remove password' : 'Protect with a password'}
        </h3>

        {removing ? (
          <p className="protect-copy">
            The note will be saved as ordinary text again, readable by anyone who opens the
            file.
          </p>
        ) : (
          <>
            <p className="protect-copy">
              The note is encrypted before it is written anywhere — the file on disk and the
              cloud copy hold only the sealed text. The title stays visible.
            </p>
            <label className="dialog-label" htmlFor="protect-pw">
              Password
            </label>
            <input
              id="protect-pw"
              ref={inputRef}
              type="password"
              className="lock-input"
              value={password}
              autoComplete="new-password"
              onChange={(e) => {
                setPassword(e.target.value)
                setProblem(null)
              }}
              disabled={busy}
            />
            <label className="dialog-label" htmlFor="protect-pw2">
              Confirm password
            </label>
            <input
              id="protect-pw2"
              type="password"
              className="lock-input"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => {
                setConfirm(e.target.value)
                setProblem(null)
              }}
              disabled={busy}
            />
            <p className="lock-note">
              Keep it somewhere safe. If you forget it the note cannot be recovered — there is
              no reset and no backdoor.
            </p>
          </>
        )}

        {problem && (
          <p className="lock-error" role="alert">
            <AlertTriangle size={13} /> {problem}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={14} className="spin" /> Saving…
              </>
            ) : removing ? (
              <>
                <LockOpen size={14} /> Remove password
              </>
            ) : (
              <>
                <ShieldCheck size={14} /> Protect note
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
