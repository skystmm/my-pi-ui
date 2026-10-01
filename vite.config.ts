import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PI_UI_WEB_PORT ?? 5173),
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      "/ws": { target: `ws://127.0.0.1:${process.env.PI_UI_PORT ?? 5174}`, ws: true },
      "/health": { target: `http://127.0.0.1:${process.env.PI_UI_PORT ?? 5174}` },
    },
  },
})
