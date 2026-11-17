import '@fontsource/orbitron/latin-900.css';
import { useId } from 'react';

/**
 * The ICON lettering of the SHOOT GACHA (decision 96): heavy italic chrome
 * letters with a dark extrusion, a moving rainbow edge with a glow and a
 * light sweep across the chrome. Drawn as SVG so the gradient edge works on
 * every browser. The font (Orbitron, OFL) is bundled with the game.
 */
export function IconTitle({ text = 'ICON', className = '' }: { text?: string; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const chrome = `chrome${id}`;
  const rainbow = `rainbow${id}`;
  const steel = `steel${id}`;
  const glow = `glow${id}`;
  const clip = `clip${id}`;
  const sweep = `sweep${id}`;
  const t = { x: 320, y: 138, textAnchor: 'middle' as const, fontFamily: 'Orbitron, "Arial Black", sans-serif', fontWeight: 900, fontSize: 132, letterSpacing: 4 };
  return (
    <svg className={`icon-title ${className}`} viewBox="0 0 640 200" role="img" aria-label={text}>
      <defs>
        <linearGradient id={chrome} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#e8eef6" />
          <stop offset="0.47" stopColor="#9aa6b8" />
          <stop offset="0.5" stopColor="#2c3340" />
          <stop offset="0.56" stopColor="#5d6878" />
          <stop offset="0.78" stopColor="#d9e1ec" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <linearGradient id={rainbow} x1="0" y1="0" x2="0.5" y2="0" spreadMethod="repeat">
          <stop offset="0" stopColor="#ff3b6b" />
          <stop offset="0.17" stopColor="#ffb02e" />
          <stop offset="0.33" stopColor="#f6ff3b" />
          <stop offset="0.5" stopColor="#3bff9c" />
          <stop offset="0.67" stopColor="#2bc8ff" />
          <stop offset="0.83" stopColor="#9a5cff" />
          <stop offset="1" stopColor="#ff3b6b" />
          <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="0.5 0" dur="1.4s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id={steel} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a5363" />
          <stop offset="1" stopColor="#0d1118" />
        </linearGradient>
        <linearGradient id={sweep} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id={glow} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <clipPath id={clip}>
          <text {...t}>{text}</text>
        </clipPath>
      </defs>
      <g transform="translate(22 0) skewX(-11)">
        {/* rainbow glow behind */}
        <text {...t} fill="none" stroke={`url(#${rainbow})`} strokeWidth="20" strokeLinejoin="round" filter={`url(#${glow})`} opacity="0.9">
          {text}
        </text>
        {/* extrusion: the letters have depth */}
        {Array.from({ length: 9 }, (_, i) => (
          <text key={i} {...t} x={t.x + (9 - i) * 0.9} y={t.y + (9 - i) * 1.3} fill={`url(#${steel})`} stroke="#05070b" strokeWidth="1">
            {text}
          </text>
        ))}
        {/* rainbow edge */}
        <text {...t} fill="none" stroke={`url(#${rainbow})`} strokeWidth="10" strokeLinejoin="round">
          {text}
        </text>
        <text {...t} fill="none" stroke="#0a0d13" strokeWidth="3.5" strokeLinejoin="round">
          {text}
        </text>
        {/* chrome face */}
        <text {...t} fill={`url(#${chrome})`} stroke="#ffffff" strokeWidth="0.8">
          {text}
        </text>
        {/* a light sweeps across the chrome */}
        <g clipPath={`url(#${clip})`}>
          <rect y="0" width="90" height="200" fill={`url(#${sweep})`} transform="skewX(-20)">
            <animate attributeName="x" values="-160;-160;760" keyTimes="0;0.45;1" dur="2.2s" repeatCount="indefinite" />
          </rect>
        </g>
      </g>
    </svg>
  );
}

/** start loading the font early so the lettering never shows a fallback */
export function preloadIconFont() {
  try {
    void document.fonts?.load('900 100px Orbitron');
  } catch {
    /* fonts API unavailable */
  }
}
