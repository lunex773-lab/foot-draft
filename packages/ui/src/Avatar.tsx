import type { Player } from '@fd/shared';
import { memo } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, RARITY_COLORS, cardImageUrl } from './cardAssets';

/** portrait area of the provided card images (512 x 680) */
const CROP = { x: 166, y: 152, size: 180 };

/** Round crop of the card image's portrait area, for compact lists and the pitch. */
function PlayerAvatarInner({ player, size = 40, ring = true }: { player: Player; size?: number; ring?: boolean }) {
  const k = size / CROP.size;
  return (
    <span
      role="img"
      aria-label={player.name}
      style={{
        display: 'block',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundImage: `url(${cardImageUrl(player)})`,
        backgroundSize: `${CARD_WIDTH * k}px ${CARD_HEIGHT * k}px`,
        backgroundPosition: `${-CROP.x * k}px ${-CROP.y * k}px`,
        boxShadow: ring ? `0 0 0 2px ${RARITY_COLORS[player.rarity]}` : undefined,
        backgroundColor: '#111',
      }}
    />
  );
}

export const PlayerAvatar = memo(PlayerAvatarInner);
