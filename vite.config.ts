import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      "/ws": { target: "ws://127.0.0.1:5174", ws: true },
      "/health": { target: "http://127.0.0.1:5174" },
    },
  },
})
