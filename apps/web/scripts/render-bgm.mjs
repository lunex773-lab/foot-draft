/**
 * Renders the background music loops (src/sound/tracks.ts) to audio files:
 *
 *   npm run sound:render -w @fd/web
 *
 * The game's own synthesizer runs in headless Chromium (OfflineAudioContext);
 * each loop is written as AAC (.m4a) to assets/audio/ together with
 * manifest.json (file and exact loop length). Needs Playwright with Chromium
 * and ffmpeg. Rendering in the browser of a phone would take too long, so the
 * loops are rendered once here and shipped as files.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', 'assets', 'audio');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const bundle = await build({
  stdin: {
    contents: "export { renderLoop, wavBytes } from './render'; export { TRACKS, loopSeconds } from './tracks';",
    resolveDir: join(HERE, '..', 'src', 'sound'),
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  globalName: 'FDSound',
  write: false,
  target: 'es2022',
});

mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'fd-bgm-'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>render</title>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const ids = await page.evaluate(() => window.FDSound.TRACKS.map((t) => t.id));
  const manifest = { version: 1, tracks: {} };
  for (const id of ids) {
    const started = Date.now();
    const r = await page.evaluate(async (id) => {
      const tr = window.FDSound.TRACKS.find((t) => t.id === id);
      const buf = await window.FDSound.renderLoop(tr);
      const u8 = window.FDSound.wavBytes(buf);
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return { wav: btoa(s), frames: buf.length, sampleRate: buf.sampleRate };
    }, id);
    const wav = join(tmp, `${id}.wav`);
    writeFileSync(wav, Buffer.from(r.wav, 'base64'));
    const file = `bgm-${id}.m4a`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', join(OUT, file)]);
    manifest.tracks[id] = { file, loopSeconds: r.frames / r.sampleRate };
    console.log(`${id}: ${(r.frames / r.sampleRate).toFixed(2)} s -> assets/audio/${file} (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
