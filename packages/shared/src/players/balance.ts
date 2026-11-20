import type { Player, Rarity, TraitId } from '../types';

/**
 * Card balance on top of the player database v1 (decisions 118-121,
 * docs/15-abilities-rarity-plan.md). The database files stay as delivered;
 * the catalog applies these two changes when it loads them:
 *
 * 1. OVR bands at acquisition: a card never starts above a card of a higher
 *    rarity. Each rarity's OVR range is mapped linearly onto its band (the
 *    order and the relative gaps inside a rarity are kept); the six card
 *    stats and the SIM attributes move by the same amount. Strengthening by
 *    duplicates (+5 at most) can still pass the next rarity's lowest cards.
 * 2. Special abilities: ICON two (one ICON-only + one shared), EPIC /
 *    LEGENDARY one, COMMON / RARE none; each chosen to fit the player's
 *    position, role and attributes (the table below).
 */

/** the OVR range of each rarity in the database v1, and its band in the game */
export const OVR_BANDS: Record<Rarity, { source: [number, number]; band: [number, number] }> = {
  common: { source: [45, 65], band: [45, 59] },
  rare: { source: [60, 75], band: [60, 69] },
  epic: { source: [70, 85], band: [70, 79] },
  legendary: { source: [80, 92], band: [80, 89] },
  icon: { source: [88, 99], band: [90, 99] },
};

/** number of special abilities by rarity */
export const ABILITY_COUNT: Record<Rarity, number> = { common: 0, rare: 0, epic: 1, legendary: 1, icon: 2 };

export function bandedOvr(rarity: Rarity, ovr: number): number {
  const { source, band } = OVR_BANDS[rarity];
  if (ovr < source[0] || ovr > source[1]) throw new Error(`OVR ${ovr} is outside the ${rarity} range ${source.join('-')}`);
  return band[0] + Math.round(((ovr - source[0]) * (band[1] - band[0])) / (source[1] - source[0]));
}

/** the abilities of every EPIC / LEGENDARY / ICON card (ICON: the ICON-only one first) */
export const CARD_ABILITIES: Record<string, TraitId[]> = {
  'FD-007': ['long_feed'], // LEGENDARY CM Felix Romero
  'FD-009': ['counter_runner'], // EPIC RW Theo Dubois
  'FD-015': ['leader'], // LEGENDARY CDM Rafael Alvarez
  'FD-021': ['speedster'], // EPIC CB Adrian Yilmaz
  'FD-023': ['man_marker'], // EPIC RB Kai Costa
  'FD-026': ['speedster'], // LEGENDARY CB Dante Berg
  'FD-030': ['last_line', 'long_feed'], // ICON CB Axel Petrov
  'FD-031': ['playmaker'], // EPIC CAM Enzo Novak
  'FD-034': ['long_feed'], // LEGENDARY CM Dario Fischer
  'FD-046': ['engine'], // EPIC CM Elias Weber
  'FD-057': ['iron_wall'], // EPIC CB Hugo Ferreira
  'FD-059': ['press_resistant'], // EPIC CM Kai Romero
  'FD-061': ['long_shot'], // EPIC LW Mateo Fischer
  'FD-063': ['legend_aura', 'engine'], // ICON CM Axel Fischer
  'FD-064': ['ball_winner'], // LEGENDARY CM Iker Romero
  'FD-068': ['press_resistant'], // EPIC CM Marco Voss
  'FD-069': ['leader'], // LEGENDARY CB Felix Petrov
  'FD-072': ['legend_aura', 'ball_winner'], // ICON CDM Soren Voss
  'FD-074': ['counter_runner'], // EPIC RW Soren Keller
  'FD-082': ['man_marker'], // EPIC RB Milan Sato
  'FD-084': ['cross_specialist'], // EPIC LW Luca Keller
  'FD-085': ['iron_wall'], // EPIC CB Silas Novak
  'FD-087': ['man_marker'], // EPIC RB Luca Reyes
  'FD-088': ['engine'], // LEGENDARY CM Axel Kovac
  'FD-090': ['long_feed'], // EPIC CM Luca Fischer
  'FD-092': ['ball_winner'], // EPIC CDM Felix Lind
  'FD-095': ['dribbler'], // EPIC RW Hugo Voss
  'FD-096': ['inexhaustible', 'man_marker'], // ICON RB Bruno Silva
  'FD-100': ['clinical_finisher'], // LEGENDARY CF Iker Lind
  'FD-108': ['fantasista', 'dribbler'], // ICON LM Ruben Silva
  'FD-110': ['clinical_finisher'], // EPIC CF Ruben Nakamura
  'FD-116': ['aerial_threat'], // EPIC ST Julian Novak
  'FD-131': ['cross_specialist'], // EPIC LM Amir Schneider
  'FD-133': ['ball_winner'], // LEGENDARY CM Tomas Bianchi
  'FD-134': ['cross_specialist'], // EPIC LW Adrian Petrov
  'FD-136': ['speedster'], // LEGENDARY LM Luca Schneider
  'FD-139': ['playmaker'], // LEGENDARY CAM Dante Nakamura
  'FD-141': ['overlap'], // EPIC RB Milan Rossi
  'FD-142': ['press_resistant'], // EPIC CM Soren Rossi
  'FD-145': ['dribbler'], // EPIC RM Axel Berg
  'FD-146': ['man_marker'], // EPIC LB Nico Silva
  'FD-149': ['sweeper_keeper'], // LEGENDARY GK Kai Weber
  'FD-152': ['long_feed'], // EPIC CB Soren Sato
  'FD-155': ['counter_runner'], // EPIC ST Nico Schneider
  'FD-156': ['long_feed'], // EPIC CM Julian Navarro
  'FD-161': ['aerial_threat'], // LEGENDARY ST Leon Weber
  'FD-163': ['cross_specialist'], // EPIC RW Axel Dubois
  'FD-165': ['sweeper_keeper'], // EPIC GK Milan Santos
  'FD-166': ['clinical_finisher'], // EPIC ST Victor Berg
  'FD-171': ['overlap'], // EPIC LB Rafael Yilmaz
  'FD-173': ['the_zone', 'long_shot'], // ICON CAM Adrian Mendes
  'FD-175': ['engine'], // LEGENDARY LM Tomas Romero
  'FD-181': ['inexhaustible', 'man_marker'], // ICON LB Elias Sato
  'FD-184': ['leader'], // LEGENDARY CM Victor Sato
  'FD-185': ['overlap'], // LEGENDARY RB Gabriel Bianchi
  'FD-190': ['overlap'], // EPIC RB Adrian Lind
  'FD-193': ['playmaker'], // LEGENDARY CAM Ruben Volkov
  'FD-196': ['aerial_threat'], // LEGENDARY ST Kai Volkov
  'FD-200': ['sweeper_keeper'], // EPIC GK Luca Berg
  'FD-201': ['playmaker'], // LEGENDARY CAM Orion Vale
  'FD-202': ['dribbler'], // EPIC RM Leon Volkov
  'FD-208': ['iron_wall'], // EPIC CB Nico Kovac
  'FD-212': ['cross_specialist'], // EPIC LM Kai Yilmaz
  'FD-213': ['long_feed'], // EPIC CM Amir Romero
  'FD-215': ['aerial_threat'], // LEGENDARY ST Theo Berg
  'FD-217': ['engine'], // EPIC CM Ruben Rossi
  'FD-221': ['clinical_finisher'], // EPIC ST Dante Lind
  'FD-222': ['cross_specialist'], // EPIC LB Milan Lind
  'FD-224': ['aerial_threat'], // EPIC ST Dario Kovac
  'FD-226': ['clutch'], // EPIC RW Iker Reyes
  'FD-227': ['playmaker'], // LEGENDARY CAM Enzo Nakamura
  'FD-231': ['press_resistant'], // EPIC CM Julian Bianchi
  'FD-234': ['the_zone', 'long_shot'], // ICON LW Julian Schneider
  'FD-236': ['leader'], // LEGENDARY CM Soren Navarro
  'FD-242': ['sweeper_keeper'], // EPIC GK Julian Kovac
  'FD-248': ['leader'], // EPIC CB Tomas Nakamura
  'FD-252': ['shot_stopper'], // EPIC GK Leon Kovac
  'FD-253': ['shot_stopper'], // EPIC GK Noah Alvarez
  'FD-259': ['counter_runner'], // EPIC LW Theo Alvarez
  'FD-263': ['speedster'], // LEGENDARY RM Rafael Keller
  'FD-266': ['man_marker'], // EPIC LB Marco Kovac
  'FD-267': ['speedster'], // LEGENDARY CB Enzo Navarro
  'FD-273': ['fantasista', 'long_shot'], // ICON LW Felix Silva
  'FD-275': ['long_feed'], // EPIC CB Silas Keller
  'FD-278': ['clinical_finisher'], // EPIC ST Leon Romero
  'FD-283': ['dribbler'], // LEGENDARY LM Felix Berg
  'FD-288': ['long_feed'], // LEGENDARY CB Noah Vale
  'FD-289': ['fox_in_box'], // EPIC ST Mateo Alvarez
  'FD-293': ['engine'], // EPIC CM Elian Romero
  'FD-300': ['leader'], // LEGENDARY CDM Amir Voss
};

const clamp = (v: number) => Math.max(1, Math.min(99, v));

/** a card as the game uses it: OVR in its band, stats moved with it, its abilities */
export function balanceCard(p: Player): Player {
  const ovr = bandedOvr(p.rarity, p.ovr);
  const d = ovr - p.ovr;
  const traits = CARD_ABILITIES[p.id] ?? [];
  if (traits.length !== ABILITY_COUNT[p.rarity]) throw new Error(`${p.id} (${p.rarity}) must have ${ABILITY_COUNT[p.rarity]} abilities`);
  return {
    ...p,
    ovr,
    traits,
    stats: { pac: clamp(p.stats.pac + d), sho: clamp(p.stats.sho + d), pas: clamp(p.stats.pas + d), dri: clamp(p.stats.dri + d), def: clamp(p.stats.def + d), phy: clamp(p.stats.phy + d) },
    attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, clamp(v + d)])) as unknown as Player['attributes'],
  };
}
