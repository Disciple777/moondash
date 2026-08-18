import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './state/AppContext'
import { ThemeProvider } from './state/ThemeContext'
import { PrefsProvider } from './state/PrefsContext'
import './styles.css'

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
