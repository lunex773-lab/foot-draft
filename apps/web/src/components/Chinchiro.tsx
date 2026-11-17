import type { Dice, DmThrow, HandKind } from '@fd/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * チンチロ animation (spec 3): the cup is shaken, three dice drop into the
 * bowl and move with gravity, friction and collisions (walls and each other)
 * until they stop on the faces the SERVER rolled. The physics is only for
 * show: the result is decided before the animation starts and cannot be
 * changed by the client.
 */

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [26, 26],
    [50, 50],
    [74, 74],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [27, 27],
    [73, 27],
    [50, 50],
    [27, 73],
    [73, 73],
  ],
  6: [
    [28, 24],
    [72, 24],
    [28, 50],
    [72, 50],
    [28, 76],
    [72, 76],
  ],
};

function Face({ n, size }: { n: number; size: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect x="2" y="2" width="96" height="96" rx="18" fill="#f7f4ec" stroke="#d6d0c2" strokeWidth="3" />
      {PIPS[n].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={n === 1 ? 15 : 9.5} fill={n === 1 ? '#d6202a' : '#1c1c1c'} />
      ))}
    </svg>
  );
}

/** cube faces: which side each number is on (opposite faces sum to 7) */
const FACE_TRANSFORM: Record<number, string> = {
  1: 'rotateY(0deg)',
  6: 'rotateY(180deg)',
  2: 'rotateY(90deg)',
  5: 'rotateY(-90deg)',
  3: 'rotateX(90deg)',
  4: 'rotateX(-90deg)',
};
/** the rotation that turns face n towards the viewer (who looks down into the bowl) */
const SHOW: Record<number, { x: number; y: number }> = { 1: { x: 0, y: 0 }, 6: { x: 0, y: 180 }, 2: { x: 0, y: -90 }, 5: { x: 0, y: 90 }, 3: { x: -90, y: 0 }, 4: { x: 90, y: 0 } };

/** a small seeded random generator, so every viewer sees the same throw */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: { x: number; y: number; z: number };
  yaw: number;
}

interface Frame {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/** the whole throw, simulated once: positions over time (60 fps) */
function simulate(dice: Dice, radius: number, die: number, seed: string, seconds = 2): Frame[][] {
  const r = rng(seed);
  const g = 2600;
  const bodies: Body[] = dice.map((_, i) => {
    const a = r() * Math.PI * 2;
    const speed = 260 + r() * 260;
    return {
      x: (r() - 0.5) * radius * 0.35,
      y: -radius * 0.25 + (i - 1) * die * 0.9,
      z: 170 + r() * 60,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      vz: 120 + r() * 160,
      spin: { x: 720 * (2 + Math.floor(r() * 3)) * (r() < 0.5 ? -1 : 1), y: 720 * (2 + Math.floor(r() * 3)) * (r() < 0.5 ? -1 : 1), z: 360 * (1 + Math.floor(r() * 3)) * (r() < 0.5 ? -1 : 1) },
      yaw: Math.floor(r() * 8) * 45 + (r() - 0.5) * 20,
    };
  });
  const dt = 1 / 120;
  const steps = Math.round(seconds / dt);
  const frames: Frame[][] = dice.map(() => []);
  const wall = radius - die * 0.62;
  for (let step = 0; step <= steps; step++) {
    const t = step * dt;
    for (const b of bodies) {
      // gravity, bounce on the floor of the bowl, friction while sliding
      b.vz -= g * dt;
      b.z += b.vz * dt;
      if (b.z < 0) {
        b.z = 0;
        b.vz = Math.abs(b.vz) > 120 ? -b.vz * 0.42 : 0;
        b.vx *= 0.86;
        b.vy *= 0.86;
      }
      if (b.z === 0) {
        const f = Math.max(0, 1 - 2.8 * dt);
        b.vx *= f;
        b.vy *= f;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // the wall of the bowl
      const d = Math.hypot(b.x, b.y);
      if (d > wall) {
        const nx = b.x / d;
        const ny = b.y / d;
        b.x = nx * wall;
        b.y = ny * wall;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          b.vx -= 1.6 * vn * nx;
          b.vy -= 1.6 * vn * ny;
        }
      }
    }
    // dice hit each other (equal masses)
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        if (dist < die && Math.abs(a.z - b.z) < die) {
          const nx = dx / dist;
          const ny = dy / dist;
          const push = (die - dist) / 2;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const imp = -0.85 * rel;
            a.vx -= imp * nx;
            a.vy -= imp * ny;
            b.vx += imp * nx;
            b.vy += imp * ny;
          }
        }
      }
    if (step % 2 === 0) {
      // the tumbling slows down with the throw and ends exactly on the rolled face
      const p = Math.min(1, t / (seconds * 0.85));
      const left = (1 - p) ** 2.2;
      bodies.forEach((b, i) => {
        const fin = SHOW[dice[i]];
        frames[i].push({ x: b.x, y: b.y, z: b.z, rx: fin.x + b.spin.x * left, ry: fin.y + b.spin.y * left, rz: b.yaw + b.spin.z * left });
      });
    }
  }
  return frames;
}

function Die({ value, size, frame }: { value: number; size: number; frame?: Frame }) {
  const f: Frame = frame ?? { x: 0, y: 0, z: 0, rx: SHOW[value].x, ry: SHOW[value].y, rz: 0 };
  const lift = 1 + f.z / 420;
  return (
    <div className="die-wrap" style={{ width: size, height: size, transform: `translate(${f.x - size / 2}px, ${f.y - size / 2}px)` }}>
      <div className="die-shadow" style={{ width: size, height: size, transform: `translate(${f.z * 0.18}px, ${f.z * 0.28}px) scale(${1 / lift})`, opacity: Math.max(0.15, 0.45 - f.z / 600) }} />
      <div className="die" style={{ width: size, height: size, transform: `scale(${lift}) rotateZ(${f.rz}deg) rotateX(${f.rx}deg) rotateY(${f.ry}deg)` }}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div key={n} className="die-face" style={{ transform: `${FACE_TRANSFORM[n]} translateZ(${size / 2}px)` }}>
            <Face n={n} size={size} />
          </div>
        ))}
      </div>
    </div>
  );
}

export const HAND_TONE: Record<HandKind, string> = { pinzoro: 'gold', shigoro: 'gold', zorome: 'good', normal: 'ok', hifumi: 'bad', none: 'none' };

/**
 * One player's bowl. `last` is the newest throw; `animate` plays it (only for a
 * throw that was just revealed), otherwise the dice are shown where they stopped.
 */
export function Bowl({
  name,
  color,
  last,
  animateKey,
  shaking,
  size = 160,
  you,
}: {
  name: string;
  color: string;
  last: DmThrow | null;
  /** changes for every new throw to animate (null = no animation) */
  animateKey: string | null;
  shaking: boolean;
  size?: number;
  you?: boolean;
}) {
  const die = Math.round(size * 0.2);
  const radius = size / 2;
  const frames = useMemo(() => (last && animateKey ? simulate(last.dice, radius, die, animateKey) : null), [last, animateKey, radius, die]);
  const [i, setI] = useState(frames ? 0 : -1);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!frames) {
      setI(-1);
      return;
    }
    const start = performance.now();
    const total = frames[0].length;
    const tick = (now: number) => {
      const k = Math.min(total - 1, Math.floor(((now - start) / 1000) * 60));
      setI(k);
      if (k < total - 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [frames]);
  const settled = !frames || i >= frames[0].length - 1;
  // where the dice rest when not animating: a fixed, tidy spread
  const rest: Frame[] = [
    { x: -die * 0.95, y: -die * 0.25, z: 0, rx: 0, ry: 0, rz: -8 },
    { x: die * 0.95, y: -die * 0.4, z: 0, rx: 0, ry: 0, rz: 12 },
    { x: 0, y: die * 0.75, z: 0, rx: 0, ry: 0, rz: 4 },
  ];
  return (
    <div className={`bowl-cell ${you ? 'you' : ''}`}>
      <div className="bowl" style={{ width: size, height: size, borderColor: color }}>
        <div className="bowl-inner">
          {last &&
            last.dice.map((v, k) => {
              const f = frames && i >= 0 ? frames[k][i] : { ...rest[k], rx: SHOW[v].x, ry: SHOW[v].y };
              return <Die key={k} value={v} size={die} frame={f} />;
            })}
        </div>
        <div className={`cup ${shaking ? 'shaking' : ''} ${last && !shaking ? 'lifted' : ''}`} aria-hidden="true" />
      </div>
      <div className="bowl-name" style={{ color }}>
        {name}
        {you && <span className="chip on tiny">あなた</span>}
      </div>
      <div className={`hand-label tone-${last && settled ? HAND_TONE[last.hand.kind] : 'wait'}`}>{last && settled ? last.hand.labelJa : shaking ? '振っています…' : '—'}</div>
    </div>
  );
}
