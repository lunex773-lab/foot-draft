import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** original card images of the player database (generic silhouette) */
export const ORIGINAL_CARDS = join(ROOT, 'data', 'player-db-v1', 'cards');
export const APPEARANCE_JSON = join(ROOT, 'data', 'player-db-v1', 'appearance.json');
/** card images served by the apps */
export const OUTPUT_CARDS = join(ROOT, 'assets', 'cards');
