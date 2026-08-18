import { useState } from 'react'
import { AlertTriangle, Loader2, Menu, Moon } from 'lucide-react'
import { useApp } from './state/AppContext'
import { Login } from './components/Login'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/Editor'
import { WorkspaceHome } from './components/WorkspaceHome'
import { MultiSpaceModal } from './components/MultiSpaceModal'

function Splash() {
  return (
    <div className="splash">
      <div className="splash-logo">
        <Moon size={30} />
      </div>
      <Loader2 size={18} className="spin" />
    </div>
  )
}

export default function App() {
  const { ready, userEmail, activeDoc, error, dismissError } = useApp()
  // Mobile: the sidebar lives in an off-canvas drawer, opened by the menu
  // button and closed by the backdrop or by navigating.
  const [navOpen, setNavOpen] = useState(false)

  if (!ready) return <Splash />
  if (!userEmail) return <Login />

  return (
    <div className="shell">
      <button
        type="button"
        className="mobile-menu-btn"
        title="Open menu"
        aria-label="Open navigation menu"
        onClick={() => setNavOpen(true)}
      >
        <Menu size={18} />
      </button>
      <div
        className={`sidebar-backdrop${navOpen ? ' is-open' : ''}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <Sidebar mobileOpen={navOpen} onNavigate={() => setNavOpen(false)} />
      <main className="main">
        {activeDoc ? <Editor key={activeDoc.id} doc={activeDoc} /> : <WorkspaceHome />}
      </main>
      <MultiSpaceModal />
      {error && (
        <button className="toast" role="alert" onClick={dismissError} title="Dismiss">
          <AlertTriangle size={14} /> {error}
        </button>
      )}
    </div>
  )
}
