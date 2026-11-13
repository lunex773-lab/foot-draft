import type { Player, Rarity } from '@fd/shared';

/**
 * Card images come from the player database (assets/cards/*.png, 512 x 680).
 * Apps serve them as static files; the base URL can point to a CDN / R2
 * bucket in production (VITE_CARD_BASE_URL).
 */
let base = '/';

export function setCardAssetBase(url: string | undefined | null) {
  if (url) base = url.endsWith('/') ? url : `${url}/`;
}

export function cardImageUrl(player: Pick<Player, 'cardAsset'>): string {
  return `${base}${player.cardAsset}`;
}

export function cardTemplateUrl(rarity: Rarity): string {
  return `${base}card_templates/${rarity}_template.png`;
}

/** Frame colours matching the card templates (used for rings and labels). */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#c3c7cf',
  rare: '#5b8cff',
  epic: '#a46bff',
  legendary: '#f5c542',
  icon: '#fbe7b5',
};

export const CARD_WIDTH = 512;
export const CARD_HEIGHT = 680;
