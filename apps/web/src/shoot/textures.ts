import * as THREE from 'three';

/**
 * Procedural textures for the SHOOT GACHA stadium: everything is drawn in
 * code (no image files, no real club / brand assets).
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** a small seeded generator so that the stadium looks the same every time */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** mown grass: stripes, fine blade noise and soft patches */
export function grassTexture(anisotropy: number): THREE.Texture {
  const [c, g] = canvas(1024, 1024);
  const r = seeded(7);
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 === 0 ? '#2f6b2c' : '#3a7a33';
    g.fillRect(0, (i * 1024) / stripes, 1024, 1024 / stripes);
  }
  // soft patches
  for (let i = 0; i < 140; i++) {
    const x = r() * 1024;
    const y = r() * 1024;
    const rad = 30 + r() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.5;
    grd.addColorStop(0, dark ? 'rgba(20,50,20,0.10)' : 'rgba(120,170,80,0.08)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // blades
  for (let i = 0; i < 90000; i++) {
    const x = r() * 1024;
    const y = r() * 1024;
    const l = 40 + r() * 70;
    g.fillStyle = `rgba(${l * 0.6},${l * 1.6 + 40},${l * 0.5},${0.18 + r() * 0.2})`;
    g.fillRect(x, y, 1, 1 + r() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** a grey-scale bump for the grass (small blade relief) */
export function grassBump(): THREE.Texture {
  const [c, g] = canvas(512, 512);
  const r = seeded(11);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 40000; i++) {
    const v = Math.floor(90 + r() * 120);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(r() * 512, r() * 512, 1, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** a crowd: rows of people (shirts, heads), some in the home colours, phone lights */
export function crowdTexture(seed: number, palette: string[]): THREE.Texture {
  const [c, g] = canvas(2048, 1024);
  const r = seeded(seed);
  g.fillStyle = '#101216';
  g.fillRect(0, 0, 2048, 1024);
  const rows = 40;
  const rh = 1024 / rows;
  for (let row = 0; row < rows; row++) {
    const y = row * rh;
    g.fillStyle = row % 2 ? '#191c22' : '#14171c';
    g.fillRect(0, y, 2048, rh);
    let x = r() * 8;
    while (x < 2048) {
      const w = 9 + r() * 7;
      if (r() > 0.08) {
        const shirt = r() < 0.22 ? palette[Math.floor(r() * palette.length)] : `hsl(${Math.floor(r() * 360)},${10 + r() * 30}%,${18 + r() * 34}%)`;
        g.fillStyle = shirt;
        g.fillRect(x, y + rh * 0.42, w - 1.5, rh * 0.58);
        g.fillStyle = `hsl(${20 + r() * 20},${30 + r() * 30}%,${25 + r() * 45}%)`;
        g.beginPath();
        g.arc(x + w / 2 - 0.7, y + rh * 0.3, w * 0.28, 0, Math.PI * 2);
        g.fill();
        if (r() < 0.012) {
          g.fillStyle = 'rgba(255,255,240,0.95)';
          g.fillRect(x + w / 2 - 1, y + rh * 0.12, 2, 2);
        }
      }
      x += w;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a modern match ball: white base, curved neon / dark panels (generic design) */
export function ballTexture(): THREE.Texture {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, 1024, 512);
  const r = seeded(3);
  // curved panels
  for (let i = 0; i < 6; i++) {
    const cx = (i / 6) * 1024 + 80;
    const cy = i % 2 ? 150 : 360;
    g.save();
    g.translate(cx, cy);
    g.rotate(r() * Math.PI);
    g.fillStyle = i % 2 ? '#141414' : '#2a2f3a';
    g.beginPath();
    g.moveTo(-90, -30);
    g.bezierCurveTo(-40, -110, 60, -100, 100, -20);
    g.bezierCurveTo(70, 40, -20, 70, -90, -30);
    g.fill();
    g.strokeStyle = '#d6ff1f';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(-70, -18);
    g.bezierCurveTo(-30, -80, 40, -76, 80, -16);
    g.stroke();
    g.restore();
  }
  // seams
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    g.moveTo((i / 12) * 1024, 0);
    g.bezierCurveTo((i / 12) * 1024 + 60, 170, (i / 12) * 1024 - 60, 340, (i / 12) * 1024, 512);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** LED advertising board text (the game's own name only) */
export function ledTexture(text: string, color: string): THREE.Texture {
  // one text per tile (the texture repeats without a seam)
  const [c, g] = canvas(1024, 128);
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, 1024, 128);
  g.font = 'bold 76px "Arial Black", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = color;
  g.fillText(text, 512, 66);
  g.fillStyle = '#ffffff';
  g.fillRect(40, 58, 26, 14);
  g.fillRect(958, 58, 26, 14);
  // LED dots
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 1024, 1);
  for (let xx = 0; xx < 1024; xx += 4) g.fillRect(xx, 0, 1, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a soft round glow (lights, particles, flares) */
export function glowTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** the night sky behind the stands: dark gradient with haze from the floodlights */
export function skyTexture(): THREE.Texture {
  const [c, g] = canvas(16, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#05070d');
  grd.addColorStop(0.55, '#0c1424');
  grd.addColorStop(0.8, '#1b2a3c');
  grd.addColorStop(1, '#2b3b4a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** fabric with a fine knit for the kits */
export function fabricTexture(base: string, stripe?: string): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  if (stripe) {
    g.fillStyle = stripe;
    g.fillRect(0, 110, 256, 10);
    g.fillRect(0, 128, 256, 4);
  }
  const r = seeded(base.length * 31);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    g.fillRect(r() * 256, r() * 256, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
