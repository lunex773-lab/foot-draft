import { computeChemistry } from './chemistry';
import { DEFAULT_TACTICS, FORMATION_IDS } from './data/formations';
import { POSITION_GROUP } from './data/positions';
import { assignPlayers, autoLineup } from './lineup';
import type { Rng } from './rng';
import type { Lineup, Player, Tactics } from './types';

export const CPU_NAMES = ['CPU Falcons', 'CPU Titans', 'CPU Comets', 'CPU Wolves', 'CPU Vipers', 'CPU Kestrels'];

function avg(players: Player[], f: (p: Player) => number): number {
  return players.length ? players.reduce((s, p) => s + f(p), 0) / players.length : 0;
}

/** CPU / auto tactics based on the roster (and optionally the next opponent). */
export function cpuTactics(starters: Player[], rng: Rng, opponent?: Player[]): Tactics {
  const fw = starters.filter((p) => POSITION_GROUP[p.primaryPosition] === 'FW');
  const mf = starters.filter((p) => POSITION_GROUP[p.primaryPosition] === 'MF');
  const pace = avg(fw, (p) => (p.attributes.sprintSpeed + p.attributes.acceleration) / 2);
  const passing = avg(mf, (p) => (p.attributes.shortPassing + p.attributes.vision) / 2);
  const aerial = fw.some((p) => p.role === 'target_man' || p.traits.includes('aerial_king'));
  const engine = avg([...fw, ...mf], (p) => p.attributes.stamina);

  const t: Tactics = { ...DEFAULT_TACTICS };
  const offenseScores = {
    possession: passing - 70 + (mf.some((p) => p.role === 'deep_playmaker' || p.role === 'advanced_playmaker') ? 4 : 0),
    counter: pace - 72 + (fw.some((p) => p.traits.includes('speedster')) ? 4 : 0),
    long_ball: aerial ? 4 : -6,
  };
  t.offense = (Object.entries(offenseScores).sort((a, b) => b[1] - a[1] + rng.normal(0, 1.5))[0][0] as Tactics['offense']) ?? 'possession';

  let oppPace = 0;
  if (opponent && opponent.length) {
    const ofw = opponent.filter((p) => POSITION_GROUP[p.primaryPosition] === 'FW');
    oppPace = avg(ofw, (p) => (p.attributes.sprintSpeed + p.attributes.acceleration) / 2);
  }
  if (engine >= 72 && oppPace < 80) t.defense = 'high_press';
  else if (oppPace >= 82) t.defense = 'low_block';
  else t.defense = rng.chance(0.7) ? 'mid_block' : 'high_press';
  t.defensiveLine = t.defense === 'high_press' ? 'high' : t.defense === 'low_block' ? 'deep' : 'normal';
  t.tempo = t.offense === 'possession' ? 'slow' : t.offense === 'counter' ? 'fast' : 'normal';
  t.passing = t.offense === 'possession' ? 'short' : t.offense === 'long_ball' ? 'direct' : 'mixed';
  t.whenLosing = 'attack';
  t.whenWinning = rng.chance(0.5) ? 'defend' : 'keep';
  return t;
}

/** CPU lineup: best formation by fit + chemistry, then tactics. */
export function cpuLineup(roster: Player[], rng: Rng, opponent?: Player[]): Lineup {
  const ranked = FORMATION_IDS.map((f) => ({ f, a: assignPlayers(roster, f) }))
    .sort((x, y) => y.a.score - x.a.score)
    .slice(0, 3);
  let best = autoLineup(roster, ranked[0].f);
  let bestScore = -Infinity;
  for (const { f } of ranked) {
    const l = autoLineup(roster, f);
    const starters = l.starters.map((id) => roster.find((p) => p.id === id));
    const tactics = cpuTactics(starters.filter(Boolean) as Player[], rng, opponent);
    const chem = computeChemistry(starters, f, tactics);
    const score = assignPlayers(roster, f).score / 11 + chem.score * 0.08;
    if (score > bestScore) {
      bestScore = score;
      best = { ...l, tactics };
    }
  }
  return best;
}
