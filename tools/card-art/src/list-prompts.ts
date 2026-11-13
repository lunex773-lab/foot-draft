/**
 * Prints the portrait prompt of every player that has no portrait yet.
 *   npx tsx tools/card-art/src/list-prompts.ts [limit]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCatalog } from '@fd/shared';
import type { Appearance } from './appearance';
import { APPEARANCE_JSON, ROOT } from './paths';
import { portraitPrompt } from './prompts';

const looks: Record<string, Appearance> = JSON.parse(readFileSync(APPEARANCE_JSON, 'utf8')).players;
const limit = Number(process.argv[2] ?? 1000);
const todo = getCatalog().filter((p) => !existsSync(join(ROOT, 'data', 'player-db-v1', 'portraits', `${p.id}.jpg`)));
console.log(`${todo.length} remaining`);
for (const p of todo.slice(0, limit)) console.log(`${p.id}\t${portraitPrompt(p, looks[p.id])}`);
