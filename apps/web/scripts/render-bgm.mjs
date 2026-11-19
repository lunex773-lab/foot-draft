/**
 * Renders the background music loops (src/sound/tracks.ts) and the crowd of
 * the SHOOT GACHA (src/sound/crowd.ts, `crowd`) to audio files:
 *
 *   npm run sound:render -w @fd/web                      (every track)
 *   npm run sound:render -w @fd/web -- stadium-legend    (only these; the others stay as they are)
 *   npm run sound:render -w @fd/web -- crowd             (only the crowd clips)
 *
 * The game's own synthesizer runs in headless Chromium (OfflineAudioContext);
 * each loop is written as AAC (.m4a) to assets/audio/ together with
 * manifest.json (file and exact loop length). Needs Playwright with Chromium
 * and ffmpeg. Rendering in the browser of a phone would take too long, so the
 * loops are rendered once here and shipped as files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    contents: "export { renderClip, renderLoop, wavBytes } from './render'; export { TRACKS, loopSeconds } from './tracks'; export { CROWD_CLIPS } from './crowd';",
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
  const all = await page.evaluate(() => window.FDSound.TRACKS.map((t) => t.id));
  const only = process.argv.slice(2);
  const unknown = only.filter((id) => !all.includes(id) && id !== 'crowd');
  if (unknown.length) throw new Error(`unknown track ${unknown.join(', ')} (tracks: ${all.join(', ')})`);
  const ids = only.length ? only.filter((id) => id !== 'crowd') : all;
  const manifestFile = join(OUT, 'manifest.json');
  const manifest = only.length && existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { version: 1, tracks: {} };
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
  // the crowd clips: all rendered at one common level, scaled together so the loudest peaks at 0.9;
  // clipGain (> 0) brings them back to that level in the game
  if (!only.length || only.includes('crowd')) {
    const started = Date.now();
    const r = await page.evaluate(async () => {
      const bufs = [];
      for (const clip of window.FDSound.CROWD_CLIPS) bufs.push({ clip, buf: await window.FDSound.renderClip(clip) });
      let peak = 0;
      for (const { buf } of bufs) for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
      const scale = 0.9 / peak;
      return {
        clipGain: 1 / scale,
        clips: bufs.map(({ clip, buf }) => {
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < d.length; i++) d[i] *= scale;
          }
          const u8 = window.FDSound.wavBytes(buf);
          let s = '';
          for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
          return { id: clip.id, loop: clip.loop, seconds: buf.length / buf.sampleRate, wav: btoa(s) };
        }),
      };
    });
    manifest.clipGain = r.clipGain;
    manifest.clips = {};
    for (const c of r.clips) {
      const wav = join(tmp, `crowd-${c.id}.wav`);
      writeFileSync(wav, Buffer.from(c.wav, 'base64'));
      const file = `crowd-${c.id}.m4a`;
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', join(OUT, file)]);
      manifest.clips[c.id] = { file, seconds: c.seconds, loop: c.loop };
    }
    console.log(`crowd: ${r.clips.length} clips -> assets/audio/crowd-*.m4a (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  // the manifest lists the tracks in the order of TRACKS
  const tracks = Object.fromEntries(all.filter((id) => manifest.tracks[id]).map((id) => [id, manifest.tracks[id]]));
  writeFileSync(manifestFile, `${JSON.stringify({ ...manifest, tracks }, null, 2)}\n`);
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
