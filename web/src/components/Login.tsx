import { useState, type FormEvent } from 'react'
import { HardDrive, Moon, RefreshCw, Server, Smartphone, Globe } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { API_BASE, setApiBase } from '../api/client'

/** Host part of the API URL, for a compact "Server: …" line. */
function hostOf(url: string): string {
  // An empty base means same-origin (the app is served next to the API).
  if (!url) return window.location.host || 'this site'
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function Login() {
  const { login, register } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The server is changeable right here: on a fresh desktop install this is the
  // only screen you can reach, and the Local sync settings sit behind it.
  const [server, setServer] = useState(API_BASE)
  const [editingServer, setEditingServer] = useState(false)
  const [serverDraft, setServerDraft] = useState(API_BASE)
  const [serverError, setServerError] = useState<string | null>(null)

  const saveServer = () => {
    const clean = serverDraft.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s/]+/i.test(clean)) {
      setServerError('Enter a full address starting with https://')
      return
    }
    setApiBase(clean)
    setServer(clean)
    setEditingServer(false)
    setServerError(null)
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <Moon size={22} />
        </div>
        <h1 className="login-title">Moondash</h1>
        <p className="login-sub">
          Notion-style markdown notes, synced to the cloud and to your local folders.
        </p>

        <div className="tabs">
          <button
            className={`tab ${mode === 'login' ? 'is-active' : ''}`}
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            className={`tab ${mode === 'register' ? 'is-active' : ''}`}
            onClick={() => setMode('register')}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="login-form">
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              required
              minLength={mode === 'register' ? 8 : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? (
              <RefreshCw size={15} className="spin" />
            ) : mode === 'login' ? (
              'Log in'
            ) : (
              'Create account'
            )}
          </button>
        </form>

        <div className="login-server">
          {editingServer ? (
            <form
              className="login-server-edit"
              onSubmit={(e) => {
                e.preventDefault()
                saveServer()
              }}
            >
              <input
                autoFocus
                value={serverDraft}
                onChange={(e) => {
                  setServerDraft(e.target.value)
                  setServerError(null)
                }}
                placeholder="https://your-host.com/moondash/backend/public"
                spellCheck={false}
              />
              <button type="submit" className="btn primary">
                Save
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setEditingServer(false)
                  setServerDraft(server)
                  setServerError(null)
                }}
              >
                Cancel
              </button>
              {serverError && <div className="form-error">{serverError}</div>}
            </form>
          ) : (
            <span>
              <Server size={12} /> Server: <strong title={server}>{hostOf(server)}</strong>
              <button
                type="button"
                className="login-server-change"
                onClick={() => {
                  setServerDraft(server)
                  setEditingServer(true)
                }}
              >
                Change
              </button>
            </span>
          )}
        </div>

        <div className="login-features">
          <span>
            <Globe size={13} /> Web &amp; PWA
          </span>
          <span>
            <HardDrive size={13} /> Windows desktop
          </span>
          <span>
            <Smartphone size={13} /> Phone
          </span>
        </div>
      </div>
    </div>
  )
}
