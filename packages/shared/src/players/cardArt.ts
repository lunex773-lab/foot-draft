import portraits from '../../../../data/player-db-v1/portraits.json';

/**
 * What the served card image (assets/cards/<id>.png) shows:
 * - 'photo'       : AI-generated photorealistic portrait filling the card (tools/card-art/photo_cards.py)
 * - 'illustrated' : illustrated player painted into the original card's silhouette (npm run cards:render)
 * A player has a photo card once its portrait is listed in data/player-db-v1/portraits.json.
 */
export type CardArt = 'photo' | 'illustrated';

export const PHOTO_CARD_IDS: ReadonlySet<string> = new Set(Object.keys(portraits.players));

export function cardArtOf(playerId: string): CardArt {
  return PHOTO_CARD_IDS.has(playerId) ? 'photo' : 'illustrated';
}
