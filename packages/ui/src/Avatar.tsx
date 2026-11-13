import { CLUB_BY_ID, type Player } from '@fd/shared';
import { memo, useId } from 'react';
import { PortraitGroup } from './Portrait';
import { RARITY_THEMES } from './theme';

/** Round portrait for compact lists (draft board, pitch, match log). */
function PlayerAvatarInner({ player, size = 40, ring = true }: { player: Player; size?: number; ring?: boolean }) {
  const raw = useId();
  const uid = `a${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
  const th = RARITY_THEMES[player.rarity];
  return (
    <svg width={size} height={size} viewBox="40 34 120 120" role="img" aria-label={player.name} style={{ display: 'block', flex: 'none' }}>
      <defs>
        <clipPath id={`${uid}-clip`}>
          <circle cx={100} cy={94} r={58} />
        </clipPath>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={th.bg[0]} />
          <stop offset="1" stopColor={th.bg[2]} />
        </linearGradient>
      </defs>
      <circle cx={100} cy={94} r={58} fill={`url(#${uid}-bg)`} />
      <g clipPath={`url(#${uid}-clip)`}>
        <PortraitGroup appearance={player.appearance} club={CLUB_BY_ID[player.clubId]} uid={`${uid}-p`} />
      </g>
      {ring && <circle cx={100} cy={94} r={57} fill="none" stroke={th.frame[1]} strokeWidth={5} />}
    </svg>
  );
}

export const PlayerAvatar = memo(PlayerAvatarInner);
