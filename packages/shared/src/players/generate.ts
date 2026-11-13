import { CATALOG_SEED, GAME_CONFIG } from '../config';
import { CLUBS, CLUB_BY_ID } from '../data/clubs';
import { NATIONS, NATION_BY_CODE } from '../data/nations';
import { POSITIONS, POSITION_GROUP, POSITION_WEIGHTS, relatedPositions } from '../data/positions';
import { RARITIES, RARITY_INFO } from '../data/rarities';
import { GK_TRAITS, OUTFIELD_TRAITS } from '../data/traits';
import { Rng, clamp } from '../rng';
import type {
  Appearance,
  AttributeKey,
  DisplayStats,
  FacialHair,
  HairStyle,
  InternalAttributes,
  Player,
  Position,
  Rarity,
  RoleId,
  TraitId,
} from '../types';
import { ARCHETYPES, POSITION_ARCHETYPES, TRAIT_REQUIREMENTS } from './archetypes';
import { ATTRIBUTE_KEYS, DISPLAY_FORMULA, DISPLAY_KEYS, computeDisplayStats, computeOvr, rawPositionRating } from './ratings';

/** Primary position distribution of the 240 card catalog. */
const POSITION_COUNTS: Record<Position, number> = {
  GK: 28,
  CB: 36,
  LB: 14,
  RB: 14,
  CDM: 18,
  CM: 26,
  CAM: 16,
  LM: 10,
  RM: 10,
  LW: 16,
  RW: 16,
  ST: 36,
};

const GK_KEYS: AttributeKey[] = ['gkReflexes', 'gkHandling', 'gkPositioning'];

/**
 * Showcase cards reproduced from the reference card design image.
 * Their displayed stats and OVR match the image exactly.
 */
interface ShowcaseSpec {
  firstName: string;
  lastName: string;
  rarity: Rarity;
  position: Position;
  secondary: Position[];
  ovr: number;
  stats: DisplayStats;
  nationality: string;
  clubId: string;
  role: RoleId;
  traits: TraitId[];
  appearance: Appearance;
  age: number;
  foot: 'L' | 'R';
  height: number;
}

export const SHOWCASE: ShowcaseSpec[] = [
  {
    firstName: 'Elias',
    lastName: 'Voss',
    rarity: 'common',
    position: 'CM',
    secondary: ['CDM'],
    ovr: 64,
    stats: { pac: 62, sho: 58, pas: 63, dri: 66, def: 61, phy: 66 },
    nationality: 'EST',
    clubId: 'frostvale',
    role: 'box_to_box',
    traits: ['engine', 'pressing_machine'],
    appearance: { skinTone: 0, hairStyle: 'side_part', hairColor: 1, facialHair: 'none', faceWidth: 0.45, jawWidth: 0.5, browWeight: 0.55, eyeColor: 2, noseSize: 0.45, mouthWidth: 0.45, expression: 'focused', headTurn: -0.35 },
    age: 23,
    foot: 'R',
    height: 181,
  },
  {
    firstName: 'Mateo',
    lastName: 'Silva',
    rarity: 'rare',
    position: 'RW',
    secondary: ['RM'],
    ovr: 74,
    stats: { pac: 82, sho: 71, pas: 68, dri: 78, def: 36, phy: 64 },
    nationality: 'FRA',
    clubId: 'lunaris',
    role: 'winger',
    traits: ['speedster', 'trickster'],
    appearance: { skinTone: 1, hairStyle: 'quiff', hairColor: 1, facialHair: 'none', faceWidth: 0.42, jawWidth: 0.45, browWeight: 0.6, eyeColor: 1, noseSize: 0.5, mouthWidth: 0.45, expression: 'focused', headTurn: 0.4 },
    age: 21,
    foot: 'L',
    height: 176,
  },
  {
    firstName: 'Adrian',
    lastName: 'Volkov',
    rarity: 'epic',
    position: 'ST',
    secondary: [],
    ovr: 84,
    stats: { pac: 88, sho: 85, pas: 71, dri: 83, def: 42, phy: 82 },
    nationality: 'GER',
    clubId: 'starhaven',
    role: 'complete_forward',
    traits: ['clutch', 'speedster'],
    appearance: { skinTone: 1, hairStyle: 'crop', hairColor: 0, facialHair: 'stubble', faceWidth: 0.5, jawWidth: 0.6, browWeight: 0.75, eyeColor: 1, noseSize: 0.5, mouthWidth: 0.55, expression: 'shout', headTurn: 0.15 },
    age: 26,
    foot: 'R',
    height: 185,
  },
  {
    firstName: 'Luca',
    lastName: 'Moretti',
    rarity: 'legendary',
    position: 'CM',
    secondary: ['CAM', 'CDM'],
    ovr: 92,
    stats: { pac: 86, sho: 88, pas: 94, dri: 93, def: 80, phy: 86 },
    nationality: 'ITA',
    clubId: 'imperial',
    role: 'deep_playmaker',
    traits: ['playmaker', 'leader'],
    appearance: { skinTone: 2, hairStyle: 'curly', hairColor: 2, facialHair: 'stubble', faceWidth: 0.5, jawWidth: 0.62, browWeight: 0.6, eyeColor: 1, noseSize: 0.55, mouthWidth: 0.5, expression: 'focused', headTurn: 0.3 },
    age: 29,
    foot: 'R',
    height: 183,
  },
  {
    firstName: 'Orion',
    lastName: 'Vale',
    rarity: 'icon',
    position: 'CAM',
    secondary: ['CM', 'ST'],
    ovr: 98,
    stats: { pac: 92, sho: 95, pas: 99, dri: 98, def: 70, phy: 88 },
    nationality: 'ENG',
    clubId: 'skyreach',
    role: 'advanced_playmaker',
    traits: ['playmaker', 'sniper'],
    appearance: { skinTone: 0, hairStyle: 'long', hairColor: 3, facialHair: 'none', faceWidth: 0.44, jawWidth: 0.45, browWeight: 0.45, eyeColor: 0, noseSize: 0.45, mouthWidth: 0.45, expression: 'neutral', headTurn: 0.5 },
    age: 31,
    foot: 'R',
    height: 182,
  },
];

function emptyAttributes(v = 50): InternalAttributes {
  const a = {} as InternalAttributes;
  for (const k of ATTRIBUTE_KEYS) a[k] = v;
  return a;
}

/**
 * Find internal attributes whose displayed stats and OVR match given targets.
 * Used for hand-authored cards (showcase cards from the design image).
 */
export function fitAttributes(target: DisplayStats, primary: Position, targetOvr: number, seed: string): InternalAttributes {
  const rng = new Rng(`fit:${seed}`);
  const attrs = emptyAttributes();
  for (const key of DISPLAY_KEYS) {
    for (const a of Object.keys(DISPLAY_FORMULA[key]) as AttributeKey[]) attrs[a] = target[key];
  }
  for (const g of GK_KEYS) attrs[g] = rng.int(8, 16);

  const sameStats = (s: DisplayStats) => DISPLAY_KEYS.every((k) => s[k] === target[k]);
  let dist = Math.abs(rawPositionRating(attrs, primary) - targetOvr);
  for (let iter = 0; iter < 50000 && Math.round(rawPositionRating(attrs, primary)) !== targetOvr; iter++) {
    const group = rng.pick(DISPLAY_KEYS);
    const keys = Object.keys(DISPLAY_FORMULA[group]) as AttributeKey[];
    const a = rng.pick(keys);
    const b = rng.pick(keys);
    const step = rng.int(1, 3) * (rng.chance(0.5) ? 1 : -1);
    const prevA = attrs[a];
    const prevB = attrs[b];
    attrs[a] = clamp(prevA + step, 1, 99);
    if (a !== b) {
      const wa = DISPLAY_FORMULA[group][a] ?? 0;
      const wb = DISPLAY_FORMULA[group][b] ?? 1;
      attrs[b] = clamp(Math.round(prevB - (step * wa) / wb), 1, 99);
    }
    const newDist = Math.abs(rawPositionRating(attrs, primary) - targetOvr);
    if (sameStats(computeDisplayStats(attrs)) && newDist < dist) {
      dist = newDist;
    } else {
      attrs[a] = prevA;
      attrs[b] = prevB;
    }
  }
  if (computeOvr(attrs, primary) !== targetOvr || !sameStats(computeDisplayStats(attrs))) {
    throw new Error(`fitAttributes: could not fit ${seed}`);
  }
  return attrs;
}

/** Largest-remainder allocation of positions to each rarity. */
function allocatePositions(
  rng: Rng,
  rarityCounts: Record<Rarity, number>,
  positionCounts: Record<Position, number>,
): Record<Rarity, Position[]> {
  const remaining: Record<Position, number> = { ...positionCounts };
  const out = {} as Record<Rarity, Position[]>;
  const order: Rarity[] = ['icon', 'legendary', 'epic', 'rare', 'common'];
  for (const r of order) {
    const n = rarityCounts[r];
    const total = POSITIONS.reduce((s, p) => s + remaining[p], 0);
    const quotas = POSITIONS.map((p) => (n * remaining[p]) / total);
    const alloc = quotas.map((q) => Math.floor(q));
    let left = n - alloc.reduce((s, v) => s + v, 0);
    const byFrac = POSITIONS.map((_, i) => i).sort((i, j) => quotas[j] - alloc[j] - (quotas[i] - alloc[i]) || rng.next() - 0.5);
    for (const i of byFrac) {
      if (left <= 0) break;
      if (alloc[i] < remaining[POSITIONS[i]]) {
        alloc[i]++;
        left--;
      }
    }
    out[r] = [];
    POSITIONS.forEach((p, i) => {
      remaining[p] -= alloc[i];
      for (let k = 0; k < alloc[i]; k++) out[r].push(p);
    });
    out[r] = rng.shuffle(out[r]);
  }
  return out;
}

function targetOvrFor(rng: Rng, rarity: Rarity): number {
  const { ovrMin, ovrMax } = RARITY_INFO[rarity];
  // slightly bottom-heavy distribution inside the band
  const u = (rng.next() + rng.next() + rng.next() * 0.6) / 2.6;
  return Math.round(ovrMin + u * (ovrMax - ovrMin));
}

function generateAttributes(rng: Rng, primary: Position, role: RoleId, target: number): InternalAttributes {
  const arch = ARCHETYPES[role];
  const attrs = emptyAttributes();
  const isGk = primary === 'GK';
  for (const k of ATTRIBUTE_KEYS) {
    const isGkAttr = GK_KEYS.includes(k);
    if (!isGk && isGkAttr) {
      attrs[k] = rng.int(6, 16);
      continue;
    }
    let base: number;
    if (arch.offsets[k] !== undefined) base = target + (arch.offsets[k] as number);
    else if (isGk) base = target - 42;
    else base = target - 12;
    attrs[k] = Math.round(clamp(base + rng.normal(0, 3.5), isGk && !isGkAttr ? 10 : 15, 99));
  }
  // calibrate so that OVR equals target (only attributes used at the primary position)
  const keys = Object.keys(POSITION_WEIGHTS[primary]) as AttributeKey[];
  for (let i = 0; i < 8; i++) {
    const diff = target - rawPositionRating(attrs, primary);
    if (Math.abs(diff) < 0.5) break;
    for (const k of keys) attrs[k] = Math.round(clamp(attrs[k] + diff, 12, 99));
  }
  for (let i = 0; i < 60 && computeOvr(attrs, primary) !== target; i++) {
    const k = rng.pick(keys);
    const d = Math.sign(target - rawPositionRating(attrs, primary));
    attrs[k] = clamp(attrs[k] + d, 12, 99);
  }
  return attrs;
}

function pickTraits(rng: Rng, role: RoleId, attrs: InternalAttributes, isGk: boolean): TraitId[] {
  const arch = ARCHETYPES[role];
  const pool = isGk ? GK_TRAITS : OUTFIELD_TRAITS;
  const candidates: TraitId[] = [];
  const weights: number[] = [];
  for (const t of pool) {
    const req = TRAIT_REQUIREMENTS[t];
    if (req && !Object.entries(req).every(([k, v]) => attrs[k as AttributeKey] >= (v as number))) continue;
    candidates.push(t);
    weights.push((arch.traits[t] ?? 0) + 0.25);
  }
  const chosen: TraitId[] = [];
  while (chosen.length < 2 && candidates.length > 0) {
    const i = rng.weightedIndex(weights);
    chosen.push(candidates[i]);
    candidates.splice(i, 1);
    weights.splice(i, 1);
  }
  const fallback = isGk ? GK_TRAITS : (['engine', 'leader', 'clutch'] as TraitId[]);
  for (const t of fallback) if (chosen.length < 2 && !chosen.includes(t)) chosen.push(t);
  return chosen;
}

function secondaryPositions(rng: Rng, primary: Position, attrs: InternalAttributes): Position[] {
  if (primary === 'GK') return [];
  const base = rawPositionRating(attrs, primary);
  const cands = relatedPositions(primary)
    .map((p) => ({ p, r: rawPositionRating(attrs, p) }))
    .filter((c) => c.r >= base - 5)
    .sort((a, b) => b.r - a.r);
  const out: Position[] = [];
  for (const c of cands) {
    if (out.length >= 2) break;
    if (rng.chance(0.65)) out.push(c.p);
  }
  return out;
}

const HAIR_STYLES: HairStyle[] = ['buzz', 'short', 'crop', 'side_part', 'quiff', 'curly', 'afro', 'waves', 'long', 'man_bun', 'bald', 'mohawk'];

function makeAppearance(rng: Rng, nationCode: string, age: number): Appearance {
  const nation = NATION_BY_CODE[nationCode];
  const skinTone = rng.weightedIndex(nation.skin);
  const hairColor = rng.weightedIndex(nation.hair);
  const textured = skinTone >= 4;
  const hairWeights = HAIR_STYLES.map((h) => {
    switch (h) {
      case 'afro':
        return textured ? 1.4 : 0.15;
      case 'waves':
        return textured ? 1.6 : 0.2;
      case 'buzz':
        return textured ? 1.8 : 1.0;
      case 'curly':
        return 1.0;
      case 'long':
        return 0.5;
      case 'man_bun':
        return 0.4;
      case 'bald':
        return age > 29 ? 0.5 : 0.15;
      case 'mohawk':
        return 0.25;
      default:
        return textured ? 0.5 : 1.4;
    }
  });
  const facial: FacialHair[] = ['none', 'stubble', 'beard', 'goatee', 'mustache'];
  return {
    skinTone,
    hairStyle: rng.weighted(HAIR_STYLES, hairWeights),
    hairColor,
    facialHair: rng.weighted(facial, [0.45, 0.3, age > 24 ? 0.14 : 0.04, 0.07, 0.04]),
    faceWidth: Math.round(rng.float(0.2, 0.8) * 100) / 100,
    jawWidth: Math.round(rng.float(0.2, 0.8) * 100) / 100,
    browWeight: Math.round(rng.float(0.25, 0.85) * 100) / 100,
    eyeColor: rng.weightedIndex([0.5, 0.25, 0.15, 0.1]),
    noseSize: Math.round(rng.float(0.25, 0.75) * 100) / 100,
    mouthWidth: Math.round(rng.float(0.3, 0.7) * 100) / 100,
    expression: rng.weighted(['neutral', 'focused', 'smile', 'shout'] as const, [0.45, 0.38, 0.12, 0.05]),
    headTurn: Math.round(rng.float(-0.6, 0.6) * 100) / 100,
  };
}

function heightFor(rng: Rng, pos: Position, attrs: InternalAttributes): number {
  const base = pos === 'GK' ? 189 : pos === 'CB' ? 186 : POSITION_GROUP[pos] === 'FW' ? 180 : 178;
  return Math.round(clamp(base + (attrs.jumping - 60) * 0.12 + (attrs.strength - 60) * 0.08 + rng.normal(0, 4), 165, 201));
}

function footFor(rng: Rng, pos: Position): 'L' | 'R' {
  const leftSide = pos === 'LB' || pos === 'LM' || pos === 'LW';
  const rightSide = pos === 'RW';
  return rng.chance(leftSide ? 0.62 : rightSide ? 0.38 : 0.2) ? 'L' : 'R';
}

/**
 * Generate the full card catalog deterministically.
 * The same seed always produces the same catalog.
 */
export function generateCatalog(seed: string = CATALOG_SEED, size: number = GAME_CONFIG.catalogSize): Player[] {
  if (size !== GAME_CONFIG.catalogSize) throw new Error('catalog size is fixed by rarity counts');
  const rng = new Rng(seed);
  const rarityCounts = {} as Record<Rarity, number>;
  for (const r of RARITIES) rarityCounts[r] = RARITY_INFO[r].catalogCount;

  // reserve showcase cards
  for (const s of SHOWCASE) rarityCounts[s.rarity]--;
  const positionCounts = { ...POSITION_COUNTS };
  for (const s of SHOWCASE) positionCounts[s.position]--;
  const positionsByRarity = allocatePositions(rng.fork('positions'), rarityCounts, positionCounts);

  // balanced clubs (12 per club minus showcase)
  const clubSlots: string[] = [];
  for (const c of CLUBS) {
    const reserved = SHOWCASE.filter((s) => s.clubId === c.id).length;
    for (let i = 0; i < size / CLUBS.length - reserved; i++) clubSlots.push(c.id);
  }
  const clubs = rng.fork('clubs').shuffle(clubSlots);

  const usedNames = new Set<string>(SHOWCASE.map((s) => `${s.firstName} ${s.lastName}`));
  const players: Player[] = [];
  let idx = 0;

  // showcase first (ids 0001..0005)
  for (const s of SHOWCASE) {
    const attributes = fitAttributes(s.stats, s.position, s.ovr, `${s.firstName}-${s.lastName}`);
    players.push({
      id: '',
      name: `${s.firstName} ${s.lastName}`,
      firstName: s.firstName,
      lastName: s.lastName,
      nationality: s.nationality,
      leagueId: CLUB_BY_ID[s.clubId].leagueId,
      clubId: s.clubId,
      rarity: s.rarity,
      primaryPosition: s.position,
      positions: [s.position, ...s.secondary],
      ovr: s.ovr,
      role: s.role,
      traits: s.traits,
      attributes,
      stats: computeDisplayStats(attributes),
      appearance: s.appearance,
      age: s.age,
      preferredFoot: s.foot,
      heightCm: s.height,
    });
  }

  const nationWeights = NATIONS.map((n) => n.weight);
  for (const rarity of ['icon', 'legendary', 'epic', 'rare', 'common'] as Rarity[]) {
    for (const primary of positionsByRarity[rarity]) {
      const prng = rng.fork(`player-${idx++}`);
      const target = targetOvrFor(prng, rarity);
      const role = prng.weighted(
        POSITION_ARCHETYPES[primary].map((a) => a[0]),
        POSITION_ARCHETYPES[primary].map((a) => a[1]),
      );
      const attributes = generateAttributes(prng, primary, role, target);
      const nation = NATIONS[prng.weightedIndex(nationWeights)];
      let first = '';
      let last = '';
      for (let tries = 0; tries < 50; tries++) {
        first = prng.pick(nation.firstNames);
        last = prng.pick(nation.lastNames);
        if (first !== last && !usedNames.has(`${first} ${last}`)) break;
      }
      usedNames.add(`${first} ${last}`);
      const clubId = clubs.pop() as string;
      const age = rarity === 'icon' ? prng.int(30, 37) : prng.int(18, 34);
      players.push({
        id: '',
        name: `${first} ${last}`,
        firstName: first,
        lastName: last,
        nationality: nation.code,
        leagueId: CLUB_BY_ID[clubId].leagueId,
        clubId,
        rarity,
        primaryPosition: primary,
        positions: [primary, ...secondaryPositions(prng, primary, attributes)],
        ovr: computeOvr(attributes, primary),
        role,
        traits: pickTraits(prng, role, attributes, primary === 'GK'),
        attributes,
        stats: computeDisplayStats(attributes),
        appearance: makeAppearance(prng, nation.code, age),
        age,
        preferredFoot: footFor(prng, primary),
        heightCm: heightFor(prng, primary, attributes),
      });
    }
  }
  players.forEach((p, i) => {
    p.id = `fd${String(i + 1).padStart(4, '0')}`;
  });
  return players;
}

let cachedCatalog: Player[] | null = null;

/** The default catalog (memoized). */
export function getCatalog(): Player[] {
  if (!cachedCatalog) cachedCatalog = generateCatalog();
  return cachedCatalog;
}
