import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Login.jsx e alguns pages chamam /api relativo (ignoram VITE_API_URL).
      // Respeitar VITE_API_URL permite rodar o front local contra o backend de producao.
      // Default continua o backend local — nada muda para quem roda a stack completa.
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
