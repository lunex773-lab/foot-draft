import type { Appearance, ClubInfo } from '@fd/shared';
import { ClubCrestGroup } from './Crest';
import { EYE_COLORS, HAIR_COLORS, SKIN_SHADOWS, SKIN_TONES } from './theme';

/**
 * Procedurally generated illustrated portrait (no photos, no real people).
 * Drawn in a 200 x 220 box: head & shoulders wearing the club's (fictional) kit.
 */
export interface PortraitProps {
  appearance: Appearance;
  club: ClubInfo;
  /** unique id prefix for SVG defs */
  uid: string;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const JERSEY = 'M6 222 L12 192 C18 172 48 160 74 155 L126 155 C152 160 182 172 188 192 L194 222 Z';

function JerseyPattern({ club, uid }: { club: ClubInfo; uid: string }) {
  const c = club.secondary;
  switch (club.pattern) {
    case 'stripes':
      return (
        <g clipPath={`url(#${uid}-jersey)`} opacity={0.9}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <rect key={i} x={12 + i * 24} y={150} width={12} height={80} fill={c} />
          ))}
        </g>
      );
    case 'pinstripe':
      return (
        <g clipPath={`url(#${uid}-jersey)`} opacity={0.75}>
          {Array.from({ length: 18 }, (_, i) => (
            <rect key={i} x={4 + i * 11} y={150} width={2} height={80} fill={c} />
          ))}
        </g>
      );
    case 'hoops':
      return (
        <g clipPath={`url(#${uid}-jersey)`} opacity={0.9}>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={0} y={168 + i * 20} width={200} height={10} fill={c} />
          ))}
        </g>
      );
    case 'sash':
      return (
        <g clipPath={`url(#${uid}-jersey)`} opacity={0.92}>
          <polygon points="40,150 70,150 170,230 140,230" fill={c} />
        </g>
      );
    case 'halves':
      return (
        <g clipPath={`url(#${uid}-jersey)`} opacity={0.92}>
          <rect x={100} y={150} width={100} height={80} fill={c} />
        </g>
      );
    case 'chevron':
      return (
        <g clipPath={`url(#${uid}-jersey)`} opacity={0.92}>
          <polygon points="0,170 100,205 200,170 200,184 100,219 0,184" fill={c} />
        </g>
      );
    default:
      return (
        <g clipPath={`url(#${uid}-jersey)`} opacity={0.5}>
          <path d="M12 192 C18 172 48 160 74 155 L80 160 C55 168 30 180 20 200 Z" fill={c} />
          <path d="M188 192 C182 172 152 160 126 155 L120 160 C145 168 170 180 180 200 Z" fill={c} />
        </g>
      );
  }
}

function hairPaths(a: Appearance, cx: number, hw: number, top: number): { back: string; front: string[]; opacity: number } {
  const l = cx - hw;
  const r = cx + hw;
  const skullTop = top;
  const cap = (lift: number, hairline: number, sideDrop = 86) =>
    `M${l - 1} ${sideDrop} C${l - 3} ${skullTop + 12 - lift} ${cx - hw * 0.7} ${skullTop - lift} ${cx} ${skullTop - lift} C${cx + hw * 0.7} ${skullTop - lift} ${r + 3} ${skullTop + 12 - lift} ${r + 1} ${sideDrop} L${r - 3} ${sideDrop - 6} C${r - 4} ${hairline + 6} ${cx + hw * 0.5} ${hairline} ${cx} ${hairline} C${cx - hw * 0.5} ${hairline} ${l + 4} ${hairline + 6} ${l + 3} ${sideDrop - 6} Z`;
  const circle = (x: number, y: number, rad: number) => `M${x - rad} ${y} a${rad} ${rad} 0 1 1 ${rad * 2} 0 a${rad} ${rad} 0 1 1 ${-rad * 2} 0 Z`;
  switch (a.hairStyle) {
    case 'bald':
      return { back: '', front: [], opacity: 0 };
    case 'buzz':
      return { back: '', front: [cap(0, 60, 84)], opacity: 0.78 };
    case 'short':
      return { back: '', front: [cap(4, 62)], opacity: 1 };
    case 'crop':
      return { back: '', front: [cap(5, 66), `M${cx - hw * 0.75} 61 L${cx + hw * 0.75} 61 L${cx + hw * 0.7} 69 L${cx - hw * 0.7} 69 Z`], opacity: 1 };
    case 'side_part':
      return {
        back: '',
        front: [cap(7, 63), `M${cx - hw * 0.9} 60 C${cx - hw * 0.4} ${skullTop - 12} ${cx + hw} ${skullTop - 8} ${r + 2} 70 C${cx + hw * 0.4} 58 ${cx - hw * 0.2} 58 ${cx - hw * 0.9} 66 Z`],
        opacity: 1,
      };
    case 'quiff':
      return {
        back: '',
        front: [cap(6, 63), `M${cx - hw * 0.8} 62 C${cx - hw * 0.8} ${skullTop - 22} ${cx + hw * 0.5} ${skullTop - 26} ${cx + hw * 0.9} ${skullTop - 4} C${cx + hw * 0.5} ${skullTop - 10} ${cx - hw * 0.2} ${skullTop - 8} ${cx - hw * 0.5} 64 Z`],
        opacity: 1,
      };
    case 'curly': {
      const pieces = [cap(6, 62)];
      const n = 12;
      for (let i = 0; i < n; i++) {
        const ang = Math.PI + (i / (n - 1)) * Math.PI;
        pieces.push(circle(cx + Math.cos(ang) * (hw + 1), 74 + Math.sin(ang) * (74 - skullTop + 4), 7.5));
      }
      for (let i = 0; i < 4; i++) pieces.push(circle(cx - hw * 0.5 + i * hw * 0.33, skullTop - 2, 7));
      return { back: '', front: pieces, opacity: 1 };
    }
    case 'afro':
      return {
        back: `M${cx - hw - 18} ${skullTop + 18} a${hw + 18} 44 0 1 1 ${2 * (hw + 18)} 0 a${hw + 18} 44 0 1 1 ${-2 * (hw + 18)} 0 Z`,
        front: [cap(10, 64)],
        opacity: 1,
      };
    case 'waves':
      return { back: '', front: [cap(2, 61, 84)], opacity: 0.92 };
    case 'long':
      return {
        back: `M${l - 6} 70 C${l - 14} 120 ${l - 18} 160 ${l - 4} 175 L${r + 4} 175 C${r + 18} 160 ${r + 14} 120 ${r + 6} 70 C${r} ${skullTop - 4} ${l} ${skullTop - 4} ${l - 6} 70 Z`,
        front: [
          cap(6, 62),
          `M${l - 2} 70 C${l + 6} 64 ${cx - hw * 0.3} 58 ${cx} 60 C${cx - hw * 0.5} 66 ${l + 6} 84 ${l + 2} 112 L${l - 5} 108 Z`,
          `M${r + 2} 70 C${r - 6} 64 ${cx + hw * 0.3} 58 ${cx} 60 C${cx + hw * 0.5} 66 ${r - 6} 84 ${r - 2} 112 L${r + 5} 108 Z`,
        ],
        opacity: 1,
      };
    case 'man_bun':
      return { back: circle(cx + 14, skullTop - 6, 10.5), front: [cap(3, 61)], opacity: 1 };
    case 'mohawk':
      return {
        back: '',
        front: [cap(0, 62, 82), `M${cx - 8} 62 C${cx - 10} ${skullTop - 16} ${cx + 10} ${skullTop - 16} ${cx + 8} 62 Z`],
        opacity: 0.6,
      };
  }
}

export function PortraitGroup({ appearance: a, club, uid }: PortraitProps) {
  const t = Math.max(-1, Math.min(1, a.headTurn));
  const cx = 100 + t * 3;
  const hw = 25 + a.faceWidth * 6;
  const jw = hw * (0.6 + a.jawWidth * 0.22);
  const top = 46;
  const skin = SKIN_TONES[a.skinTone] ?? SKIN_TONES[1];
  const skinShadow = SKIN_SHADOWS[a.skinTone] ?? SKIN_SHADOWS[1];
  const hair = HAIR_COLORS[a.hairColor] ?? HAIR_COLORS[0];
  const eye = EYE_COLORS[a.eyeColor] ?? EYE_COLORS[0];
  const fx = t * 7; // feature shift for the 3/4 view
  const head = `M${cx - hw} 88 C${cx - hw} 56 ${cx - hw * 0.6} ${top} ${cx} ${top} C${cx + hw * 0.6} ${top} ${cx + hw} 56 ${cx + hw} 88 C${cx + hw} 108 ${cx + jw + 3} 121 ${cx + jw * 0.42} 129 Q${cx + fx * 0.3} 135 ${cx - jw * 0.42} 129 C${cx - jw - 3} 121 ${cx - hw} 108 ${cx - hw} 88 Z`;
  const jaw = `M${cx - hw + 2} 98 C${cx - hw + 3} 112 ${cx - jw - 2} 122 ${cx - jw * 0.42} 129 Q${cx + fx * 0.3} 135 ${cx + jw * 0.42} 129 C${cx + jw + 2} 122 ${cx + hw - 3} 112 ${cx + hw - 2} 98 C${cx + hw * 0.5} 106 ${cx - hw * 0.5} 106 ${cx - hw + 2} 98 Z`;
  const eyeY = 88;
  const spacing = hw * 0.42;
  const eyes = [cx - spacing + fx, cx + spacing + fx];
  const shout = a.expression === 'shout';
  const focused = a.expression === 'focused';
  const eyeH = shout ? 3.4 : focused ? 3.8 : 4.6;
  const browY = eyeY - 9 - (shout ? 2 : 0);
  const browW = 2 + a.browWeight * 2.6;
  const noseX = cx + fx * 1.15;
  const ns = 0.8 + a.noseSize * 0.5;
  const mouthY = 114;
  const mw = (9 + a.mouthWidth * 6) / 2;
  const mx = cx + fx * 1.05;
  const hp = hairPaths(a, cx, hw, top);
  const darkHair = shade(hair, -25);

  return (
    <g>
      <defs>
        <clipPath id={`${uid}-jersey`}>
          <path d={JERSEY} />
        </clipPath>
        <radialGradient id={`${uid}-face`} cx={0.42 - t * 0.12} cy={0.38} r={0.75}>
          <stop offset="0" stopColor={shade(skin, 14)} />
          <stop offset="0.55" stopColor={skin} />
          <stop offset="1" stopColor={skinShadow} />
        </radialGradient>
        <linearGradient id={`${uid}-neck`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(skinShadow, -18)} />
          <stop offset="0.5" stopColor={skinShadow} />
          <stop offset="1" stopColor={skin} />
        </linearGradient>
        <linearGradient id={`${uid}-kit`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="0.65" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={`${uid}-hair`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(hair, 30)} />
          <stop offset="1" stopColor={hair} />
        </linearGradient>
      </defs>

      {/* back hair */}
      {hp.back && <path d={hp.back} fill={`url(#${uid}-hair)`} />}

      {/* neck */}
      <path d={`M${cx - 15} 112 L${cx + 15} 112 L${cx + 19} 162 L${cx - 19} 162 Z`} fill={`url(#${uid}-neck)`} />

      {/* jersey */}
      <path d={JERSEY} fill={club.primary} />
      <JerseyPattern club={club} uid={uid} />
      <path d={JERSEY} fill={`url(#${uid}-kit)`} />
      {/* collar */}
      {club.pattern === 'hoops' || club.pattern === 'solid' ? (
        <path d={`M76 155 Q100 172 124 155`} fill="none" stroke={club.accent} strokeWidth={5} strokeLinecap="round" />
      ) : (
        <path d={`M78 155 L100 176 L122 155`} fill="none" stroke={club.accent} strokeWidth={4.5} strokeLinejoin="round" />
      )}
      {/* shoulder seams */}
      <path d="M40 166 C52 176 58 196 58 222" fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={1.5} />
      <path d="M160 166 C148 176 142 196 142 222" fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={1.5} />
      {/* club crest on the chest */}
      <g transform="translate(124 176) scale(0.36)">
        <ClubCrestGroup club={club} uid={`${uid}-chest`} />
      </g>

      {/* ears */}
      <ellipse cx={cx - hw - 1 + t * 2} cy={92} rx={5 - Math.max(0, t) * 2} ry={9} fill={skinShadow} />
      <ellipse cx={cx + hw + 1 + t * 2} cy={92} rx={5 + Math.min(0, t) * 2} ry={9} fill={skinShadow} />

      {/* shadow cast by the chin on the neck */}
      <ellipse cx={cx + fx * 0.3} cy={131} rx={jw * 0.7} ry={6} fill={shade(skinShadow, -35)} opacity={0.32} />
      {/* head */}
      <path d={head} fill={`url(#${uid}-face)`} />
      {/* eye sockets & nose bridge */}
      {eyes.map((ex, i) => (
        <ellipse key={`s${i}`} cx={ex} cy={eyeY - 2} rx={9} ry={6} fill={skinShadow} opacity={0.35} />
      ))}
      <path d={`M${noseX + 1.5} ${eyeY - 2} L${noseX + 2.2} ${eyeY + 12}`} stroke="#fff" strokeOpacity={0.22} strokeWidth={2.2} strokeLinecap="round" />
      <ellipse cx={cx - hw * 0.5 + fx} cy={104} rx={6} ry={4} fill="#e88b7a" opacity={0.12} />
      <ellipse cx={cx + hw * 0.5 + fx} cy={104} rx={6} ry={4} fill="#e88b7a" opacity={0.12} />
      {/* cheek shadow on the far side */}
      <path d={`M${cx + (t >= 0 ? -hw : hw)} 90 C${cx + (t >= 0 ? -hw + 4 : hw - 4)} 112 ${cx + (t >= 0 ? -jw : jw)} 124 ${cx + (t >= 0 ? -jw * 0.4 : jw * 0.4)} 130 L${cx + (t >= 0 ? -hw * 0.55 : hw * 0.55)} 104 Z`} fill={skinShadow} opacity={0.45} />

      {/* facial hair */}
      {a.facialHair === 'stubble' && <path d={jaw} fill={hair} opacity={0.22} />}
      {a.facialHair === 'beard' && <path d={jaw} fill={hair} opacity={0.88} />}
      {a.facialHair === 'goatee' && <path d={`M${mx - 8} 118 Q${mx} 136 ${mx + 8} 118 Q${mx} 124 ${mx - 8} 118 Z`} fill={hair} opacity={0.85} />}

      {/* eyes */}
      {eyes.map((ex, i) => (
        <g key={i}>
          <path d={`M${ex - 6} ${eyeY} Q${ex} ${eyeY - eyeH - 1} ${ex + 6} ${eyeY} Q${ex} ${eyeY + eyeH - 1} ${ex - 6} ${eyeY} Z`} fill="#f4efe6" />
          <circle cx={ex + t * 1.5} cy={eyeY - 0.2} r={2.5} fill={eye} />
          <circle cx={ex + t * 1.5} cy={eyeY - 0.2} r={1.15} fill="#111" />
          <circle cx={ex + t * 1.5 + 0.9} cy={eyeY - 1.1} r={0.55} fill="#fff" />
          <path d={`M${ex - 6.5} ${eyeY} Q${ex} ${eyeY - eyeH - 1.6} ${ex + 6.5} ${eyeY}`} fill="none" stroke={shade(skinShadow, -60)} strokeWidth={1.3} />
        </g>
      ))}
      {/* brows */}
      {eyes.map((ex, i) => {
        const inner = i === 0 ? ex + 7 : ex - 7;
        const outer = i === 0 ? ex - 7 : ex + 7;
        const innerY = browY + (focused ? 2.5 : shout ? -1 : 0.5);
        const outerY = browY + (shout ? 1.5 : 0.8);
        return (
          <path
            key={i}
            d={`M${outer} ${outerY} Q${ex} ${browY - 2.2} ${inner} ${innerY}`}
            fill="none"
            stroke={darkHair}
            strokeWidth={browW}
            strokeLinecap="round"
          />
        );
      })}
      {/* nose */}
      <path d={`M${noseX - 1} ${eyeY + 2} C${noseX - 2} ${eyeY + 8} ${noseX - 5 * ns} ${eyeY + 13 * ns} ${noseX - 4 * ns} ${eyeY + 15 * ns} Q${noseX} ${eyeY + 18 * ns} ${noseX + 4 * ns} ${eyeY + 15 * ns}`} fill="none" stroke={shade(skinShadow, -30)} strokeWidth={1.3} strokeLinecap="round" opacity={0.85} />
      {/* mouth */}
      {shout ? (
        <g>
          <ellipse cx={mx} cy={mouthY + 2} rx={mw + 1} ry={6.5} fill="#5a1f1f" />
          <rect x={mx - mw + 1} y={mouthY - 3.5} width={mw * 2 - 2} height={3} rx={1.2} fill="#f3eee6" />
        </g>
      ) : a.expression === 'smile' ? (
        <path d={`M${mx - mw} ${mouthY - 1} Q${mx} ${mouthY + 5} ${mx + mw} ${mouthY - 1}`} fill="none" stroke="#7a3b32" strokeWidth={1.8} strokeLinecap="round" />
      ) : (
        <g>
          <path d={`M${mx - mw + 1.5} ${mouthY + 0.8} Q${mx} ${mouthY + 5} ${mx + mw - 1.5} ${mouthY + 0.8} Z`} fill={shade(skin, -38)} opacity={0.55} />
          <path d={`M${mx - mw} ${mouthY} Q${mx} ${mouthY + (focused ? 0.4 : 1.4)} ${mx + mw} ${mouthY}`} fill="none" stroke="#7a3b32" strokeWidth={1.7} strokeLinecap="round" />
        </g>
      )}
      {a.facialHair === 'mustache' && <path d={`M${mx - mw - 1} ${mouthY - 3} Q${mx} ${mouthY - 8} ${mx + mw + 1} ${mouthY - 3} Q${mx} ${mouthY - 4} ${mx - mw - 1} ${mouthY - 3} Z`} fill={hair} />}
      {a.facialHair === 'beard' && <path d={`M${mx - mw - 1} ${mouthY - 3} Q${mx} ${mouthY - 7} ${mx + mw + 1} ${mouthY - 3} Q${mx} ${mouthY - 4.5} ${mx - mw - 1} ${mouthY - 3} Z`} fill={hair} />}

      {/* front hair */}
      <g opacity={hp.opacity}>
        {hp.front.map((d, i) => (
          <path key={i} d={d} fill={`url(#${uid}-hair)`} />
        ))}
      </g>
      {a.hairStyle === 'waves' && (
        <g fill="none" stroke={darkHair} strokeWidth={1.2} opacity={0.6}>
          <path d={`M${cx - hw * 0.7} ${top + 6} q${hw * 0.35} -4 ${hw * 0.7} 0 t${hw * 0.7} 0`} />
          <path d={`M${cx - hw * 0.8} ${top + 12} q${hw * 0.4} -4 ${hw * 0.8} 0 t${hw * 0.8} 0`} />
        </g>
      )}
      {a.hairStyle === 'bald' && <ellipse cx={cx - hw * 0.25} cy={top + 10} rx={hw * 0.35} ry={5} fill="#fff" opacity={0.18} />}
    </g>
  );
}
