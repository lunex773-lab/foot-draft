/**
 * Writes the numbers the card images print (OVR and the six stats of the
 * game catalog, i.e. after the card balance of decisions 118-122) for
 * photo_cards.py:
 *
 *   npm run values -w @fd/card-art      # -> tools/card-art/.card-values.json
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCatalog } from '@fd/shared';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '.card-values.json');
const values = Object.fromEntries(
  getCatalog().map((p) => [p.id, { overall: p.ovr, display_stats: { PAC: p.stats.pac, SHO: p.stats.sho, PAS: p.stats.pas, DRI: p.stats.dri, DEF: p.stats.def, PHY: p.stats.phy } }]),
);
writeFileSync(out, `${JSON.stringify(values)}\n`);
console.log(`wrote ${out} (${Object.keys(values).length} cards)`);
