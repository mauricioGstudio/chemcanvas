import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the build also runs from disk (Electron desktop app)
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // Never watch packaging output — the watcher's file handles break
      // electron-builder's directory renames on Windows.
      ignored: ['**/release/**', '**/node_modules/**'],
    },
  },
})
