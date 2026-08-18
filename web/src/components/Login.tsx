import { useState, type FormEvent } from 'react'
import { HardDrive, Moon, RefreshCw, Smartphone, Globe } from 'lucide-react'
import { useApp } from '../state/AppContext'

export function Login() {
  const { login, register } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
