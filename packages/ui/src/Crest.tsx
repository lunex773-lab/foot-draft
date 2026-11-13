import type { ClubInfo, CrestEmblem, LeagueInfo } from '@fd/shared';

/** Simple emblem glyphs drawn in a ±18 box centred at the origin (all original artwork). */
export const EMBLEM_PATHS: Record<CrestEmblem, string> = {
  mountain: 'M-18 12 L-6 -9 L0 1 L6 -7 L18 12 Z M-6 -9 L-2 -2 L-6 0 L-9 -4 Z',
  wolf: 'M-13 -15 L-6 -5 L6 -5 L13 -15 L15 1 L7 12 L0 18 L-7 12 L-15 1 Z',
  star: 'M0 -18 L5 -6 L18 -6 L8 3 L12 16 L0 8 L-12 16 L-8 3 L-18 -6 L-5 -6 Z',
  lion: 'M0 -17 L5 -11 L12 -13 L11 -5 L17 0 L11 5 L12 12 L5 10 L0 17 L-5 10 L-12 12 L-11 5 L-17 0 L-11 -5 L-12 -13 L-5 -11 Z',
  crown: 'M-16 11 L-17 -7 L-8 1 L0 -13 L8 1 L17 -7 L16 11 Z',
  moon: 'M5 -17 A17 17 0 1 0 5 17 A13 13 0 1 1 5 -17 Z',
  sun: 'M0 -9 A9 9 0 1 1 0 9 A9 9 0 1 1 0 -9 Z M-1.5 -18 L1.5 -18 L1 -12 L-1 -12 Z M-1.5 18 L1.5 18 L1 12 L-1 12 Z M-18 -1.5 L-18 1.5 L-12 1 L-12 -1 Z M18 -1.5 L18 1.5 L12 1 L12 -1 Z M-13 -11 L-11 -13 L-8 -9 L-9 -8 Z M13 11 L11 13 L8 9 L9 8 Z M11 -13 L13 -11 L9 -8 L8 -9 Z M-11 13 L-13 11 L-9 8 L-8 9 Z',
  eagle: 'M0 -7 L-18 -13 L-12 -1 L-17 2 L-8 6 L-4 17 L0 10 L4 17 L8 6 L17 2 L12 -1 L18 -13 Z',
  tower: 'M-8 17 L-8 -8 L-11 -8 L-11 -17 L-6 -17 L-6 -13 L-2 -13 L-2 -17 L2 -17 L2 -13 L6 -13 L6 -17 L11 -17 L11 -8 L8 -8 L8 17 Z',
  compass: 'M0 -18 L4 -4 L18 0 L4 4 L0 18 L-4 4 L-18 0 L-4 -4 Z',
  wave: 'M-18 3 Q-12 -9 -6 3 T6 3 T18 3 L18 14 L-18 14 Z',
  flame: 'M0 -18 C9 -8 13 1 9 10 C6 17 -6 17 -9 10 C-13 1 -4 -5 0 -18 Z',
  stag: 'M-4 -1 L4 -1 L3 15 L-3 15 Z M-3 -1 L-10 -10 L-14 -8 L-10 -14 L-15 -16 L-8 -15 L-4 -9 Z M3 -1 L10 -10 L14 -8 L10 -14 L15 -16 L8 -15 L4 -9 Z',
  anchor: 'M-2 -12 L2 -12 L2 10 C8 9 12 5 13 1 L10 1 L15 -5 L18 3 L15 1 C14 10 8 16 0 16 C-8 16 -14 10 -15 1 L-18 3 L-15 -5 L-10 1 L-13 1 C-12 5 -8 9 -2 10 Z M-4 -17 A4 4 0 1 1 4 -17 A4 4 0 1 1 -4 -17 Z',
  bolt: 'M5 -18 L-10 2 L-1 2 L-5 18 L10 -4 L1 -4 Z',
  tree: 'M0 -18 L12 -2 L6 -2 L14 9 L2 9 L2 17 L-2 17 L-2 9 L-14 9 L-6 -2 L-12 -2 Z',
  comet: 'M6 -8 A8 8 0 1 1 6 8 A8 8 0 1 1 6 -8 Z M-2 -4 L-18 -14 L-14 -4 L-18 4 L-2 4 Z',
  shield_cross: 'M-14 -16 L14 -16 L14 2 C14 10 7 15 0 18 C-7 15 -14 10 -14 2 Z',
  fox: 'M-15 -16 L-6 -6 L6 -6 L15 -16 L13 2 L4 10 L0 16 L-4 10 L-13 2 Z',
  key: 'M-6 -16 A8 8 0 1 1 -6 0 A8 8 0 1 1 -6 -16 Z M-3 -2 L3 -2 L3 18 L-3 18 Z M3 8 L9 8 L9 12 L3 12 Z M3 14 L8 14 L8 17 L3 17 Z',
};

const CREST_SHAPES = {
  shield: 'M-34 -40 L34 -40 L34 6 C34 26 18 38 0 46 C-18 38 -34 26 -34 6 Z',
  heater: 'M-36 -40 L36 -40 C36 10 22 32 0 46 C-22 32 -36 10 -36 -40 Z',
  round: 'M0 -42 A42 42 0 1 1 0 42 A42 42 0 1 1 0 -42 Z',
  diamond: 'M0 -46 L40 0 L0 46 L-40 0 Z',
  hex: 'M0 -44 L38 -22 L38 22 L0 44 L-38 22 L-38 -22 Z',
};

/** Club crest centred at the origin, roughly 84 x 92. */
export function ClubCrestGroup({ club, uid }: { club: ClubInfo; uid: string }) {
  const shape = CREST_SHAPES[club.crestShape];
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-crest`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={club.primary} />
          <stop offset="1" stopColor={club.secondary} stopOpacity={0.85} />
        </linearGradient>
      </defs>
      <path d={shape} fill={`url(#${uid}-crest)`} stroke={club.accent} strokeWidth={5} strokeLinejoin="round" />
      <path d={shape} fill="none" stroke={club.secondary} strokeWidth={1.6} transform="scale(0.84)" opacity={0.9} />
      <g transform="translate(0 -2) scale(1.35)">
        <path d={EMBLEM_PATHS[club.emblem]} fill={club.accent} stroke="#000" strokeOpacity={0.35} strokeWidth={0.8} fillRule="evenodd" />
        {club.emblem === 'shield_cross' && <path d="M-2 -13 L2 -13 L2 13 L-2 13 Z M-11 -4 L11 -4 L11 0 L-11 0 Z" fill={club.primary} />}
        {(club.emblem === 'wolf' || club.emblem === 'fox') && (
          <g fill={club.primary}>
            <circle cx={-5} cy={0} r={1.8} />
            <circle cx={5} cy={0} r={1.8} />
          </g>
        )}
        {club.emblem === 'lion' && <circle cx={0} cy={0} r={8} fill={club.primary} opacity={0.6} />}
        {club.emblem === 'compass' && <circle cx={0} cy={0} r={13} fill="none" stroke={club.accent} strokeWidth={1.5} />}
      </g>
    </g>
  );
}

const LEAGUE_EMBLEMS: Record<LeagueInfo['emblem'], string> = {
  north: 'M0 -11 L2.4 -2.4 L11 0 L2.4 2.4 L0 11 L-2.4 2.4 L-11 0 L-2.4 -2.4 Z',
  eclipse: 'M3 -10 A10 10 0 1 0 3 10 A7.5 7.5 0 1 1 3 -10 Z',
  orion: 'M-10 0 A10 10 0 1 1 10 0 A10 10 0 1 1 -10 0 Z M-6 0 A6 6 0 1 0 6 0 A6 6 0 1 0 -6 0 Z M-1 -13 L1 -13 L1 13 L-1 13 Z M-13 -1 L13 -1 L13 1 L-13 1 Z',
  empire: 'M-11 7 L-12 -6 L-5 0 L0 -10 L5 0 L12 -6 L11 7 Z',
  zenith: 'M0 -12 L2 -5 L8.5 -8.5 L5 -2 L12 0 L5 2 L8.5 8.5 L2 5 L0 12 L-2 5 L-8.5 8.5 L-5 2 L-12 0 L-5 -2 L-8.5 -8.5 L-2 -5 Z',
};

/** League badge centred at the origin, roughly 52 x 64 (spec: fictional leagues only). */
export function LeagueBadgeGroup({ league, stroke, fill, text }: { league: LeagueInfo; stroke: string; fill: string; text: string }) {
  const [first] = league.name.split(' ');
  return (
    <g>
      <path d="M-22 -28 L22 -28 L24 -24 L24 12 C24 22 12 28 0 32 C-12 28 -24 22 -24 12 L-24 -24 Z" fill={fill} stroke={stroke} strokeWidth={2} />
      <path d="M-18 -23 L18 -23 L19 -20 L19 10 C19 18 10 23 0 26 C-10 23 -19 18 -19 10 L-19 -20 Z" fill="none" stroke={stroke} strokeWidth={0.8} opacity={0.6} />
      <g transform="translate(0 -9)">
        <path d={LEAGUE_EMBLEMS[league.emblem]} fill={text} fillRule="evenodd" />
      </g>
      <text x={0} y={10} textAnchor="middle" fontSize={7.4} fontWeight={700} fill={text} fontFamily="'Oswald','Arial Narrow',sans-serif" letterSpacing={0.4}>
        {first.toUpperCase()}
      </text>
      <text x={0} y={18} textAnchor="middle" fontSize={5.6} fontWeight={600} fill={text} fontFamily="'Oswald','Arial Narrow',sans-serif" letterSpacing={0.6} opacity={0.85}>
        LEAGUE
      </text>
    </g>
  );
}

/** Standalone crest (for lists). */
export function ClubCrest({ club, size = 32, uid }: { club: ClubInfo; size?: number; uid: string }) {
  return (
    <svg width={size} height={size * 1.1} viewBox="-48 -50 96 104" aria-label={club.name} role="img">
      <ClubCrestGroup club={club} uid={uid} />
    </svg>
  );
}
