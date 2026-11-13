/**
 * Creates / completes data/player-db-v1/appearance.json (one illustrated
 * look per player). Existing entries are kept, so manual edits survive.
 *
 *   npm run cards:appearance
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getCatalog } from '@fd/shared';
import { faceSignature, generateAppearances, type Appearance } from './appearance';
import { APPEARANCE_JSON } from './paths';

const catalog = getCatalog();
const existing: Record<string, Appearance> = existsSync(APPEARANCE_JSON) ? JSON.parse(readFileSync(APPEARANCE_JSON, 'utf8')).players : {};
const result = generateAppearances(catalog, existing);
const sorted = Object.fromEntries(Object.keys(result).sort().map((k) => [k, result[k]]));
writeFileSync(APPEARANCE_JSON, JSON.stringify({ schema_version: '1.0', description: 'Illustrated look of each player card (generated, editable)', players: sorted }, null, 1) + '\n');
const sigs = new Set(Object.values(result).map(faceSignature));
console.log(`appearance for ${Object.keys(result).length} players, ${sigs.size} distinct faces -> ${APPEARANCE_JSON}`);
