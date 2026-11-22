import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './state/AppContext'
import { ThemeProvider } from './state/ThemeContext'
import { PrefsProvider } from './state/PrefsContext'
import { applyAppearance, loadAppearance } from './appearance'
import './styles.css'

// Before the first render: PrefsProvider applies these in an effect, which
// would let one frame paint at the default size and then jump.
applyAppearance(loadAppearance())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <PrefsProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </PrefsProvider>
    </ThemeProvider>
  </React.StrictMode>
)
