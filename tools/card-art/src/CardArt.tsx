import type { Player, Rarity } from '@fd/shared';
import type { Appearance } from './appearance';
import { ClubCrestGroup } from './Crest';
import { Head, shade } from './Head';
import { KITS, type Kit } from './kits';
import { SKIN_SHADOWS, SKIN_TONES } from './palette';

/**
 * Composes one card: the original card image from the player database with
 * an illustrated player painted over the generic silhouette. The frame, OVR,
 * position, ring, name, stats and rarity label of the original are kept.
 *
 * Silhouette geometry of the provided 512 x 680 cards (identical on all cards):
 * head ring centre (256, 241), inner radius ~72; body from y=295 to y=489;
 * the name text starts at y=489.
 */
export const CARD_W = 512;
export const CARD_H = 680;
const RING = { cx: 256, cy: 241, r: 72.5 };
const NAME_TOP = 488;
const HEAD = { scale: 1.58, tx: 256 - 100 * 1.58, ty: 228 - 90 * 1.58 };
const JERSEY = 'M100 492 L126 333 C150 311 180 297 205 291 L307 291 C332 297 362 311 386 333 L412 492 Z';
const NAVY = '#101822';

/** ring / background tones sampled from the card templates */
const RARITY_TONE: Record<Rarity, { ring: string; bg: string }> = {
  common: { ring: '#aaaeb6', bg: '#3a3d44' },
  rare: { ring: '#4086df', bg: '#112e5d' },
  epic: { ring: '#a65ddf', bg: '#3b185d' },
  legendary: { ring: '#deb144', bg: '#3e2e11' },
  icon: { ring: '#ded19e', bg: '#384445' },
};

function Pattern({ kit, uid }: { kit: Kit; uid: string }) {
  const c = kit.secondary;
  const clip = `url(#${uid}-jersey)`;
  switch (kit.pattern) {
    case 'stripes':
      return (
        <g clipPath={clip} opacity={0.92}>
          {Array.from({ length: 7 }, (_, i) => (
            <rect key={i} x={113 + i * 48} y={280} width={24} height={220} fill={c} />
          ))}
        </g>
      );
    case 'pinstripe':
      return (
        <g clipPath={clip} opacity={0.8}>
          {Array.from({ length: 18 }, (_, i) => (
            <rect key={i} x={104 + i * 18} y={280} width={3} height={220} fill={c} />
          ))}
        </g>
      );
    case 'hoops':
      return (
        <g clipPath={clip} opacity={0.92}>
          {Array.from({ length: 5 }, (_, i) => (
            <rect key={i} x={90} y={318 + i * 40} width={340} height={20} fill={c} />
          ))}
        </g>
      );
    case 'sash':
      return (
        <g clipPath={clip} opacity={0.94}>
          <polygon points="150,290 205,290 400,500 345,500" fill={c} />
        </g>
      );
    case 'halves':
      return (
        <g clipPath={clip} opacity={0.94}>
          <rect x={256} y={280} width={170} height={220} fill={c} />
        </g>
      );
    case 'chevron':
      return (
        <g clipPath={clip} opacity={0.94}>
          <polygon points="90,345 256,410 422,345 422,372 256,437 90,372" fill={c} />
        </g>
      );
    default:
      return (
        <g clipPath={clip} opacity={0.55}>
          <path d="M126 333 C150 311 180 297 205 291 L214 300 C180 310 150 330 136 350 Z" fill={c} />
          <path d="M386 333 C362 311 332 297 307 291 L298 300 C332 310 362 330 376 350 Z" fill={c} />
        </g>
      );
  }
}

export function CardArt({ player, appearance, cardDataUrl }: { player: Player; appearance: Appearance; cardDataUrl: string }) {
  const uid = `c${player.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  const kit = KITS[player.clubId];
  if (!kit) throw new Error(`no kit for club ${player.clubId}`);
  const tone = RARITY_TONE[player.rarity];
  const skin = SKIN_TONES[appearance.skinTone];
  const skinShadow = SKIN_SHADOWS[appearance.skinTone];
  const t = Math.max(-1, Math.min(1, appearance.headTurn));
  // head centre in card coordinates (follows the head turn a little)
  const hx = HEAD.tx + (100 + t * 3) * HEAD.scale;
  const vx = (hx + 256) / 2;
  const neckTop = 258;
  const vNeck = kit.collar === 'v';
  const neckBottom = vNeck ? 324 : 304;
  const collar = vNeck ? `M${hx - 27} 290 L${vx} ${neckBottom + 2} L${hx + 27} 290` : `M${hx - 31} 290 Q${hx} ${neckBottom + 6} ${hx + 31} 290`;
  const neck = vNeck
    ? `M${hx - 23} ${neckTop} L${hx + 23} ${neckTop} L${hx + 27} 291 L${vx} ${neckBottom} L${hx - 27} 291 Z`
    : `M${hx - 23} ${neckTop} L${hx + 23} ${neckTop} L${hx + 28} 291 Q${hx} ${neckBottom} ${hx - 28} 291 Z`;

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={CARD_W} height={CARD_H} viewBox={`0 0 ${CARD_W} ${CARD_H}`}>
      <defs>
        <clipPath id={`${uid}-jersey`}>
          <path d={JERSEY} />
        </clipPath>
        <clipPath id={`${uid}-below`}>
          <rect x={0} y={NAME_TOP} width={CARD_W} height={CARD_H - NAME_TOP} />
        </clipPath>
        <radialGradient id={`${uid}-disc`} cx="0.5" cy="0.42" r="0.62">
          <stop offset="0" stopColor={shade(tone.bg, 70)} />
          <stop offset="0.55" stopColor={shade(tone.bg, 28)} />
          <stop offset="1" stopColor={shade(tone.bg, -12)} />
        </radialGradient>
        <linearGradient id={`${uid}-kitshade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="0.32" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="0.68" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.62" stopColor={NAVY} stopOpacity="0" />
          <stop offset="1" stopColor={NAVY} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${uid}-neck`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(skinShadow, -30)} />
          <stop offset="0.6" stopColor={skinShadow} />
          <stop offset="1" stopColor={skin} />
        </linearGradient>
        <radialGradient id={`${uid}-rim`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.8" stopColor={tone.ring} stopOpacity="0" />
          <stop offset="1" stopColor={tone.ring} stopOpacity="0.35" />
        </radialGradient>
      </defs>

      {/* original card from the player database */}
      <image href={cardDataUrl} x={0} y={0} width={CARD_W} height={CARD_H} />

      {/* portrait backdrop inside the original head ring */}
      <circle cx={RING.cx} cy={RING.cy} r={RING.r} fill={`url(#${uid}-disc)`} />
      <circle cx={RING.cx} cy={RING.cy} r={RING.r} fill={`url(#${uid}-rim)`} />

      {/* hair behind the shoulders */}
      <g transform={`translate(${HEAD.tx} ${HEAD.ty}) scale(${HEAD.scale})`}>
        <Head appearance={appearance} uid={`${uid}-hb`} part="back" />
      </g>

      {/* kit (covers the silhouette body) */}
      <path d={JERSEY} fill={kit.primary} />
      <Pattern kit={kit} uid={uid} />
      <path d={JERSEY} fill={`url(#${uid}-kitshade)`} />
      <path d="M150 318 C170 340 178 380 178 492" fill="none" stroke="#000" strokeOpacity={0.2} strokeWidth={2} />
      <path d="M362 318 C342 340 334 380 334 492" fill="none" stroke="#000" strokeOpacity={0.2} strokeWidth={2} />
      <g transform="translate(304 372) scale(0.42)">
        <ClubCrestGroup club={kit} uid={`${uid}-crest`} />
      </g>
      <path d={JERSEY} fill={`url(#${uid}-fade)`} />

      {/* neck + collar */}
      <path d={neck} fill={`url(#${uid}-neck)`} />
      <path d={collar} fill="none" stroke={kit.accent} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />

      {/* head */}
      <g transform={`translate(${HEAD.tx} ${HEAD.ty}) scale(${HEAD.scale})`}>
        <Head appearance={appearance} uid={`${uid}-hf`} part="front" />
      </g>

      {/* restore the original name / stats / rarity label */}
      <image href={cardDataUrl} x={0} y={0} width={CARD_W} height={CARD_H} clipPath={`url(#${uid}-below)`} />
    </svg>
  );
}
