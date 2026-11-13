import {
  CLUB_BY_ID,
  DISPLAY_KEYS,
  DISPLAY_LABELS,
  LEAGUE_BY_ID,
  RARITY_INFO,
  ROLES,
  Rng,
  TRAITS,
  type Player,
  type Rarity,
} from '@fd/shared';
import { memo, useId, type CSSProperties } from 'react';
import { ClubCrestGroup, LeagueBadgeGroup } from './Crest';
import { FlagGroup } from './Flag';
import { Glyph, ROLE_GLYPH, TRAIT_GLYPH } from './glyphs';
import { PortraitGroup } from './Portrait';
import { RARITY_THEMES } from './theme';

/**
 * Player card reproducing the reference card design:
 * shield-shaped frame, rarity colours, OVR + position top-left, three
 * diamond badges (role + 2 traits) on the left, name, six stats, and
 * flag / league / club badges at the bottom.
 *
 * The SVG is 300 x 470 (card) and scales to any width.
 */
export interface PlayerCardProps {
  player: Player;
  width?: number | string;
  /** show the rarity label pill under the card */
  showLabel?: boolean;
  /** greyed out (e.g. already drafted) */
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const VB_W = 300;
const VB_H = 470;
const FONT = "'Oswald','Bebas Neue','Arial Narrow','Helvetica Neue',sans-serif";

/** top edge decoration differs per rarity (as in the image) */
function topEdge(r: Rarity): string {
  switch (r) {
    case 'common':
      return 'L40 34 C70 30 96 30 118 26 C128 24 138 14 150 14 C162 14 172 24 182 26 C204 30 230 30 260 34';
    case 'rare':
    case 'epic':
      return 'L36 32 L72 30 L96 22 L118 26 L134 14 L150 22 L166 14 L182 26 L204 22 L228 30 L264 32';
    case 'legendary':
      return 'L34 30 L70 28 L92 16 L112 24 L130 8 L150 18 L170 8 L188 24 L208 16 L230 28 L266 30';
    case 'icon':
      return 'L30 28 L64 26 L84 12 L104 22 L122 4 L138 16 L150 -4 L162 16 L178 4 L196 22 L216 12 L236 26 L270 28';
  }
}

function shieldPath(r: Rarity): string {
  return [
    'M16 44',
    topEdge(r),
    'L284 44',
    'L290 56 L284 68',
    'L284 352',
    'C284 372 276 384 262 394',
    'L150 466',
    'L38 394',
    'C24 384 16 372 16 352',
    'L16 68 L10 56 Z',
  ].join(' ');
}

function shards(seed: string, colors: string[]) {
  const rng = new Rng(`shards:${seed}`);
  const out: { points: string; color: string; opacity: number }[] = [];
  for (let i = 0; i < 26; i++) {
    const cx = rng.float(10, 290);
    const cy = rng.float(10, 330);
    const size = rng.float(30, 110);
    const ang = rng.float(0, Math.PI * 2);
    const pts: string[] = [];
    const n = rng.int(3, 4);
    for (let k = 0; k < n; k++) {
      const a = ang + (k / n) * Math.PI * 2 + rng.float(-0.5, 0.5);
      const d = size * rng.float(0.3, 0.7);
      pts.push(`${(cx + Math.cos(a) * d).toFixed(1)},${(cy + Math.sin(a) * d).toFixed(1)}`);
    }
    out.push({ points: pts.join(' '), color: rng.pick(colors), opacity: rng.float(0.25, 1) });
  }
  return out;
}

function Badge({ glyph, fill, stroke, y, title }: { glyph: string; fill: string; stroke: string; y: number; title: string }) {
  return (
    <g transform={`translate(34 ${y})`}>
      <title>{title}</title>
      <path d="M0 -17 L15 0 L0 17 L-15 0 Z" fill={fill} stroke={stroke} strokeWidth={1.8} />
      <path d="M0 -13 L11 0 L0 13 L-11 0 Z" fill="none" stroke={stroke} strokeWidth={0.6} opacity={0.6} />
      <g transform="scale(0.72)">
        <Glyph name={glyph} color={stroke} />
      </g>
    </g>
  );
}

function PlayerCardInner({ player, width = 240, showLabel = false, disabled, selected, onClick, className, style, title }: PlayerCardProps) {
  const rawId = useId();
  const uid = `c${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const th = RARITY_THEMES[player.rarity];
  const club = CLUB_BY_ID[player.clubId];
  const league = LEAGUE_BY_ID[player.leagueId];
  const shield = shieldPath(player.rarity);
  const shardList = shards(player.id, th.shards);
  const nameSize = player.name.length > 18 ? 22 : player.name.length > 14 ? 26 : 30;
  const isIcon = player.rarity === 'icon';
  const isLegend = player.rarity === 'legendary';

  return (
    <div
      className={className}
      onClick={onClick}
      title={title ?? `${player.name} (${RARITY_INFO[player.rarity].label} ${player.primaryPosition} ${player.ovr})`}
      style={{
        width,
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: onClick ? 'pointer' : undefined,
        opacity: disabled ? 0.35 : 1,
        filter: disabled ? 'grayscale(0.8)' : undefined,
        transition: 'transform 120ms ease, filter 120ms ease',
        transform: selected ? 'translateY(-4px)' : undefined,
        ...style,
      }}
    >
      <svg viewBox={`0 -30 ${VB_W} ${VB_H + 30}`} width="100%" role="img" aria-label={`${player.name} ${player.primaryPosition} ${player.ovr}`} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor={th.bg[0]} />
            <stop offset="0.55" stopColor={th.bg[1]} />
            <stop offset="1" stopColor={th.bg[2]} />
          </linearGradient>
          <linearGradient id={`${uid}-frame`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={th.frame[0]} />
            <stop offset="0.35" stopColor={th.frame[1]} />
            <stop offset="0.6" stopColor={th.frame[2]} />
            <stop offset="1" stopColor={th.frame[3]} />
          </linearGradient>
          <radialGradient id={`${uid}-glow`} cx="0.6" cy="0.32" r="0.45">
            <stop offset="0" stopColor={th.glow} stopOpacity={isIcon ? 0.9 : 0.55} />
            <stop offset="1" stopColor={th.glow} stopOpacity={0} />
          </radialGradient>
          <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.72" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id={`${uid}-pmask`} maskUnits="userSpaceOnUse" x="0" y="0" width="300" height="330">
            <rect x="0" y="0" width="300" height="330" fill={`url(#${uid}-fade)`} />
          </mask>
          <linearGradient id={`${uid}-bottom`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={th.bg[2]} stopOpacity={0} />
            <stop offset="0.45" stopColor={th.bg[2]} stopOpacity={isIcon ? 0.35 : 0.82} />
            <stop offset="1" stopColor={th.bg[2]} stopOpacity={isIcon ? 0.55 : 0.95} />
          </linearGradient>
          <clipPath id={`${uid}-inner`}>
            <path d={shield} transform="translate(150 235) scale(0.955) translate(-150 -235)" />
          </clipPath>
          <filter id={`${uid}-ptone`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values={String(th.portraitSaturation)} />
          </filter>
          {isIcon && (
            <linearGradient id={`${uid}-holo`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffe9f6" stopOpacity={0.5} />
              <stop offset="0.3" stopColor="#d6fbff" stopOpacity={0.15} />
              <stop offset="0.55" stopColor="#fff6c9" stopOpacity={0.45} />
              <stop offset="0.8" stopColor="#d9d2ff" stopOpacity={0.2} />
              <stop offset="1" stopColor="#c8fff1" stopOpacity={0.45} />
            </linearGradient>
          )}
          <filter id={`${uid}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000" floodOpacity={isIcon ? 0.25 : 0.6} />
          </filter>
        </defs>

        {/* selection / legendary glow */}
        {(selected || isLegend || isIcon) && <path d={shield} fill="none" stroke={selected ? '#ffffff' : th.glow} strokeWidth={selected ? 8 : 5} opacity={selected ? 0.9 : 0.35} style={{ filter: 'blur(4px)' }} />}

        {/* frame */}
        <path d={shield} fill={`url(#${uid}-frame)`} />

        {/* inner area */}
        <g clipPath={`url(#${uid}-inner)`}>
          <rect x={0} y={-10} width={VB_W} height={VB_H + 10} fill={`url(#${uid}-bg)`} />
          {shardList.map((sh, i) => (
            <polygon key={i} points={sh.points} fill={sh.color} opacity={sh.opacity * th.shardOpacity} stroke={th.shards[2] ?? '#fff'} strokeOpacity={0.18} strokeWidth={0.8} />
          ))}
          <rect x={0} y={0} width={VB_W} height={340} fill={`url(#${uid}-glow)`} />
          {isIcon && <rect x={0} y={-10} width={VB_W} height={VB_H + 10} fill={`url(#${uid}-holo)`} />}

          {/* portrait */}
          <g mask={`url(#${uid}-pmask)`}>
            <g transform="translate(26 22) scale(1.42)" filter={`url(#${uid}-ptone)`}>
              <PortraitGroup appearance={player.appearance} club={club} uid={`${uid}-p`} />
              {th.portraitTint && <rect x={0} y={0} width={200} height={230} fill={th.portraitTint} opacity={th.portraitTintOpacity} style={{ mixBlendMode: 'soft-light' }} />}
            </g>
          </g>

          {/* darken lower half for legibility */}
          <rect x={0} y={250} width={VB_W} height={230} fill={`url(#${uid}-bottom)`} />
        </g>

        {/* inner frame line */}
        <path d={shield} transform="translate(150 235) scale(0.955) translate(-150 -235)" fill="none" stroke={th.frameInner} strokeWidth={1.4} opacity={0.9} />
        <path d={shield} transform="translate(150 235) scale(0.925) translate(-150 -235)" fill="none" stroke={th.frameInner} strokeWidth={0.6} opacity={0.45} />

        {/* icon crown */}
        {isIcon && (
          <g transform="translate(150 -2)">
            <path d="M-34 10 L-40 -14 L-20 -2 L-10 -26 L0 -8 L10 -26 L20 -2 L40 -14 L34 10 Z" fill={`url(#${uid}-frame)`} stroke="#7a5a14" strokeWidth={1.2} />
            <circle cx={0} cy={0} r={5} fill="#d6324a" stroke="#fff3c4" strokeWidth={1.4} />
            <circle cx={-22} cy={2} r={2.4} fill="#7fe0f0" />
            <circle cx={22} cy={2} r={2.4} fill="#7fe0f0" />
          </g>
        )}

        {/* OVR + position */}
        <g filter={`url(#${uid}-shadow)`} fontFamily={FONT}>
          <text x={36} y={102} fontSize={58} fontWeight={700} fill={th.text} letterSpacing={-1}>
            {player.ovr}
          </text>
          <text x={38} y={132} fontSize={26} fontWeight={600} fill={th.text} letterSpacing={0.5}>
            {player.primaryPosition}
          </text>
        </g>

        {/* badges: role + 2 traits */}
        <Badge glyph={ROLE_GLYPH[player.role]} fill={th.badgeFill} stroke={th.badgeStroke} y={196} title={`${ROLES[player.role].nameJa}（プレースタイル）`} />
        {player.traits.slice(0, 2).map((t, i) => (
          <Badge key={t} glyph={TRAIT_GLYPH[t]} fill={th.badgeFill} stroke={th.badgeStroke} y={236 + i * 40} title={`${TRAITS[t].nameJa}: ${TRAITS[t].effectJa}`} />
        ))}

        {/* name */}
        <text x={150} y={330} textAnchor="middle" fontFamily={FONT} fontSize={nameSize} fontWeight={600} fill={th.text} filter={`url(#${uid}-shadow)`} letterSpacing={0.3}>
          {player.name}
        </text>

        {/* stats */}
        <g fontFamily={FONT} textAnchor="middle" filter={`url(#${uid}-shadow)`}>
          {DISPLAY_KEYS.map((k, i) => {
            const x = 52 + i * 39.2;
            return (
              <g key={k}>
                <text x={x} y={358} fontSize={14} fontWeight={500} fill={th.subText} letterSpacing={0.4}>
                  {DISPLAY_LABELS[k]}
                </text>
                <text x={x} y={384} fontSize={24} fontWeight={600} fill={th.text}>
                  {player.stats[k]}
                </text>
              </g>
            );
          })}
        </g>

        {/* flag / league / club */}
        <g transform="translate(70 402)">
          <FlagGroup code={player.nationality} stroke={th.frameInner} />
        </g>
        <g transform="translate(150 412) scale(0.82)">
          <LeagueBadgeGroup league={league} stroke={th.badgeStroke} fill={isIcon ? '#fffaf0' : th.badgeFill} text={isIcon ? th.text : th.subText} />
        </g>
        <g transform="translate(222 412) scale(0.36)">
          <ClubCrestGroup club={club} uid={`${uid}-club`} />
        </g>
      </svg>
      {showLabel && <RarityLabel rarity={player.rarity} />}
    </div>
  );
}

export const PlayerCard = memo(PlayerCardInner);

/** Rarity label pill shown under the cards in the reference image. */
export function RarityLabel({ rarity, width = '78%' }: { rarity: Rarity; width?: number | string }) {
  const th = RARITY_THEMES[rarity];
  return (
    <div
      style={{
        marginTop: 10,
        width,
        textAlign: 'center',
        padding: '5px 0',
        background: th.labelBg,
        color: th.labelText,
        border: `1.5px solid ${th.labelBorder}`,
        clipPath: 'polygon(6% 0, 94% 0, 100% 50%, 94% 100%, 6% 100%, 0 50%)',
        fontFamily: FONT,
        fontWeight: 700,
        letterSpacing: '0.12em',
        fontSize: 13,
      }}
    >
      {RARITY_INFO[rarity].label}
    </div>
  );
}
