import { RARITY_INFO, type Player } from '@fd/shared';
import { memo, type CSSProperties } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, RARITY_COLORS, cardImageUrl } from './cardAssets';

/**
 * Player card = the card image provided with the player database
 * (assets/cards/<id>.png), shown as-is.
 */
export interface PlayerCardProps {
  player: Player;
  width?: number | string;
  /** greyed out (e.g. already drafted) */
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** "eager" for above-the-fold cards */
  loading?: 'lazy' | 'eager';
}

function PlayerCardInner({ player, width = 240, disabled, selected, onClick, className, style, title, loading = 'lazy' }: PlayerCardProps) {
  return (
    <div
      className={className}
      onClick={onClick}
      title={title ?? `${player.name}（${RARITY_INFO[player.rarity].label} ${player.primaryPosition} ${player.ovr}）`}
      style={{
        width,
        display: 'inline-block',
        cursor: onClick ? 'pointer' : undefined,
        opacity: disabled ? 0.35 : 1,
        filter: disabled ? 'grayscale(0.85)' : undefined,
        transition: 'transform 120ms ease, filter 120ms ease, box-shadow 120ms ease',
        transform: selected ? 'translateY(-4px)' : undefined,
        borderRadius: 10,
        boxShadow: selected ? `0 0 0 3px ${RARITY_COLORS[player.rarity]}, 0 8px 24px rgba(0,0,0,0.5)` : undefined,
        ...style,
      }}
    >
      <img
        src={cardImageUrl(player)}
        alt={`${player.name} ${player.primaryPosition} ${player.ovr}`}
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        loading={loading}
        decoding="async"
        draggable={false}
        style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 10, userSelect: 'none' }}
      />
    </div>
  );
}

export const PlayerCard = memo(PlayerCardInner);
