import {
  bell,
  boom,
  braam,
  choir,
  clap,
  crowd,
  duck,
  hat,
  kick,
  lead,
  n,
  pad,
  pluck,
  pulseBass,
  snare,
  stab,
  strings,
  sub808,
  sweep,
  tom,
  type Mix,
} from './synth';

/**
 * Background music (bass-heavy, chosen by the user): A for the menus, D for
 * matches and drafts, B for gacha / exchange / auction. Each track is one
 * seamless loop: `score` schedules every note of the loop from time t0. The
 * loops are rendered to audio files with `npm run sound:render -w @fd/web`
 * (apps/web/scripts/render-bgm.mjs) and looped by the game (player.ts).
 */
export interface Track {
  id: string;
  name: string;
  /** a few words for people choosing */
  style: string;
  bpm: number;
  bars: number;
  score: (m: Mix, t0: number) => void;
}

const chord = (names: string) => names.split(' ').map(n);

// ------------------------------------------------------------------ A: dark trap (halftime 808)
const trap: Track = {
  id: 'night-pressure',
  name: 'A. NIGHT PRESSURE',
  style: 'ダークなトラップ（140BPM・半分の速さ）。うなる808ベース、細かいハイハット、暗いベル',
  bpm: 140,
  bars: 32,
  score(m, t0) {
    const s16 = 60 / this.bpm / 4;
    const bar = s16 * 16;
    const prog = [
      { root: n('F1'), pad: chord('F3 Ab3 C4'), bell: ['C5', 'Ab4', 'F4', 'G4'] },
      { root: n('Db2'), pad: chord('Db3 F3 Ab3'), bell: ['Ab4', 'G4', 'Eb4', 'F4'] },
      { root: n('Bb1'), pad: chord('Bb2 Db3 F3'), bell: ['F4', 'Ab4', 'Db5', 'C5'] },
      { root: n('C2'), pad: chord('C3 E3 G3'), bell: ['E4', 'G4', 'Bb4', 'C5'] },
    ];
    for (let b = 0; b < this.bars; b++) {
      const t = t0 + b * bar;
      const p = prog[Math.floor(b / 2) % 4];
      const intro = b < 4;
      const brk = b >= 16 && b < 20;
      const full = !intro && !brk;
      if (b % 2 === 0) pad(m, t, p.pad, bar * 2, { gain: 0.05, cutoff: intro || brk ? 900 : 1500 });
      // the bell motif: two notes per bar, the higher octave in the second half
      const notes = p.bell.slice((b % 2) * 2, (b % 2) * 2 + 2);
      notes.forEach((nm, i) => bell(m, t + i * 8 * s16 + (i ? 2 * s16 : 0), n(nm) + (b >= 20 ? 12 : 0), { gain: b >= 20 ? 0.1 : 0.13, decay: 1.4 }));
      if (full) {
        // kick and 808 together (halftime: snare on beat 3)
        kick(m, t, { gain: 0.9, decay: 0.3 });
        sub808(m, t, p.root, s16 * 9.5);
        const second = b % 4 === 3 ? 6 : 10;
        kick(m, t + second * s16, { gain: 0.75, decay: 0.25 });
        sub808(m, t + second * s16, p.root + (b % 2 ? 12 : 7), s16 * (16 - second), { glideFrom: p.root });
        clap(m, t + 8 * s16, { gain: 0.55 });
        snare(m, t + 8 * s16, { gain: 0.35, rev: 0.15 });
        // hats: 8ths, with triplet rolls at the end of every 4th bar
        for (let i = 0; i < 16; i += 2) hat(m, t + i * s16, { gain: i % 4 ? 0.1 : 0.15 });
        if (b % 4 === 3) for (let k = 0; k < 6; k++) hat(m, t + 12 * s16 + (k * 4 * s16) / 6, { gain: 0.08 + k * 0.01 });
        if (b % 8 === 7) hat(m, t + 14 * s16, { open: true, gain: 0.12 });
      } else if (intro && b >= 2) {
        for (let i = 0; i < 16; i += 2) hat(m, t + i * s16, { gain: 0.06, tone: 9500 });
      } else if (brk) {
        // the break: long 808 notes swell under the pad
        if (b % 2 === 0) sub808(m, t, p.root, bar * 2 - s16, { gain: 0.6 });
        if (b === 19) sweep(m, t, bar, { gain: 0.18 });
      }
    }
  },
};

// ------------------------------------------------------------------ B: synthwave / electro drive
const synthwave: Track = {
  id: 'neon-drive',
  name: 'B. NEON DRIVE',
  style: 'シンセウェーブ（120BPM・4つ打ち）。うねる8分のベース、きらめくアルペジオ、メロディ',
  bpm: 120,
  bars: 32,
  score(m, t0) {
    const s16 = 60 / this.bpm / 4;
    const bar = s16 * 16;
    const prog = [
      { root: n('A1'), ch: chord('A3 C4 E4'), arp: chord('A4 C5 E5 A5') },
      { root: n('F1'), ch: chord('F3 A3 C4'), arp: chord('F4 A4 C5 F5') },
      { root: n('C2'), ch: chord('C4 E4 G4'), arp: chord('C5 E5 G5 C6') },
      { root: n('G1'), ch: chord('G3 B3 D4'), arp: chord('G4 B4 D5 G5') },
    ];
    const hook = ['E5', 'D5', 'C5', 'B4', 'C5', 'A4', 'G4', 'A4'];
    for (let b = 0; b < this.bars; b++) {
      const t = t0 + b * bar;
      const p = prog[b % 4];
      const intro = b < 4;
      const brk = b >= 24 && b < 28;
      const drums = !brk && b >= 2;
      pad(m, t, p.ch, bar, { gain: 0.045, cutoff: intro ? 800 : 2200, attack: 0.3 });
      // arpeggio: 16ths up the chord
      for (let i = 0; i < 16; i++) pluck(m, t + i * s16, p.arp[i % 4] + (i >= 8 && !intro ? 12 : 0), { gain: intro ? 0.05 : 0.07, decay: 0.18, cutoff: intro ? 1500 : 4000 });
      if (drums) {
        for (let q = 0; q < 4; q++) {
          kick(m, t + q * 4 * s16, { gain: 0.85, decay: 0.32, from: 140, to: 50 });
          duck(m, t + q * 4 * s16, 0.55, 0.22);
          hat(m, t + (q * 4 + 2) * s16, { open: true, gain: 0.09 });
        }
        clap(m, t + 4 * s16, { gain: 0.45 });
        clap(m, t + 12 * s16, { gain: 0.45 });
        for (let i = 0; i < 16; i++) if (i % 2) hat(m, t + i * s16, { gain: 0.05 });
      }
      if (!intro && !brk) {
        // the pumping bass: octave 8ths
        for (let i = 0; i < 8; i++) pulseBass(m, t + i * 2 * s16, p.root + (i % 2 ? 12 : 0), s16 * 1.8, { gain: 0.34 });
        stab(m, t + 14 * s16, p.ch.map((x) => x + 12), { gain: 0.04 });
      }
      if (b >= 16 && b < 24) {
        // the hook, 2 notes per bar
        const i0 = (b % 4) * 2;
        lead(m, t, n(hook[i0]), bar * 0.45, { gain: 0.07 });
        lead(m, t + bar / 2, n(hook[i0 + 1]), bar * 0.45, { gain: 0.07, from: n(hook[i0]) });
      }
      if (brk && b === 27) sweep(m, t, bar, { gain: 0.2 });
      if (b >= 28) {
        const i0 = (b % 4) * 2;
        lead(m, t, n(hook[i0]) + 12, bar * 0.45, { gain: 0.05 });
      }
    }
  },
};

// ------------------------------------------------------------------ D: stadium epic (cinematic)
const epic: Track = {
  id: 'stadium-legend',
  name: 'D. STADIUM LEGEND',
  style: 'スタジアムの壮大な曲（100BPM）。重低音の太鼓とブーム、刻む弦、ブラス、合唱、手拍子',
  bpm: 100,
  bars: 24,
  score(m, t0) {
    const s16 = 60 / this.bpm / 4;
    const bar = s16 * 16;
    const prog = [
      { root: n('C2'), ch: chord('C3 G3 C4 Eb4'), ost: ['C4', 'Eb4', 'G4', 'Eb4'] },
      { root: n('Ab1'), ch: chord('Ab2 Eb3 Ab3 C4'), ost: ['C4', 'Eb4', 'Ab4', 'Eb4'] },
      { root: n('Eb2'), ch: chord('Eb3 Bb3 Eb4 G4'), ost: ['Bb3', 'Eb4', 'G4', 'Eb4'] },
      { root: n('Bb1'), ch: chord('Bb2 F3 Bb3 D4'), ost: ['Bb3', 'D4', 'F4', 'D4'] },
    ];
    for (let b = 0; b < this.bars; b++) {
      const t = t0 + b * bar;
      const p = prog[b % 4];
      const intro = b < 4;
      const big = b >= 12 && b < 20;
      choir(m, t, p.ch.slice(1).map((x) => x + 12), bar, { gain: intro ? 0.06 : 0.05 });
      if (b % 2 === 0) boom(m, t, { gain: intro ? 0.6 : 0.8, dur: 2 });
      if (!intro) {
        // the string ostinato: 8ths
        for (let i = 0; i < 8; i++) strings(m, t + i * 2 * s16, n(p.ost[i % 4]) + (big ? 12 : 0), s16 * 1.6, { gain: 0.05 });
        // drums: a big hit on 1, toms on the 8ths
        tom(m, t, { hz: 62, gain: 1, decay: 0.9 });
        for (const i of [6, 10, 12, 14]) tom(m, t + i * s16, { hz: i === 12 ? 90 : 75, gain: 0.55, decay: 0.4, rev: 0.3 });
        sub808(m, t, p.root, bar * 0.9, { gain: 0.45, drive: 2 });
      }
      if (big) {
        if (b % 4 === 0) braam(m, t, p.ch.slice(0, 3), bar * 2, { gain: 0.13 });
        clap(m, t + 4 * s16, { gain: 0.5, rev: 0.5 });
        clap(m, t + 12 * s16, { gain: 0.5, rev: 0.5 });
        if (b % 4 === 3) crowd(m, t, bar, { gain: 0.1 });
      }
      if (b >= 20) {
        // the build back to the top: rising toms
        for (let i = 0; i < 16; i += b === 23 ? 1 : 2) tom(m, t + i * s16, { hz: 70 + i * 3 + (b - 20) * 8, gain: 0.35 + i * 0.02, decay: 0.3, rev: 0.2 });
        if (b === 23) sweep(m, t, bar, { gain: 0.22 });
      }
    }
  },
};

export const TRACKS: Track[] = [trap, synthwave, epic];

/** the user's choice: which track plays where */
export type Scene = 'menu' | 'match' | 'gacha';
export const SCENE_TRACK: Record<Scene, string> = { menu: 'night-pressure', match: 'stadium-legend', gacha: 'neon-drive' };

/** seconds of one loop */
export const loopSeconds = (tr: Track) => (60 / tr.bpm) * 4 * tr.bars;
