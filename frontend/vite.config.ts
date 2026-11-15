import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // In dev mode (wails dev), the Go backend starts a plain HTTP server
      // on :9191 (see dev_server.go).  All /api/* requests are forwarded
      // there so they reach the Echo handler instead of getting Vite's
      // index.html SPA fallback.
      '/api': {
        target: 'http://127.0.0.1:9191',
        changeOrigin: false,
      },
    },
  },
})
