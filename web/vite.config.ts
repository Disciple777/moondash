import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Local PHP dev server (e.g. `php -S localhost:8000 -t public`) is proxied
// so the app can use same-origin /api during development.
const API_PROXY = process.env.VITE_API_PROXY || 'http://localhost:8000'

export default defineConfig({
  // Relative base so the built app works from any subfolder (e.g.
  // https://host/moondash/) and from the Electron file:// protocol.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Moondash',
        short_name: 'Moondash',
        description: 'Notion-style markdown notes, synced to the cloud.',
        theme_color: '#f7f7f5',
        background_color: '#f7f7f5',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_PROXY, changeOrigin: true }
    }
  }
})
