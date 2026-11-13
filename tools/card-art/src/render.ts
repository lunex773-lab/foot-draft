/**
 * Renders every card: original card image + illustrated player.
 *
 *   npm run cards:render                 # all 300 cards -> assets/cards
 *   npm run cards:render -- FD-001 FD-002 --out /tmp/preview
 *
 * Requires Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { getCatalog } from '@fd/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Appearance } from './appearance';
import { CARD_H, CARD_W, CardArt } from './CardArt';
import { APPEARANCE_JSON, ORIGINAL_CARDS, OUTPUT_CARDS } from './paths';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : OUTPUT_CARDS;
const only = new Set(args.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1));

/** minimal surface of Playwright used here (Playwright is not a project dependency) */
interface PwPage {
  setContent(html: string): Promise<void>;
  evaluate<A>(fn: (arg: A) => Promise<void>, arg: A): Promise<void>;
  locator(sel: string): { screenshot(opts: { omitBackground: boolean }): Promise<Buffer> };
}
interface PwBrowser {
  newPage(opts: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<PwPage>;
  close(): Promise<void>;
}
const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as { chromium: { launch(): Promise<PwBrowser> } };

async function main() {
  const appearance: Record<string, Appearance> = JSON.parse(readFileSync(APPEARANCE_JSON, 'utf8')).players;
  const players = getCatalog().filter((p) => only.size === 0 || only.has(p.id));
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: CARD_W, height: CARD_H }, deviceScaleFactor: 1 });
  await page.setContent('<html><body style="margin:0;background:transparent"><img id="c" width="512" height="680"></body></html>');
  const t0 = Date.now();
  for (const p of players) {
    const a = appearance[p.id];
    if (!a) throw new Error(`no appearance for ${p.id} (run npm run cards:appearance)`);
    const file = p.cardAsset.replace(/^cards\//, '');
    const original = readFileSync(join(ORIGINAL_CARDS, file));
    const svg = renderToStaticMarkup(createElement(CardArt, { player: p, appearance: a, cardDataUrl: `data:image/png;base64,${original.toString('base64')}` }));
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.evaluate(async (s: string) => {
      const img = document.getElementById('c') as HTMLImageElement;
      img.src = s;
      await img.decode();
    }, src);
    const png = await page.locator('#c').screenshot({ omitBackground: true });
    writeFileSync(join(outDir, file), png);
  }
  await browser.close();
  console.log(`rendered ${players.length} cards to ${outDir} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
