import { NATION_BY_CODE, type Player } from '@fd/shared';
import type { Appearance } from './appearance';

/**
 * Prompts for the photorealistic portraits (AI image generation).
 * The players are fictional: prompts never name real people, clubs or
 * brands, and ask for no logos / text (spec 4-6).
 */
const SKIN = ['very fair skin', 'fair skin', 'light olive skin', 'olive tan skin', 'brown skin', 'dark brown skin'];
const HAIR_COLOR = ['black', 'dark brown', 'brown', 'light brown', 'blond', 'ginger'];
const HAIR: Record<Appearance['hairStyle'], (c: string) => string> = {
  buzz: (c) => `a ${c} buzz cut`,
  short: (c) => `short ${c} hair`,
  crop: (c) => `short cropped ${c} hair with a straight fringe`,
  side_part: (c) => `neat side-parted ${c} hair`,
  quiff: (c) => `a ${c} quiff`,
  curly: (c) => `short curly ${c} hair`,
  afro: (c) => `a ${c} afro`,
  waves: (c) => `a short ${c} waves haircut`,
  long: (c) => `shoulder-length ${c} hair`,
  man_bun: (c) => `${c} hair tied in a man bun`,
  bald: () => 'a clean shaved head',
  mohawk: (c) => `a short ${c} mohawk`,
};
const FACIAL: Record<Appearance['facialHair'], string> = {
  none: 'clean-shaven',
  stubble: 'light stubble',
  beard: 'a full trimmed beard',
  goatee: 'a goatee',
  mustache: 'a mustache',
};
const EXPRESSION: Record<Appearance['expression'], string> = {
  neutral: 'calm neutral expression',
  focused: 'focused, determined expression',
  smile: 'slight confident smile',
  shout: 'intense expression, mouth open shouting',
};

/** plain descriptions of the fictional kits (tools/card-art/src/kits.ts) */
export const KIT_TEXT: Record<string, string> = {
  'CL-01': 'a navy blue and white horizontally hooped football jersey with a round collar',
  'CL-07': 'a plain silver-grey football jersey with a charcoal V-neck collar',
  'CL-02': 'a dark blue and black vertically striped football jersey with a V-neck collar',
  'CL-08': 'a deep purple football jersey with a gold chevron across the chest and a gold V-neck collar',
  'CL-03': 'a violet football jersey with a white diagonal sash and a round collar',
  'CL-09': 'a football jersey split vertically half magenta and half black, with a V-neck collar',
  'CL-04': 'a dark navy football jersey with thin gold pinstripes and a gold V-neck collar',
  'CL-10': 'a plain crimson red football jersey with a cream round collar',
  'CL-05': 'a white football jersey with a teal diagonal sash and a teal V-neck collar',
  'CL-06': 'an orange and black vertically striped football jersey with a black round collar',
};

export function portraitPrompt(p: Player, a: Appearance): string {
  const nation = NATION_BY_CODE[p.nationality]?.name ?? '';
  const hair = HAIR[a.hairStyle](HAIR_COLOR[a.hairColor]);
  return [
    `Photorealistic studio portrait photograph of a fictional professional football (soccer) player, ${/^(8|11|18)/.test(String(p.age)) ? 'an' : 'a'} ${p.age}-year-old man from ${nation} with ${SKIN[a.skinTone]},`,
    `${hair}, ${FACIAL[a.facialHair]}, ${EXPRESSION[a.expression]}.`,
    `He wears ${KIT_TEXT[p.clubId]}; no logos, no badges, no sponsor, no text, no numbers.`,
    'Head and shoulders, facing the camera, centered, the face in the upper middle of the frame and the shoulders reaching the bottom edge.',
    'Dark charcoal studio background, dramatic soft lighting, sharp focus, 85mm lens. Not resembling any real person.',
  ].join(' ');
}
