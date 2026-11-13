import type { Player, Position } from '@fd/shared';
import { PlayerAvatar } from '@fd/ui';
import type { ReactNode } from 'react';

export function PlayerRow({
  player,
  pos,
  rating,
  right,
  onClick,
  selected,
  dim,
}: {
  player: Player;
  pos?: Position | string;
  rating?: number;
  right?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  dim?: boolean;
}) {
  return (
    <div className={`prow ${onClick ? 'clickable' : ''} ${selected ? 'selected' : ''}`} onClick={onClick} style={{ opacity: dim ? 0.45 : 1 }}>
      <PlayerAvatar player={player} size={30} />
      <span className={`ovr rar-${player.rarity}`}>{rating ?? player.ovr}</span>
      <span className="pos">{pos ?? player.primaryPosition}</span>
      <span className="nm">{player.name}</span>
      {right}
    </div>
  );
}
