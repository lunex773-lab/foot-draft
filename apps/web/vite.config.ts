import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  // card images of the player database (assets/cards, assets/card_templates)
  publicDir: '../../assets',
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': { target: API, changeOrigin: true, ws: true },
    },
  },
});
