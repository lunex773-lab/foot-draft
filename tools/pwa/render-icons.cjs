// Renders the app icons for "add to home screen" (decision 64) into apps/web/pwa/.
//   node tools/pwa/render-icons.cjs
// Uses Playwright's Chromium and the Oswald font (Google Fonts), like the game's logo.
const { chromium } = require('playwright');
const { join } = require('node:path');

const OUT = join(__dirname, '../../apps/web/pwa');
// pitch centre circle behind "FD" (F white, D gold, as in the logo "FOOTBALL DRAFT")
const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="#1d212c"/>
      <stop offset="100%" stop-color="#0a0b0f"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
    <circle cx="256" cy="256" r="178" fill="none" stroke="#2a2f3d" stroke-width="10"/>
    <line x1="256" y1="40" x2="256" y2="472" stroke="#2a2f3d" stroke-width="10"/>
    <circle cx="256" cy="256" r="14" fill="#2a2f3d"/>
    <text x="256" y="338" text-anchor="middle" font-family="Oswald" font-weight="700" font-size="250" letter-spacing="6">
      <tspan fill="#eef0f5">F</tspan><tspan fill="#e3bf5e">D</tspan>
    </text>
    <rect x="150" y="372" width="212" height="12" rx="6" fill="#e3bf5e"/>
  </g>
</svg>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  const shoot = async (pad, size, file) => {
    await page.setContent(
      `<html><head><link href="https://fonts.googleapis.com/css2?family=Oswald:wght@700&display=block" rel="stylesheet"><style>html,body{margin:0;background:#0a0b0f}</style></head><body>${svg(pad)}</body></html>`,
      { waitUntil: 'networkidle' },
    );
    await page.evaluate(() => document.fonts.ready);
    const ok = await page.evaluate(() => document.fonts.check('700 100px Oswald'));
    if (!ok) throw new Error('Oswald did not load');
    await page.setViewportSize({ width: 512, height: 512 });
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 512, height: 512 } });
    if (size === 512) require('node:fs').writeFileSync(join(OUT, file), buf);
    else {
      // scale down in the browser for a clean result
      const data = buf.toString('base64');
      await page.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${data}" width="${size}" height="${size}"></body></html>`);
      await page.setViewportSize({ width: size, height: size });
      require('node:fs').writeFileSync(join(OUT, file), await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
    }
    console.log('wrote', file);
  };
  await shoot(0, 512, 'icon-512.png');
  await shoot(0, 192, 'icon-192.png');
  // maskable: content inside the 80% safe zone
  await shoot(0.2, 512, 'icon-maskable-512.png');
  await shoot(0.08, 180, 'apple-touch-icon.png');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
