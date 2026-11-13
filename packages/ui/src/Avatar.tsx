import { cardArtOf, type CardArt, type Player } from '@fd/shared';
import { memo } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, RARITY_COLORS, cardImageUrl } from './cardAssets';

/** head area of the card images (512 x 680), by the kind of card (tools/card-art) */
const CROPS: Record<CardArt, { x: number; y: number; size: number }> = {
  photo: { x: 131, y: 70, size: 250 },
  illustrated: { x: 176, y: 146, size: 160 },
};

/** Round crop of the player's head on the card image, for compact lists and the pitch. */
function PlayerAvatarInner({ player, size = 40, ring = true }: { player: Player; size?: number; ring?: boolean }) {
  const crop = CROPS[cardArtOf(player.id)];
  const k = size / crop.size;
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
        backgroundPosition: `${-crop.x * k}px ${-crop.y * k}px`,
        boxShadow: ring ? `0 0 0 2px ${RARITY_COLORS[player.rarity]}` : undefined,
        backgroundColor: '#111',
      }}
    />
  );
}

export const PlayerAvatar = memo(PlayerAvatarInner);
