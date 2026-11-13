import { computeChemistry, type ChemistryResult } from '../chemistry';
import { SIM_VERSION } from '../config';
import { FORMATIONS } from '../data/formations';
import { POSITION_GROUP, positionFamiliarity } from '../data/positions';
import { rawPositionRating } from '../players/ratings';
import { Rng, clamp, logistic } from '../rng';
import type { AttributeKey, FormationSlot, Player, PositionGroup, Tactics, TraitId } from '../types';
import type {
  ChanceType,
  MatchEvent,
  MatchEventType,
  MatchResultData,
  PlayerMatchStats,
  Side,
  SimInput,
  SimTeamInput,
  TacticNote,
  TeamStats,
  TrackPoint,
} from './types';

/**
 * FOOTBALL DRAFT match simulation (see docs/03-sim.md, version = SIM_VERSION).
 *
 * A match is a sequence of possessions. Each possession moves through
 * phases (build-up -> midfield -> final third -> shot) and every phase is a
 * contest between units of the two teams, computed from the players on the
 * pitch, their position fit, fatigue, chemistry, traits and both teams'
 * tactics. Randomness comes only from the seeded RNG, so the same input and
 * seed always produce the same match (spec 6-4).
 */

/** Tunable constants (balance-tested with scripts/balance.ts). */
export const SIM_TUNING = {
  contestScale: 8,
  biasBuild: 1.35,
  biasLongBall: 0.25,
  biasMid: 0.3,
  biasFinal: -1.6,
  biasCounter: -0.9,
  biasCorner: -0.7,
  recyclePossession: 0.38,
  recycleOther: 0.12,
  baseXg: {
    through_ball: 0.135,
    cutback: 0.1,
    dribble: 0.08,
    cross: 0.056,
    long_shot: 0.024,
    counter: 0.16,
    press_win: 0.14,
    set_piece: 0.06,
    direct_fk: 0.05,
    penalty: 0.76,
    knock_down: 0.09,
  } as Record<ChanceType, number>,
  staminaDrainPerSegment: 8.5,
};

type Phase = 'build' | 'mid' | 'final' | 'counter' | 'press_win' | 'corner' | 'free_kick' | 'long_ball';

interface OnPitch {
  p: Player;
  slot: FormationSlot;
  fam: number;
  /** card OVR / attribute level: SIM uses the attribute profile at the card's OVR level */
  scale: number;
  stamina: number;
  yellow: number;
  off: boolean;
  enteredAt: number;
  leftAt: number | null;
}

interface TeamState {
  side: Side;
  input: SimTeamInput;
  tactics: Tactics;
  lineup: OnPitch[];
  /** everyone who appeared (for stats) */
  appeared: OnPitch[];
  bench: Player[];
  subsUsed: number;
  chem: ChemistryResult;
  stats: TeamStats;
  goals: number;
  lateChange: string | null;
}

/** Calibrates a player's SIM attributes to the level of the card OVR. */
function ovrScale(p: Player): number {
  const raw = rawPositionRating(p.attributes, p.primaryPosition);
  return raw > 0 ? p.ovr / raw : 1;
}

const POS_SHOOT_WEIGHT: Record<string, number> = {
  ST: 3,
  LW: 1.8,
  RW: 1.8,
  CAM: 1.6,
  LM: 0.9,
  RM: 0.9,
  CM: 0.75,
  CDM: 0.3,
  LB: 0.25,
  RB: 0.25,
  CB: 0.2,
  GK: 0,
};

const DRAIN_POS: Record<string, number> = {
  GK: 0.25,
  CB: 0.75,
  LB: 1.05,
  RB: 1.05,
  CDM: 1.0,
  CM: 1.1,
  CAM: 0.95,
  LM: 1.1,
  RM: 1.1,
  LW: 1.0,
  RW: 1.0,
  ST: 0.9,
};

function emptyStats(): TeamStats {
  return {
    goals: 0,
    shots: 0,
    shotsOnTarget: 0,
    xg: 0,
    possession: 0,
    passes: 0,
    passesCompleted: 0,
    corners: 0,
    fouls: 0,
    yellow: 0,
    red: 0,
    saves: 0,
    tackles: 0,
    interceptions: 0,
    counters: 0,
    counterShots: 0,
    pressWins: 0,
    longBalls: 0,
    longBallsWon: 0,
    bigChances: 0,
  };
}

interface PStat extends PlayerMatchStats {
  ratingDelta: number;
}

export class MatchSimulator {
  private rng: Rng;
  private teams: Record<Side, TeamState>;
  private minute = 0;
  private events: MatchEvent[] = [];
  private track: TrackPoint[] = [];
  private pstats = new Map<string, PStat>();
  private possessionTime: Record<Side, number> = { home: 0, away: 0 };
  private readonly input: SimInput;

  constructor(input: SimInput) {
    this.input = input;
    this.rng = new Rng(`match:${input.seed}`);
    this.teams = { home: this.initTeam('home', input.home), away: this.initTeam('away', input.away) };
  }

  private initTeam(side: Side, input: SimTeamInput): TeamState {
    const byId = new Map(input.players.map((p) => [p.id, p]));
    const formation = FORMATIONS[input.lineup.formation];
    const lineup: OnPitch[] = formation.slots.map((slot, i) => {
      const p = byId.get(input.lineup.starters[i]);
      if (!p) throw new Error(`unknown starter ${input.lineup.starters[i]}`);
      return { p, slot, fam: positionFamiliarity(p.positions, slot.pos), scale: ovrScale(p), stamina: 100, yellow: 0, off: false, enteredAt: 0, leftAt: null };
    });
    const bench = input.lineup.bench.map((id) => {
      const p = byId.get(id);
      if (!p) throw new Error(`unknown bench player ${id}`);
      return p;
    });
    const chem = computeChemistry(
      lineup.map((o) => o.p),
      input.lineup.formation,
      input.lineup.tactics,
    );
    for (const o of lineup) this.addPStat(o.p, side, true);
    for (const p of bench) this.addPStat(p, side, false);
    return {
      side,
      input,
      tactics: { ...input.lineup.tactics },
      lineup,
      appeared: [...lineup],
      bench,
      subsUsed: 0,
      chem,
      stats: emptyStats(),
      goals: 0,
      lateChange: null,
    };
  }

  private addPStat(p: Player, side: Side, started: boolean) {
    this.pstats.set(p.id, {
      playerId: p.id,
      side,
      started,
      minutes: 0,
      goals: 0,
      assists: 0,
      shots: 0,
      shotsOnTarget: 0,
      keyPasses: 0,
      tackles: 0,
      interceptions: 0,
      saves: 0,
      yellow: 0,
      red: 0,
      rating: 6,
      staminaEnd: 100,
      ratingDelta: 0,
    });
  }

  // ---------------------------------------------------------------- helpers

  private other(side: Side): Side {
    return side === 'home' ? 'away' : 'home';
  }

  private active(t: TeamState): OnPitch[] {
    return t.lineup.filter((o) => !o.off);
  }

  private group(o: OnPitch): PositionGroup {
    return POSITION_GROUP[o.slot.pos];
  }

  private fatigue(o: OnPitch): number {
    return 0.78 + 0.22 * Math.pow(Math.max(0, o.stamina) / 100, 0.6);
  }

  /** effective attribute of a player on the pitch */
  private eff(t: TeamState, o: OnPitch, key: AttributeKey): number {
    const isGkAttr = key === 'gkReflexes' || key === 'gkHandling' || key === 'gkPositioning';
    const fam = isGkAttr ? 1 : o.fam;
    let v = o.p.attributes[key] * o.scale * fam * this.fatigue(o) * t.chem.modifier;
    // Leader: limits the late-game drop when losing
    if (this.minute >= 70 && t.goals < this.teams[this.other(t.side)].goals && this.active(t).some((x) => x.p.traits.includes('leader'))) {
      v *= 1.01;
    }
    return v;
  }

  private unit(t: TeamState, filter: (o: OnPitch) => number, weights: Partial<Record<AttributeKey, number>>): number {
    let sum = 0;
    let wsum = 0;
    for (const o of this.active(t)) {
      const w = filter(o);
      if (w <= 0) continue;
      let v = 0;
      for (const k in weights) v += this.eff(t, o, k as AttributeKey) * (weights[k as AttributeKey] as number);
      sum += v * w;
      wsum += w;
    }
    const base = wsum > 0 ? sum / wsum : 30;
    // numerical disadvantage after a red card
    const missing = 11 - this.active(t).length;
    return base - missing * 4;
  }

  private byGroup(...groups: PositionGroup[]) {
    return (o: OnPitch) => (groups.includes(this.group(o)) ? 1 : 0);
  }

  private flankOf(o: OnPitch): 'left' | 'center' | 'right' {
    return o.slot.x < 36 ? 'left' : o.slot.x > 64 ? 'right' : 'center';
  }

  private mirror(f: 'left' | 'center' | 'right'): 'left' | 'center' | 'right' {
    return f === 'left' ? 'right' : f === 'right' ? 'left' : 'center';
  }

  /** number of players on the pitch with a trait, optionally only in given slot groups */
  private traitCount(t: TeamState, trait: TraitId, groups?: PositionGroup[]): number {
    return this.active(t).filter((o) => o.p.traits.includes(trait) && (!groups || groups.includes(this.group(o)))).length;
  }

  private has(o: OnPitch | undefined, trait: TraitId): boolean {
    return !!o && o.p.traits.includes(trait);
  }

  /** absolute pitch coordinates for the attacking side */
  private abs(side: Side, x: number, depth: number): { x: number; y: number } {
    return side === 'home' ? { x, y: depth } : { x: 100 - x, y: 100 - depth };
  }

  private flankX(f: 'left' | 'center' | 'right'): number {
    return f === 'left' ? this.rng.float(10, 30) : f === 'right' ? this.rng.float(70, 90) : this.rng.float(38, 62);
  }

  private addTrack(side: Side, x: number, depth: number) {
    const a = this.abs(side, x, depth);
    this.track.push({ t: Math.round(Math.min(90, this.minute) * 100) / 100, x: Math.round(a.x), y: Math.round(a.y), s: side === 'home' ? 0 : 1 });
  }

  private addEvent(type: MatchEventType, side: Side, x: number, depth: number, extra: Partial<MatchEvent> = {}) {
    const a = this.abs(side, x, depth);
    this.events.push({
      minute: Math.round(Math.min(90, this.minute) * 10) / 10,
      type,
      side,
      x: Math.round(a.x),
      y: Math.round(a.y),
      score: [this.teams.home.goals, this.teams.away.goals],
      ...extra,
    });
  }

  private advance(side: Side, minutes: number) {
    const t = this.teams[side].tactics;
    let m = minutes;
    if (t.tempo === 'slow') m *= 1.22;
    if (t.tempo === 'fast') m *= 0.82;
    if (t.offense === 'possession') m *= 1.12;
    this.minute += m;
    this.possessionTime[side] += m;
  }

  private contest(a: number, d: number, bias: number): boolean {
    return this.rng.chance(logistic((a - d) / SIM_TUNING.contestScale + bias));
  }

  private passes(side: Side, n: number, completedAll = true) {
    const s = this.teams[side].stats;
    s.passes += n;
    let done = completedAll ? n : Math.max(0, n - 1);
    // loose passes that were recovered by the same team
    for (let i = 0; i < done; i++) if (this.rng.chance(0.09)) done--;
    s.passesCompleted += done;
  }

  private pickPlayer(t: TeamState, weight: (o: OnPitch) => number): OnPitch {
    const list = this.active(t);
    return list[this.rng.weightedIndex(list.map(weight))];
  }

  private stat(o: OnPitch): PStat {
    return this.pstats.get(o.p.id) as PStat;
  }

  // ------------------------------------------------------------ team units

  private buildUp(t: TeamState): number {
    let v = this.unit(t, (o) => (this.group(o) === 'DF' ? 0.8 : this.group(o) === 'MF' ? 1.2 : 0), { shortPassing: 0.4, ballControl: 0.25, vision: 0.2, longPassing: 0.15 });
    if (t.tactics.offense === 'possession') v += 4;
    if (t.tactics.passing === 'short') v += 1.5;
    if (t.tactics.passing === 'direct') v -= 1;
    if (this.active(t).some((o) => o.p.role === 'keeper_libero')) v += 1.5;
    v += Math.min(4, this.traitCount(t, 'press_resistant', ['DF', 'MF']) * 2);
    return v;
  }

  private press(t: TeamState): number {
    let v = this.unit(t, (o) => (this.group(o) === 'FW' ? 1 : this.group(o) === 'MF' ? 1 : 0), { acceleration: 0.25, sprintSpeed: 0.15, interception: 0.25, tackling: 0.2, stamina: 0.15 });
    if (t.tactics.defense === 'high_press') v += 6;
    v += Math.min(3, this.traitCount(t, 'ball_winner', ['DF', 'MF']));
    if (t.tactics.defense === 'low_block') v -= 6;
    if (t.tactics.pressIntensity === 'high') v += 2;
    if (t.tactics.pressIntensity === 'low') v -= 2;
    if (t.tactics.defensiveLine === 'high') v += 1;
    return v;
  }

  private progression(t: TeamState): number {
    let v = this.unit(t, (o) => (this.group(o) === 'MF' ? 1 : this.group(o) === 'FW' ? 0.35 : 0.15), { shortPassing: 0.3, vision: 0.2, dribbling: 0.25, ballControl: 0.25 });
    v += Math.min(2, this.traitCount(t, 'playmaker', ['MF', 'FW'])) * 2;
    v += Math.min(2, this.traitCount(t, 'press_resistant', ['DF', 'MF']));
    if (t.tactics.offense === 'possession') v += 2.5;
    if (t.tactics.tempo === 'fast') v -= 1;
    if (t.tactics.tempo === 'slow') v += 0.5;
    return v;
  }

  private midDefense(t: TeamState): number {
    let v = this.unit(t, (o) => (this.group(o) === 'MF' ? 1 : this.group(o) === 'DF' ? 0.35 : 0.1), { interception: 0.4, tackling: 0.35, strength: 0.25 });
    if (t.tactics.defense === 'low_block') v += 2.5;
    if (t.tactics.defense === 'high_press') v += 1;
    v += Math.min(4, this.traitCount(t, 'ball_winner', ['DF', 'MF']) * 2);
    return v;
  }

  private attackWeight(t: TeamState, flank: 'left' | 'center' | 'right') {
    return (o: OnPitch) => {
      const g = this.group(o);
      if (g === 'GK') return 0;
      let w = g === 'FW' ? 1.4 : g === 'MF' ? (o.slot.pos === 'CAM' || o.slot.pos === 'LM' || o.slot.pos === 'RM' ? 1 : 0.45) : o.p.role === 'wingback' ? 0.45 : 0.1;
      const f = this.flankOf(o);
      w *= f === flank ? 1.8 : f === 'center' || flank === 'center' ? 0.9 : 0.4;
      return w;
    };
  }

  private chanceCreation(t: TeamState, flank: 'left' | 'center' | 'right'): number {
    let v = this.unit(t, this.attackWeight(t, flank), {
      dribbling: 0.25,
      acceleration: 0.1,
      sprintSpeed: 0.1,
      vision: 0.125,
      shortPassing: 0.125,
      ballControl: 0.15,
      positioning: 0.15,
    });
    if (t.tactics.tempo === 'fast') v += 1;
    if (t.lateChange === 'attack') v += 2;
    if (t.tactics.offense === 'counter') v -= 1.5;
    if (t.tactics.offense === 'possession') v += 1.5;
    return v;
  }

  private backline(t: TeamState, flank: 'left' | 'center' | 'right'): number {
    let v = this.unit(
      t,
      (o) => {
        const g = this.group(o);
        if (g !== 'DF' && o.slot.pos !== 'CDM') return 0;
        let w = g === 'DF' ? 1 : 0.5;
        const f = this.flankOf(o);
        w *= f === flank ? 1.7 : f === 'center' ? 1 : 0.5;
        return w;
      },
      { tackling: 0.35, interception: 0.35, sprintSpeed: 0.15, strength: 0.15 },
    );
    if (t.tactics.defense === 'low_block') v += 1.5;
    if (t.tactics.defense === 'high_press') v -= 1;
    if (t.tactics.defensiveLine === 'deep') v += 2;
    if (t.tactics.defensiveLine === 'high') v -= 1;
    if (t.lateChange === 'attack') v -= 2;
    return v;
  }

  private paceAttack(t: TeamState): number {
    let v = this.unit(t, (o) => (this.group(o) === 'FW' ? 1.4 : o.slot.pos === 'LM' || o.slot.pos === 'RM' || o.slot.pos === 'CAM' ? 0.8 : 0), { acceleration: 0.4, sprintSpeed: 0.4, dribbling: 0.2 });
    v += Math.min(2, this.traitCount(t, 'speedster', ['FW', 'MF'])) * 4;
    return v;
  }

  private paceDefense(t: TeamState): number {
    let v = this.unit(t, (o) => (this.group(o) === 'DF' ? 1 : 0), { acceleration: 0.3, sprintSpeed: 0.4, interception: 0.3 });
    v += Math.min(2, this.traitCount(t, 'speedster', ['DF'])) * 3;
    if (t.tactics.defensiveLine === 'high') v -= 5;
    if (t.tactics.defensiveLine === 'deep') v += 5;
    if (t.tactics.defense === 'low_block') v += 2;
    if (t.tactics.defense === 'high_press') v -= 2;
    const gk = this.active(t).find((o) => o.slot.pos === 'GK');
    if (gk?.p.traits.includes('sweeper_keeper')) v += t.tactics.defensiveLine === 'high' ? 6 : 4;
    return v;
  }

  private aerialAttack(t: TeamState): number {
    const top = this.active(t)
      .filter((o) => o.slot.pos !== 'GK')
      .map((o) => this.eff(t, o, 'jumping') * 0.5 + this.eff(t, o, 'strength') * 0.3 + this.eff(t, o, 'finishing') * 0.2 + (this.has(o, 'aerial_threat') ? 8 : 0))
      .sort((a, b) => b - a)
      .slice(0, 3);
    const setPiece = this.traitCount(t, 'cross_specialist') > 0 ? 3 : 0;
    return top.reduce((s, v) => s + v, 0) / Math.max(1, top.length) + setPiece;
  }

  private aerialDefense(t: TeamState): number {
    const top = this.active(t)
      .filter((o) => o.slot.pos !== 'GK')
      .map((o) => this.eff(t, o, 'jumping') * 0.5 + this.eff(t, o, 'strength') * 0.4 + this.eff(t, o, 'interception') * 0.1 + (this.has(o, 'aerial_threat') ? 8 : 0))
      .sort((a, b) => b - a)
      .slice(0, 3);
    return top.reduce((s, v) => s + v, 0) / Math.max(1, top.length);
  }

  private gkRating(t: TeamState): { rating: number; o: OnPitch | undefined } {
    const gk = this.active(t).find((o) => o.slot.pos === 'GK');
    if (!gk) return { rating: 25, o: undefined };
    const r = this.eff(t, gk, 'gkReflexes') * 0.4 + this.eff(t, gk, 'gkPositioning') * 0.3 + this.eff(t, gk, 'gkHandling') * 0.3;
    // an outfield player in goal is terrible
    return { rating: gk.p.primaryPosition === 'GK' ? r : Math.min(r, 35), o: gk };
  }

  // ----------------------------------------------------------- simulation

  run(): MatchResultData {
    let side: Side = 'home';
    let phase: Phase = 'build';
    this.addEvent('kickoff', 'home', 50, 50);
    this.addTrack('home', 50, 50);
    for (let seg = 0; seg < 6; seg++) {
      const segEnd = (seg + 1) * 15;
      if (seg === 3) {
        // possessions may run past 45'; the second half starts after the last first-half event
        this.minute = Math.max(45, this.minute);
        this.addEvent('half_time', 'home', 50, 50);
        for (const t of [this.teams.home, this.teams.away]) for (const o of this.active(t)) o.stamina = Math.min(100, o.stamina + 6);
        side = 'away';
        phase = 'build';
        this.addEvent('kickoff', 'away', 50, 50);
        this.addTrack('away', 50, 50);
      }
      if (seg === 4 || seg === 5) {
        for (const t of [this.teams.home, this.teams.away]) {
          this.lateTactics(t);
          this.substitutions(t, seg === 4 ? 56 : 66);
        }
      }
      while (this.minute < segEnd) {
        const next = this.possession(side, phase);
        side = next.side;
        phase = next.phase;
      }
      for (const t of [this.teams.home, this.teams.away]) this.drainStamina(t);
    }
    this.minute = 90;
    this.addEvent('full_time', 'home', 50, 50);
    return this.finish();
  }

  /** runs one possession phase, returns who has the ball next */
  private possession(side: Side, phase: Phase): { side: Side; phase: Phase } {
    const att = this.teams[side];
    const def = this.teams[this.other(side)];
    const T = SIM_TUNING;
    switch (phase) {
      case 'build': {
        this.addTrack(side, this.rng.float(30, 70), this.rng.float(15, 32));
        const direct = att.tactics.offense === 'long_ball' ? 0.75 : att.tactics.passing === 'direct' ? 0.35 : att.tactics.passing === 'mixed' ? 0.1 : 0.03;
        if (this.rng.chance(direct)) {
          this.advance(side, 0.25);
          return { side, phase: 'long_ball' };
        }
        this.advance(side, 0.38);
        const ok = this.contest(this.buildUp(att), this.press(def), T.biasBuild);
        if (ok) {
          this.passes(side, this.rng.int(3, att.tactics.offense === 'possession' ? 8 : 5));
          return { side, phase: 'mid' };
        }
        this.passes(side, this.rng.int(2, 4), false);
        if (this.rng.chance(att.tactics.offense === 'possession' ? T.recyclePossession : T.recycleOther)) {
          this.advance(side, 0.15);
          return { side, phase: 'build' };
        }
        if (this.rng.chance(0.1)) return this.foul(def, side, 'build');
        this.creditDefense(def, ['FW', 'MF']);
        const pressWinChance = def.tactics.defense === 'high_press' ? 0.5 : def.tactics.defense === 'mid_block' ? 0.28 : 0.12;
        if (this.rng.chance(pressWinChance)) {
          def.stats.pressWins++;
          return { side: def.side, phase: 'press_win' };
        }
        return { side: def.side, phase: 'mid' };
      }
      case 'long_ball': {
        att.stats.longBalls++;
        const lp = this.unit(att, (o) => (this.group(o) === 'DF' || this.group(o) === 'MF' || o.slot.pos === 'GK' ? 1 : 0), { longPassing: 0.7, vision: 0.3 });
        const targets = this.aerialAttack(att) * 0.55 + this.paceAttack(att) * 0.45;
        let a = lp * 0.45 + targets * 0.55;
        if (att.tactics.offense === 'long_ball') a += 2;
        let d = this.aerialDefense(def) * 0.55 + this.paceDefense(def) * 0.45;
        if (def.tactics.defense === 'high_press') d -= 3; // press bypassed
        const ok = this.contest(a, d, T.biasLongBall);
        this.passes(side, 1, ok);
        this.advance(side, 0.2);
        if (ok) {
          att.stats.longBallsWon++;
          this.addTrack(side, this.rng.float(30, 70), this.rng.float(68, 80));
          if (this.rng.chance(0.36)) return this.shot(att, def, 'knock_down', this.rng.pick(['left', 'center', 'right'] as const));
          return { side, phase: 'final' };
        }
        this.creditDefense(def, ['DF']);
        return { side: def.side, phase: this.rng.chance(0.35) ? 'mid' : 'build' };
      }
      case 'mid': {
        this.addTrack(side, this.rng.float(20, 80), this.rng.float(40, 60));
        this.advance(side, 0.32);
        const ok = this.contest(this.progression(att), this.midDefense(def), T.biasMid);
        if (ok) {
          this.passes(side, this.rng.int(2, 5));
          return { side, phase: 'final' };
        }
        this.passes(side, this.rng.int(1, 3), false);
        if (this.rng.chance(att.tactics.offense === 'possession' ? T.recyclePossession * 0.8 : T.recycleOther)) {
          this.advance(side, 0.15);
          return { side, phase: 'build' };
        }
        if (this.rng.chance(0.22)) return this.foul(def, side, 'mid');
        this.creditDefense(def, ['MF', 'DF']);
        return this.turnover(def, 'mid');
      }
      case 'counter': {
        att.stats.counters++;
        this.addTrack(side, this.rng.float(30, 70), this.rng.float(55, 70));
        this.advance(side, 0.18);
        let a = this.paceAttack(att);
        if (att.tactics.offense === 'counter') a += 3;
        a += Math.min(2, this.traitCount(att, 'counter_runner', ['FW', 'MF'])) * 5;
        const ok = this.contest(a, this.paceDefense(def), T.biasCounter);
        if (ok) {
          this.passes(side, this.rng.int(1, 3));
          return this.shot(att, def, 'counter', this.rng.pick(['left', 'center', 'right'] as const));
        }
        if (this.rng.chance(0.4)) return { side, phase: 'final' };
        this.creditDefense(def, ['DF']);
        return { side: def.side, phase: 'build' };
      }
      case 'press_win': {
        this.addTrack(side, this.rng.float(25, 75), this.rng.float(70, 82));
        this.addEvent('press_win', side, 50, 75);
        this.advance(side, 0.12);
        const ok = this.contest(this.chanceCreation(att, 'center'), this.backline(def, 'center'), T.biasFinal + 0.85);
        if (ok) return this.shot(att, def, 'press_win', 'center');
        return { side, phase: 'final' };
      }
      case 'final': {
        const flank = this.chooseFlank(att, def);
        this.addTrack(side, this.flankX(flank), this.rng.float(70, 84));
        this.advance(side, 0.3);
        const ok = this.contest(this.chanceCreation(att, flank), this.backline(def, this.mirror(flank)), T.biasFinal);
        if (ok) {
          this.passes(side, this.rng.int(1, 3));
          return this.shot(att, def, this.chanceTypeFor(att, flank), flank);
        }
        const vsLowBlock = def.tactics.defense === 'low_block';
        const r = this.rng.next();
        if (r < (vsLowBlock ? 0.14 : 0.11)) return { side, phase: 'corner' };
        if (r < (vsLowBlock ? 0.22 : 0.19)) return this.foul(def, side, 'final');
        if (r < (vsLowBlock ? 0.3 : 0.25)) return this.shot(att, def, 'long_shot', flank);
        if (att.tactics.offense === 'possession' && this.rng.chance(0.35)) {
          this.passes(side, this.rng.int(2, 4));
          this.advance(side, 0.2);
          return { side, phase: 'mid' };
        }
        this.passes(side, 1, false);
        this.creditDefense(def, ['DF', 'MF']);
        return this.turnover(def, 'final');
      }
      case 'corner': {
        att.stats.corners++;
        const left = this.rng.chance(0.5);
        this.addEvent('corner', side, left ? 1 : 99, 99);
        this.addTrack(side, left ? 1 : 99, 99);
        this.advance(side, 0.25);
        const ok = this.contest(this.aerialAttack(att), this.aerialDefense(def), T.biasCorner);
        if (ok) return this.shot(att, def, 'set_piece', 'center');
        if (this.rng.chance(0.25)) return this.turnover(def, 'final');
        return { side: def.side, phase: 'build' };
      }
      case 'free_kick': {
        this.advance(side, 0.25);
        const taker = this.bestBy(att, (o) => this.eff(att, o, 'shotAccuracy') * 0.5 + this.eff(att, o, 'shotPower') * 0.3 + (this.has(o, 'long_shot') ? 12 : 0) + (this.has(o, 'cross_specialist') ? 6 : 0) - (o.slot.pos === 'GK' ? 100 : 0));
        if (this.rng.chance(0.45)) return this.shot(att, def, 'direct_fk', 'center', taker);
        const ok = this.contest(this.aerialAttack(att), this.aerialDefense(def), T.biasCorner + 0.1);
        if (ok) return this.shot(att, def, 'set_piece', 'center', undefined, taker);
        return { side: def.side, phase: 'build' };
      }
    }
  }

  private chooseFlank(att: TeamState, def: TeamState): 'left' | 'center' | 'right' {
    const fixed = att.tactics.attackSide;
    if (fixed !== 'balanced' && this.rng.chance(0.65)) return fixed;
    const flanks = ['left', 'center', 'right'] as const;
    // exploit the weaker side of the opponent
    const w = flanks.map((f) => Math.exp((this.chanceCreation(att, f) - this.backline(def, this.mirror(f))) / 10));
    return flanks[this.rng.weightedIndex(w)];
  }

  private chanceTypeFor(att: TeamState, flank: 'left' | 'center' | 'right'): ChanceType {
    const aerial = this.active(att).some((o) => this.group(o) === 'FW' && (o.p.role === 'target_man' || this.has(o, 'aerial_threat')));
    if (flank !== 'center') {
      // Cross Specialist: only players in a wide slot on this flank
      const crossers = this.active(att).filter((o) => this.has(o, 'cross_specialist') && this.flankOf(o) === flank).length;
      const crossP = (aerial ? 0.55 : 0.3) + (att.tactics.offense === 'long_ball' ? 0.15 : 0) + Math.min(2, crossers) * 0.1;
      return this.rng.chance(crossP) ? 'cross' : 'cutback';
    }
    const dribbling = this.unit(att, (o) => (this.group(o) === 'FW' || o.slot.pos === 'CAM' ? 1 : 0), { dribbling: 1 });
    return this.rng.chance(0.3 + Math.max(0, dribbling - 70) * 0.01) ? 'dribble' : 'through_ball';
  }

  private bestBy(t: TeamState, f: (o: OnPitch) => number): OnPitch {
    let best = this.active(t)[0];
    let bv = -Infinity;
    for (const o of this.active(t)) {
      const v = f(o);
      if (v > bv) {
        bv = v;
        best = o;
      }
    }
    return best;
  }

  private creditDefense(def: TeamState, groups: PositionGroup[]) {
    const o = this.pickPlayer(def, (x) =>
      groups.includes(this.group(x)) ? (x.p.attributes.tackling + x.p.attributes.interception) * (this.has(x, 'ball_winner') && this.group(x) !== 'GK' ? 1.5 : 1) : 1,
    );
    const st = this.stat(o);
    if (this.rng.chance(o.p.attributes.interception / (o.p.attributes.interception + o.p.attributes.tackling))) {
      st.interceptions++;
      def.stats.interceptions++;
    } else {
      st.tackles++;
      def.stats.tackles++;
    }
    st.ratingDelta += 0.08;
  }

  private turnover(winner: TeamState, zone: 'mid' | 'final'): { side: Side; phase: Phase } {
    const loser = this.teams[this.other(winner.side)];
    const runners = Math.min(2, this.traitCount(winner, 'counter_runner', ['FW', 'MF']));
    const counterBase = (winner.tactics.offense === 'counter' ? 0.24 : winner.tactics.offense === 'long_ball' ? 0.1 : 0.06) * (1 + runners * 0.08);
    // opponents committed forward leave more space
    const space = (loser.tactics.defensiveLine === 'high' ? 1.25 : loser.tactics.defensiveLine === 'deep' ? 0.8 : 1) * (loser.lateChange === 'attack' ? 1.3 : 1);
    const deep = winner.tactics.defense === 'low_block' ? 0.7 : winner.tactics.defense === 'high_press' ? 1.15 : 1; // distance to goal
    if (this.rng.chance(counterBase * space * deep * (zone === 'final' ? 1.1 : 1))) {
      this.addEvent('counter', winner.side, 50, 45);
      return { side: winner.side, phase: 'counter' };
    }
    return { side: winner.side, phase: zone === 'final' ? 'build' : this.rng.chance(0.3) ? 'mid' : 'build' };
  }

  private foul(def: TeamState, attSide: Side, zone: 'build' | 'mid' | 'final'): { side: Side; phase: Phase } {
    const att = this.teams[attSide];
    const groups: PositionGroup[] = zone === 'final' ? ['DF', 'MF'] : zone === 'mid' ? ['MF'] : ['FW', 'MF'];
    const fouler = this.pickPlayer(def, (o) => (groups.includes(this.group(o)) ? 1 + o.p.attributes.tackling / 100 : 0.05));
    const fouled = this.pickPlayer(att, (o) => (o.slot.pos === 'GK' ? 0 : 1 + o.p.attributes.dribbling / 100));
    def.stats.fouls++;
    const depth = zone === 'final' ? 80 : zone === 'mid' ? 50 : 25;
    this.addEvent('foul', attSide, this.rng.float(20, 80), depth, { playerId: fouler.p.id, otherId: fouled.p.id });
    let yellowP = 0.26 + (def.tactics.pressIntensity === 'high' ? 0.04 : 0);
    if (zone === 'final') yellowP += 0.05;
    if (this.rng.chance(0.004)) this.sendOff(def, fouler, false);
    else if (this.rng.chance(yellowP)) {
      fouler.yellow++;
      def.stats.yellow++;
      this.stat(fouler).yellow++;
      this.stat(fouler).ratingDelta -= 0.3;
      if (fouler.yellow >= 2) this.sendOff(def, fouler, true);
      else this.addEvent('yellow', def.side, 50, 50, { playerId: fouler.p.id });
    }
    if (zone === 'final') {
      if (this.rng.chance(0.12)) {
        this.addEvent('penalty', attSide, 50, 89, { playerId: fouled.p.id });
        const taker = this.bestBy(att, (o) => this.eff(att, o, 'finishing') * 0.5 + this.eff(att, o, 'shotAccuracy') * 0.5 + (this.has(o, 'clinical_finisher') ? 5 : 0) - (o.slot.pos === 'GK' ? 100 : 0));
        return this.shot(att, def, 'penalty', 'center', taker);
      }
      this.addEvent('free_kick', attSide, 50, 75);
      return { side: attSide, phase: 'free_kick' };
    }
    return { side: attSide, phase: zone === 'build' ? 'build' : 'mid' };
  }

  private sendOff(t: TeamState, o: OnPitch, secondYellow: boolean) {
    o.off = true;
    o.leftAt = this.minute;
    t.stats.red++;
    const st = this.stat(o);
    st.red++;
    st.ratingDelta -= 1.5;
    this.addEvent('red', t.side, 50, 50, { playerId: o.p.id, detail: secondYellow ? 'second_yellow' : 'straight' });
    // GK sent off: move the best remaining outfield player in goal
    if (o.slot.pos === 'GK') {
      const replacement = this.bestBy(t, (x) => x.p.attributes.gkReflexes + x.p.attributes.jumping * 0.2);
      if (replacement) {
        replacement.slot = o.slot;
        replacement.fam = positionFamiliarity(replacement.p.positions, 'GK');
      }
    }
  }

  private shot(att: TeamState, def: TeamState, chance: ChanceType, flank: 'left' | 'center' | 'right', forcedShooter?: OnPitch, forcedAssist?: OnPitch): { side: Side; phase: Phase } {
    const T = SIM_TUNING;
    const late = this.minute >= 75 && att.goals <= def.goals;
    const header = chance === 'cross' || chance === 'set_piece';
    const longShot = chance === 'long_shot' || chance === 'direct_fk';
    const shooter =
      forcedShooter ??
      this.pickPlayer(att, (o) => {
        let w = POS_SHOOT_WEIGHT[o.slot.pos] ?? 0.2;
        if (chance === 'set_piece' && o.slot.pos === 'CB') w = 1.5;
        if (header) w *= (o.p.attributes.jumping + o.p.attributes.strength) / 130 + (this.has(o, 'aerial_threat') ? 1.2 : 0);
        else if (longShot) w *= (o.p.attributes.shotPower + o.p.attributes.shotAccuracy) / 130 + (this.has(o, 'long_shot') ? 1.2 : 0);
        else w *= (o.p.attributes.finishing + o.p.attributes.positioning) / 130 + (this.has(o, 'clinical_finisher') ? 0.2 : 0);
        if (flank !== 'center' && !header && this.flankOf(o) === flank) w *= 1.3;
        return Math.max(0.01, w);
      });
    let assister: OnPitch | undefined = forcedAssist;
    if (!assister && (chance === 'through_ball' || chance === 'cutback' || chance === 'cross' || chance === 'counter' || chance === 'knock_down' || chance === 'press_win')) {
      const cands = this.active(att).filter((o) => o !== shooter && o.slot.pos !== 'GK');
      if (cands.length) {
        assister = cands[
          this.rng.weightedIndex(
            cands.map((o) => {
              let w = chance === 'cross' ? o.p.attributes.longPassing * (this.flankOf(o) === flank ? 2 : 0.6) : o.p.attributes.vision + o.p.attributes.shortPassing;
              if (o.p.traits.includes('playmaker')) w *= 1.4;
              return w;
            }),
          )
        ];
      }
    }

    // chance quality (xG)
    let finishing = header
      ? (this.eff(att, shooter, 'jumping') + this.eff(att, shooter, 'finishing')) / 2
      : longShot
        ? (this.eff(att, shooter, 'shotPower') + this.eff(att, shooter, 'shotAccuracy')) / 2
        : this.eff(att, shooter, 'finishing') * 0.75 + this.eff(att, shooter, 'positioning') * 0.25;
    let q = T.baseXg[chance] * (1 + (finishing - 72) / 110);
    if (chance !== 'penalty') q *= 1 - (this.backline(def, this.mirror(flank)) - 70) / 260;
    // trait conditions (spec 4-4): only the shooter / assister in a valid situation
    if (longShot && this.has(shooter, 'long_shot')) q *= 1.5;
    if (!longShot && !header && this.has(shooter, 'clinical_finisher')) q *= 1.15;
    if (header && this.has(shooter, 'aerial_threat')) q *= 1.4;
    if (this.has(assister, 'playmaker') && assister && this.group(assister) !== 'DF') q *= 1.15;
    if (chance === 'cross' && this.has(assister, 'cross_specialist') && assister && this.flankOf(assister) !== 'center') q *= 1.2;
    q = clamp(q, 0.01, 0.85);

    att.stats.shots++;
    att.stats.xg += q;
    if (q >= 0.3) att.stats.bigChances++;
    if (chance === 'counter') att.stats.counterShots++;
    const sst = this.stat(shooter);
    sst.shots++;
    if (assister) {
      this.stat(assister).keyPasses++;
      this.stat(assister).ratingDelta += 0.12;
    }

    const depth = longShot ? this.rng.float(70, 78) : header ? this.rng.float(88, 95) : this.rng.float(84, 92);
    const x = flank === 'left' ? this.rng.float(30, 45) : flank === 'right' ? this.rng.float(55, 70) : this.rng.float(40, 60);
    this.addTrack(att.side, x, depth);
    this.advance(att.side, 0.12);

    const gk = this.gkRating(def);
    let gkr = gk.rating;
    const pGoal = clamp(q * (1 - (gkr - 72) / 130), 0.005, 0.92);
    const pSave = chance === 'penalty' ? 1 - pGoal - 0.06 : clamp(0.17 + (this.eff(att, shooter, 'shotAccuracy') - 70) / 220 + q * 0.25, 0.06, 0.45);
    const pBlock = chance === 'penalty' || chance === 'direct_fk' ? 0 : 0.14;
    const u = this.rng.next();
    const base = { playerId: shooter.p.id, chance, xg: Math.round(q * 100) / 100 };

    if (u < pGoal) {
      att.goals++;
      att.stats.goals++;
      att.stats.shotsOnTarget++;
      sst.goals++;
      sst.shotsOnTarget++;
      sst.ratingDelta += POSITION_GROUP[shooter.slot.pos] === 'FW' ? 1.0 : 1.2;
      if (assister) {
        this.stat(assister).assists++;
        this.stat(assister).ratingDelta += 0.5;
      }
      if (gk.o) this.stat(gk.o).ratingDelta -= 0.3;
      for (const o of this.active(def)) if (this.group(o) === 'DF') this.stat(o).ratingDelta -= 0.12;
      this.addEvent('goal', att.side, 50, 99, { ...base, otherId: assister?.p.id });
      this.addTrack(att.side, 50, 99);
      this.advance(att.side, 0.6);
      return { side: def.side, phase: 'build' };
    }
    if (u < pGoal + pSave) {
      att.stats.shotsOnTarget++;
      sst.shotsOnTarget++;
      sst.ratingDelta += 0.1;
      def.stats.saves++;
      if (gk.o) {
        const g = this.stat(gk.o);
        g.saves++;
        g.ratingDelta += q >= 0.25 ? 0.45 : 0.22;
      }
      this.addEvent('save', att.side, x, 97, { ...base, otherId: gk.o?.p.id });
      if (this.rng.chance(0.3)) return { side: att.side, phase: 'corner' };
      return { side: def.side, phase: gk.o?.p.role === 'keeper_libero' && this.rng.chance(0.35) ? 'mid' : 'build' };
    }
    if (u < pGoal + pSave + pBlock) {
      this.addEvent('block', att.side, x, depth + 2, base);
      const blocker = this.pickPlayer(def, (o) => (this.group(o) === 'DF' ? 2 : 0.3));
      this.stat(blocker).ratingDelta += 0.15;
      if (this.rng.chance(0.45)) return { side: att.side, phase: 'corner' };
      return this.turnover(def, 'final');
    }
    sst.ratingDelta -= 0.05;
    this.addEvent('miss', att.side, x, 100, base);
    return { side: def.side, phase: 'build' };
  }

  private drainStamina(t: TeamState) {
    const T = SIM_TUNING;
    for (const o of this.active(t)) {
      let d = T.staminaDrainPerSegment * (1.25 - o.p.attributes.stamina / 200) * (DRAIN_POS[o.slot.pos] ?? 1);
      if (t.tactics.defense === 'high_press') d *= 1.22;
      if (t.tactics.pressIntensity === 'high') d *= 1.1;
      if (t.tactics.pressIntensity === 'low') d *= 0.92;
      if (t.tactics.tempo === 'fast') d *= 1.08;
      if (t.tactics.tempo === 'slow') d *= 0.95;
      if (o.p.traits.includes('engine')) d *= 0.75;
      o.stamina = Math.max(0, o.stamina - d);
    }
  }

  private lateTactics(t: TeamState) {
    const opp = this.teams[this.other(t.side)];
    const base = t.input.lineup.tactics;
    if (t.goals < opp.goals && base.whenLosing === 'attack' && t.lateChange !== 'attack') {
      t.tactics = { ...t.tactics, defense: 'high_press', defensiveLine: 'high', tempo: 'fast' };
      t.lateChange = 'attack';
      this.addEvent('tactic', t.side, 50, 50, { detail: 'attack' });
    } else if (t.goals > opp.goals && base.whenWinning === 'defend' && t.lateChange !== 'defend') {
      t.tactics = { ...t.tactics, defense: 'low_block', defensiveLine: 'deep', tempo: 'slow' };
      t.lateChange = 'defend';
      this.addEvent('tactic', t.side, 50, 50, { detail: 'defend' });
    }
  }

  /** automatic substitutions based on fatigue and game state (spec 6-5) */
  private substitutions(t: TeamState, threshold: number) {
    const opp = this.teams[this.other(t.side)];
    const chasing = t.goals < opp.goals && t.lateChange === 'attack' && this.minute >= 70;
    let tacticalDone = false;
    const candidates = this.active(t)
      .filter((o) => o.slot.pos !== 'GK')
      .sort((a, b) => a.stamina - b.stamina);
    for (const o of candidates) {
      if (t.subsUsed >= 3 || t.bench.length === 0) break;
      const tired = o.stamina < threshold;
      const tactical = chasing && !tacticalDone && this.group(o) !== 'FW';
      if (!tired && !tactical) continue;
      // choose the bench player who is best in this slot right now
      let bestIdx = -1;
      let bestVal = -Infinity;
      t.bench.forEach((p, i) => {
        if (p.primaryPosition === 'GK') return;
        let v = p.ovr * positionFamiliarity(p.positions, o.slot.pos);
        if (chasing && POSITION_GROUP[p.primaryPosition] === 'FW') v += 6;
        if (v > bestVal) {
          bestVal = v;
          bestIdx = i;
        }
      });
      if (bestIdx < 0) break;
      const incoming = t.bench[bestIdx];
      if (!tired && POSITION_GROUP[incoming.primaryPosition] !== 'FW') continue;
      if (tired && bestVal < o.p.ovr * o.fam * this.fatigue(o) * 0.9) continue;
      if (!tired) tacticalDone = true;
      t.bench.splice(bestIdx, 1);
      o.off = true;
      o.leftAt = this.minute;
      const newcomer: OnPitch = {
        p: incoming,
        slot: o.slot,
        fam: positionFamiliarity(incoming.positions, o.slot.pos),
        scale: ovrScale(incoming),
        stamina: 100,
        yellow: 0,
        off: false,
        enteredAt: this.minute,
        leftAt: null,
      };
      t.lineup[t.lineup.indexOf(o)] = newcomer;
      t.appeared.push(newcomer);
      t.subsUsed++;
      this.addEvent('sub', t.side, 50, 50, { playerId: incoming.id, otherId: o.p.id });
    }
  }

  private finish(): MatchResultData {
    const home = this.teams.home;
    const away = this.teams.away;
    const totalPoss = this.possessionTime.home + this.possessionTime.away || 1;
    home.stats.possession = Math.round((this.possessionTime.home / totalPoss) * 100);
    away.stats.possession = 100 - home.stats.possession;
    home.stats.xg = Math.round(home.stats.xg * 100) / 100;
    away.stats.xg = Math.round(away.stats.xg * 100) / 100;

    const players: PlayerMatchStats[] = [];
    for (const t of [home, away]) {
      const opp = t === home ? away : home;
      const won = t.goals > opp.goals;
      const cleanSheet = opp.goals === 0;
      for (const o of t.appeared) {
        const st = this.stat(o);
        const end = o.leftAt ?? 90;
        st.minutes = Math.max(0, Math.round(end - o.enteredAt));
        st.staminaEnd = Math.round(o.stamina);
        let rating = 6 + st.ratingDelta;
        if (won) rating += 0.3;
        if (cleanSheet && (this.group(o) === 'DF' || o.slot.pos === 'GK') && st.minutes >= 45) rating += 0.4;
        if (st.minutes < 20) rating = 6 + (rating - 6) * 0.6;
        st.rating = Math.round(clamp(rating, 3, 10) * 10) / 10;
        const { ratingDelta: _r, ...rest } = st;
        void _r;
        players.push(rest);
      }
    }
    const mvp = players
      .filter((p) => p.minutes > 0)
      .sort((a, b) => b.rating - a.rating || b.goals - a.goals || (a.side === (home.goals >= away.goals ? 'home' : 'away') ? -1 : 1))[0];

    return {
      seed: this.input.seed,
      simVersion: SIM_VERSION,
      score: { home: home.goals, away: away.goals },
      events: this.events,
      track: this.track,
      stats: { home: home.stats, away: away.stats },
      players,
      mvpId: mvp?.playerId ?? '',
      chemistry: {
        home: { score: home.chem.score, modifier: Math.round(home.chem.modifier * 1000) / 1000 },
        away: { score: away.chem.score, modifier: Math.round(away.chem.modifier * 1000) / 1000 },
      },
      tactics: { home: this.input.home.lineup.tactics, away: this.input.away.lineup.tactics },
      formations: { home: this.input.home.lineup.formation, away: this.input.away.lineup.formation },
      notes: { home: this.notes(home, away), away: this.notes(away, home) },
    };
  }

  private notes(t: TeamState, opp: TeamState): TacticNote[] {
    const n: TacticNote[] = [];
    const tac = t.input.lineup.tactics;
    if (tac.offense === 'possession') n.push({ key: 'possession', values: { possession: t.stats.possession } });
    if (tac.defense === 'high_press' || t.stats.pressWins > 0) n.push({ key: 'press_wins', values: { count: t.stats.pressWins } });
    if (tac.offense === 'counter' || t.stats.counters > 0) n.push({ key: 'counters', values: { count: t.stats.counters, shots: t.stats.counterShots } });
    if (tac.offense === 'long_ball' || t.stats.longBalls > 0) n.push({ key: 'long_balls', values: { won: t.stats.longBallsWon, total: t.stats.longBalls } });
    if (tac.defense === 'low_block') n.push({ key: 'low_block', values: { oppShots: opp.stats.shots, oppXg: Math.round(opp.stats.xg * 100) / 100 } });
    n.push({ key: 'chemistry', values: { score: t.chem.score } });
    if (t.subsUsed > 0) n.push({ key: 'subs', values: { count: t.subsUsed } });
    if (t.lateChange) n.push({ key: 'late_change', values: { mode: t.lateChange } });
    return n;
  }
}

export function simulateMatch(input: SimInput): MatchResultData {
  return new MatchSimulator(input).run();
}
