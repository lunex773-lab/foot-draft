import { Rng, type Player } from '@fd/shared';

/**
 * Look of the illustrated player painted on each card. Generated
 * deterministically from the player id and nationality, then stored in
 * data/player-db-v1/appearance.json so individual players can be adjusted.
 */
export type HairStyle = 'buzz' | 'short' | 'crop' | 'side_part' | 'quiff' | 'curly' | 'afro' | 'waves' | 'long' | 'man_bun' | 'bald' | 'mohawk';
export type FacialHair = 'none' | 'stubble' | 'beard' | 'goatee' | 'mustache';

export interface Appearance {
  skinTone: number; // 0..5
  hairStyle: HairStyle;
  hairColor: number; // 0..5 (black, dark brown, brown, light brown, blond, red)
  facialHair: FacialHair;
  faceWidth: number;
  jawWidth: number;
  browWeight: number;
  eyeColor: number; // 0..3
  noseSize: number;
  mouthWidth: number;
  expression: 'neutral' | 'focused' | 'smile' | 'shout';
  headTurn: number; // -1..1
}

type Dist6 = [number, number, number, number, number, number];
interface NationLook {
  skin: Dist6;
  hair: Dist6;
  lightEyes: number;
}

const EU_HAIR: Dist6 = [0.18, 0.34, 0.24, 0.12, 0.09, 0.03];
const NORDIC_HAIR: Dist6 = [0.05, 0.18, 0.24, 0.23, 0.26, 0.04];
const DARK_HAIR: Dist6 = [0.7, 0.26, 0.04, 0, 0, 0];
const LATIN_HAIR: Dist6 = [0.4, 0.38, 0.16, 0.04, 0.02, 0];

/** rough, diverse distributions per nationality of the player database */
const LOOKS: Record<string, NationLook> = {
  ARG: { skin: [0.26, 0.36, 0.26, 0.09, 0.03, 0], hair: LATIN_HAIR, lightEyes: 0.15 },
  BRA: { skin: [0.12, 0.18, 0.2, 0.2, 0.17, 0.13], hair: DARK_HAIR, lightEyes: 0.08 },
  CRO: { skin: [0.4, 0.34, 0.16, 0.06, 0.03, 0.01], hair: [0.12, 0.36, 0.26, 0.14, 0.1, 0.02], lightEyes: 0.35 },
  ENG: { skin: [0.3, 0.28, 0.16, 0.12, 0.08, 0.06], hair: EU_HAIR, lightEyes: 0.35 },
  ESP: { skin: [0.18, 0.36, 0.28, 0.1, 0.05, 0.03], hair: LATIN_HAIR, lightEyes: 0.15 },
  FRA: { skin: [0.22, 0.24, 0.16, 0.14, 0.13, 0.11], hair: [0.3, 0.32, 0.2, 0.1, 0.06, 0.02], lightEyes: 0.25 },
  GER: { skin: [0.34, 0.3, 0.16, 0.1, 0.06, 0.04], hair: [0.12, 0.32, 0.26, 0.15, 0.13, 0.02], lightEyes: 0.4 },
  ITA: { skin: [0.2, 0.36, 0.28, 0.1, 0.04, 0.02], hair: LATIN_HAIR, lightEyes: 0.15 },
  JPN: { skin: [0.24, 0.5, 0.22, 0.04, 0, 0], hair: [0.75, 0.2, 0.05, 0, 0, 0], lightEyes: 0 },
  KOR: { skin: [0.3, 0.48, 0.2, 0.02, 0, 0], hair: [0.72, 0.22, 0.06, 0, 0, 0], lightEyes: 0 },
  MAR: { skin: [0.06, 0.22, 0.38, 0.24, 0.07, 0.03], hair: DARK_HAIR, lightEyes: 0.08 },
  NED: { skin: [0.34, 0.26, 0.14, 0.12, 0.08, 0.06], hair: NORDIC_HAIR, lightEyes: 0.45 },
  POR: { skin: [0.15, 0.32, 0.28, 0.14, 0.07, 0.04], hair: LATIN_HAIR, lightEyes: 0.15 },
  SWE: { skin: [0.42, 0.3, 0.12, 0.08, 0.05, 0.03], hair: NORDIC_HAIR, lightEyes: 0.55 },
  USA: { skin: [0.22, 0.22, 0.18, 0.15, 0.13, 0.1], hair: [0.25, 0.3, 0.2, 0.12, 0.1, 0.03], lightEyes: 0.3 },
};

const HAIR_STYLES: HairStyle[] = ['buzz', 'short', 'crop', 'side_part', 'quiff', 'curly', 'afro', 'waves', 'long', 'man_bun', 'bald', 'mohawk'];
const FACIAL: FacialHair[] = ['none', 'stubble', 'beard', 'goatee', 'mustache'];
const round2 = (v: number) => Math.round(v * 100) / 100;

function sample(rng: Rng, nation: string, age: number): Appearance {
  const look = LOOKS[nation] ?? LOOKS.USA;
  const skinTone = rng.weightedIndex(look.skin);
  const textured = skinTone >= 4;
  const hairColor = textured ? rng.weightedIndex([0.82, 0.18, 0, 0, 0, 0]) : rng.weightedIndex(look.hair);
  const hairWeights = HAIR_STYLES.map((h) => {
    switch (h) {
      case 'afro':
        return textured ? 1.3 : 0.05;
      case 'waves':
        return textured ? 1.5 : 0.1;
      case 'buzz':
        return textured ? 1.6 : 0.9;
      case 'curly':
        return 1.0;
      case 'long':
        return 0.55;
      case 'man_bun':
        return 0.45;
      case 'bald':
        return age > 29 ? 0.6 : 0.12;
      case 'mohawk':
        return 0.3;
      default:
        return textured ? 0.5 : 1.3;
    }
  });
  const light = rng.chance(look.lightEyes);
  return {
    skinTone,
    hairStyle: rng.weighted(HAIR_STYLES, hairWeights),
    hairColor,
    facialHair: rng.weighted(FACIAL, [0.42, 0.3, age > 24 ? 0.16 : 0.05, 0.07, 0.05]),
    faceWidth: round2(rng.float(0.15, 0.85)),
    jawWidth: round2(rng.float(0.15, 0.85)),
    browWeight: round2(rng.float(0.25, 0.9)),
    eyeColor: light ? rng.pick([2, 3]) : rng.weightedIndex([0.7, 0.3, 0, 0]),
    noseSize: round2(rng.float(0.2, 0.8)),
    mouthWidth: round2(rng.float(0.25, 0.75)),
    expression: rng.weighted(['neutral', 'focused', 'smile', 'shout'] as const, [0.4, 0.35, 0.17, 0.08]),
    headTurn: round2(rng.float(-0.6, 0.6)),
  };
}

/** Visible identity of a face: no two players share it. */
export function faceSignature(a: Appearance): string {
  return `${a.skinTone}|${a.hairStyle}|${a.hairColor}|${a.facialHair}`;
}

/**
 * One appearance per player. Every player gets a different combination of
 * skin tone, hairstyle, hair colour and facial hair (plus continuous face
 * shape parameters), so all 300 faces are distinct.
 */
export function generateAppearances(players: readonly Player[], existing: Record<string, Appearance> = {}): Record<string, Appearance> {
  const out: Record<string, Appearance> = {};
  const used = new Set<string>();
  // keep stored appearances first (manual edits survive regeneration)
  for (const p of players) {
    const a = existing[p.id];
    if (a && !used.has(faceSignature(a))) {
      out[p.id] = a;
      used.add(faceSignature(a));
    }
  }
  for (const p of players) {
    if (out[p.id]) continue;
    const rng = new Rng(`appearance:${p.id}`);
    let a = sample(rng, p.nationality, p.age);
    for (let i = 0; i < 500 && used.has(faceSignature(a)); i++) a = sample(rng, p.nationality, p.age);
    if (used.has(faceSignature(a))) throw new Error(`could not find a unique face for ${p.id}`);
    used.add(faceSignature(a));
    out[p.id] = a;
  }
  return out;
}
