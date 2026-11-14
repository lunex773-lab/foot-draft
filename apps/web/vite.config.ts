import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const API = process.env.FD_API_URL ?? 'http://127.0.0.1:8787';
/** identifies this build; the game compares it with /version.json to notice a newer one */
const BUILD_ID = process.env.GITHUB_SHA ? `${process.env.GITHUB_SHA.slice(0, 12)}-${Date.now()}` : `dev-${Date.now()}`;

/** "add to home screen" (decision 64): manifest, icons and the build id, in dev and in the build */
function pwa(): Plugin {
  const dir = join(__dirname, 'pwa');
  const manifest = JSON.stringify(
    {
      name: 'FOOTBALL DRAFT',
      short_name: 'FD DRAFT',
      description: 'サッカー選手のドラフトとチーム編成で戦うオンライン対戦ゲーム',
      lang: 'ja',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#0a0b0f',
      theme_color: '#0a0b0f',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  );
  const files: Record<string, () => string | Buffer> = {
    'manifest.webmanifest': () => manifest,
    'version.json': () => JSON.stringify({ build: BUILD_ID }),
    'icon-192.png': () => readFileSync(join(dir, 'icon-192.png')),
    'icon-512.png': () => readFileSync(join(dir, 'icon-512.png')),
    'icon-maskable-512.png': () => readFileSync(join(dir, 'icon-maskable-512.png')),
    'apple-touch-icon.png': () => readFileSync(join(dir, 'apple-touch-icon.png')),
  };
  const types: Record<string, string> = { webmanifest: 'application/manifest+json', json: 'application/json', png: 'image/png' };
  return {
    name: 'fd-pwa',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? '').split('?')[0].slice(1);
        if (!files[name]) return next();
        res.setHeader('Content-Type', types[name.split('.').pop()!] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(files[name]());
      });
    },
    generateBundle() {
      for (const [fileName, read] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source: read() });
    },
  };
}

export default defineConfig({
  plugins: [react(), pwa()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // card images of the player database (assets/cards, assets/card_templates)
  publicDir: '../../assets',
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': { target: API, changeOrigin: true, ws: true },
    },
  },
});
