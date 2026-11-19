import {
  bell,
  boom,
  braam,
  choir,
  clap,
  cowbell,
  crowd,
  duck,
  growl,
  hardKick,
  hat,
  kick,
  lead,
  n,
  pad,
  pluck,
  pulseBass,
  riseChord,
  snare,
  stab,
  strings,
  sub808,
  superLead,
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
      // the build back into the drop: a rising chord (tonal, no noise hiss on the gacha screens)
      if (brk && b === 27) riseChord(m, t, p.ch, bar, { gain: 0.07 });
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

// ------------------------------------------------------------------ uptempo match music: candidates (decision 115)

type Note = [step: number, len: number, name: string];
/** a melody: one list of notes (16th steps) per bar */
const melody = (bars: Note[][]) => bars.map((b) => b.map(([s, l, nm]) => ({ s, l, m: n(nm) })));

/** the build into a drop: snares getting denser and louder, and a rising chord (no noise riser) */
function build(m: Mix, t: number, s16: number, ch: number[]) {
  for (let i = 0; i < 16; i += i < 8 ? 2 : 1) snare(m, t + i * s16, { gain: 0.18 + i * 0.025, rev: 0.2, decay: 0.12 });
  riseChord(m, t, ch, s16 * 16, { gain: 0.06 });
}

// E: drum & bass
const dnb: Track = {
  id: 'red-zone',
  name: 'E. RED ZONE',
  style: 'ドラムンベース（174BPM）。速く刻むブレイクビート、うなるベース、攻めるリード',
  bpm: 174,
  bars: 32,
  score(m, t0) {
    const s16 = 60 / this.bpm / 4;
    const bar = s16 * 16;
    const prog = [
      { root: n('G1'), ch: chord('G3 Bb3 D4') },
      { root: n('Eb1'), ch: chord('Eb3 G3 Bb3') },
      { root: n('Bb1'), ch: chord('Bb3 D4 F4') },
      { root: n('F1'), ch: chord('F3 A3 C4') },
    ];
    const tune = melody([
      [[0, 3, 'D5'], [3, 3, 'Bb4'], [6, 2, 'C5'], [8, 6, 'D5'], [14, 2, 'F5']],
      [[0, 6, 'G5'], [6, 2, 'F5'], [8, 8, 'D5']],
      [[0, 3, 'Eb5'], [3, 3, 'D5'], [6, 2, 'C5'], [8, 6, 'Bb4'], [14, 2, 'C5']],
      [[0, 6, 'G5'], [6, 2, 'F5'], [8, 8, 'Eb5']],
      [[0, 3, 'D5'], [3, 3, 'F5'], [6, 2, 'Bb5'], [8, 6, 'A5'], [14, 2, 'F5']],
      [[0, 6, 'D5'], [6, 2, 'C5'], [8, 8, 'Bb4']],
      [[0, 3, 'C5'], [3, 3, 'A4'], [6, 2, 'C5'], [8, 6, 'F5'], [14, 2, 'Eb5']],
      [[0, 6, 'D5'], [6, 2, 'C5'], [8, 8, 'A4']],
    ]);
    for (let b = 0; b < this.bars; b++) {
      const t = t0 + b * bar;
      const p = prog[Math.floor(b / 2) % 4];
      const intro = b < 2;
      const brk = b === 16 || b === 17;
      const rise = b === 18 || b === 19;
      const drop2 = b >= 20;
      const full = !intro && !brk && !rise;
      if (b % 2 === 0 && (intro || brk || rise)) pad(m, t, p.ch, bar * 2, { gain: 0.05, cutoff: 1800, attack: 0.2 });
      // drums: the two-step break (kick 1 and the "and" of 3, snare 2 and 4) with ghost notes
      if (!brk) {
        kick(m, t, { gain: 0.85, decay: 0.26, from: 170, to: 52, drive: 2.6 });
        kick(m, t + 10 * s16, { gain: 0.78, decay: 0.24, from: 170, to: 52, drive: 2.6 });
        if (b % 4 === 3) kick(m, t + 7 * s16, { gain: 0.6, decay: 0.2 });
      }
      if (full || rise) {
        if (!rise || b === 18) {
          snare(m, t + 4 * s16, { gain: 0.95, tone: 210, rev: 0.15, decay: 0.16 });
          snare(m, t + 12 * s16, { gain: 0.95, tone: 210, rev: 0.15, decay: 0.16 });
          snare(m, t + 7 * s16, { gain: 0.12, decay: 0.07, rev: 0 });
          snare(m, t + 15 * s16, { gain: 0.1, decay: 0.07, rev: 0 });
        }
      }
      if (!brk) for (let i = 0; i < 16; i += full && b % 2 ? 1 : 2) hat(m, t + i * s16, { gain: i % 4 === 2 ? 0.1 : 0.06 });
      if (full && b % 4 === 1) hat(m, t + 14 * s16, { open: true, gain: 0.08 });
      // the growling bass
      if (!brk && !rise) {
        const cut = intro ? 320 : drop2 ? 1200 : 950;
        growl(m, t, p.root, 6 * s16, { gain: 0.34, cutoff: cut, drive: 3.4, sub: 0.55 });
        growl(m, t + 6 * s16, p.root + 12, 4 * s16, { gain: 0.3, cutoff: cut, glideFrom: p.root, drive: 3.4, sub: 0.55 });
        growl(m, t + 10 * s16, p.root, 6 * s16, { gain: 0.34, cutoff: cut, wobble: (174 / 60) * 2, drive: 3.4, sub: 0.55 });
      }
      if (rise && b === 18) growl(m, t, p.root, bar * 2, { gain: 0.26, cutoff: 400, wobble: 174 / 60, depth: 0.8 });
      if (full) stab(m, t + 2 * s16, p.ch.map((x) => x + 12), { gain: 0.06, decay: 0.18 });
      if (b === 1 || b === 19) build(m, t, s16, p.ch);
      // the melody: plucked in the break, the lead in the second drop
      const mel = tune[b % 8];
      if (brk) for (const x of mel) bell(m, t + x.s * s16, x.m, { gain: 0.15, decay: 0.9 });
      if (drop2) for (const x of mel) lead(m, t + x.s * s16, x.m, x.l * s16 * 0.95, { gain: 0.095, cutoff: 3800 });
    }
  },
};

// F: phonk
const phonk: Track = {
  id: 'nitro-rush',
  name: 'F. NITRO RUSH',
  style: 'フォンク（150BPM）。音程のあるカウベルのリフ、歪んだ808、硬いキックと手拍子',
  bpm: 150,
  bars: 24,
  score(m, t0) {
    const s16 = 60 / this.bpm / 4;
    const bar = s16 * 16;
    const prog = [
      { root: n('F#1'), ch: chord('F#3 A3 C#4') },
      { root: n('D2'), ch: chord('D3 F#3 A3') },
      { root: n('B1'), ch: chord('B2 D3 F#3') },
      { root: n('C#2'), ch: chord('C#3 F3 G#3') },
    ];
    const riff = melody([
      [[0, 2, 'F#5'], [3, 2, 'F#5'], [6, 2, 'A5'], [8, 2, 'F#5'], [10, 2, 'C#6'], [12, 2, 'B5'], [14, 2, 'A5']],
      [[0, 2, 'F#5'], [3, 2, 'F#5'], [6, 2, 'A5'], [8, 2, 'E5'], [10, 2, 'F#5'], [13, 2, 'C#5'], [14, 2, 'E5']],
    ]);
    for (let b = 0; b < this.bars; b++) {
      const t = t0 + b * bar;
      const p = prog[Math.floor(b / 2) % 4];
      const intro = b < 2;
      const brk = b === 12 || b === 13;
      const drop2 = b >= 14;
      const full = !intro && !brk;
      // the cowbell riff (an octave higher doubles it in the second drop)
      for (const x of riff[b % 2]) {
        cowbell(m, t + x.s * s16, x.m, { gain: intro ? 0.2 : 0.3, decay: 0.3 });
        if (drop2 && b % 4 >= 2) cowbell(m, t + x.s * s16, x.m + 12, { gain: 0.11, decay: 0.2 });
      }
      if (b % 2 === 0) pad(m, t, p.ch, bar * 2, { gain: 0.035, cutoff: 900, attack: 0.3 });
      if (full) {
        // kick + distorted 808 together
        for (const [s, l, up, gl] of [
          [0, 3, 0, 0],
          [3, 3, 0, 0],
          [6, 4, 12, 1],
          [10, 2, 0, 0],
          [12, 4, b % 2 ? 7 : 0, 0],
        ] as const) {
          if (s !== 3 || b % 2) kick(m, t + s * s16, { gain: s === 0 ? 0.95 : 0.8, decay: 0.24, from: 180, to: 50, drive: 3 });
          sub808(m, t + s * s16, p.root + up, l * s16, { gain: 0.55, drive: 7, glideFrom: gl ? p.root : undefined });
        }
        clap(m, t + 4 * s16, { gain: 1.1, rev: 0.2 });
        clap(m, t + 12 * s16, { gain: 1.1, rev: 0.2 });
        snare(m, t + 12 * s16, { gain: 0.5, rev: 0.1 });
        // hats: 8ths, with triplet rolls at the end of every other bar
        for (let i = 0; i < 16; i += 2) hat(m, t + i * s16, { gain: i % 4 ? 0.08 : 0.11 });
        if (b % 2) for (let k = 0; k < 6; k++) hat(m, t + 12 * s16 + (k * 4 * s16) / 6, { gain: 0.06 + k * 0.01 });
      } else if (brk) {
        if (b === 12) sub808(m, t, p.root, bar * 2 - s16, { gain: 0.45, drive: 5 });
        if (b === 13) build(m, t, s16, p.ch);
      } else if (b === 1) {
        kick(m, t + 12 * s16, { gain: 0.8, decay: 0.2 });
        kick(m, t + 14 * s16, { gain: 0.8, decay: 0.2 });
      }
      if (drop2 && b % 2 === 0) bell(m, t, p.ch[0] + 24, { gain: 0.12, decay: 1.6 });
    }
  },
};

// G: hardstyle
const hardstyle: Track = {
  id: 'limit-break',
  name: 'G. LIMIT BREAK',
  style: 'ハードスタイル（155BPM）。歪んだ強烈なキック（音程のある尾）、叫ぶようなスーパーソウのリード',
  bpm: 155,
  bars: 32,
  score(m, t0) {
    const s16 = 60 / this.bpm / 4;
    const bar = s16 * 16;
    const prog = [
      { root: n('A1'), ch: chord('A3 C4 E4') },
      { root: n('F1'), ch: chord('F3 A3 C4') },
      { root: n('C2'), ch: chord('C4 E4 G4') },
      { root: n('G1'), ch: chord('G3 B3 D4') },
    ];
    const tune = melody([
      [[0, 4, 'E5'], [4, 4, 'A5'], [8, 2, 'G5'], [10, 2, 'E5'], [12, 4, 'D5']],
      [[0, 6, 'E5'], [6, 2, 'C5'], [8, 4, 'D5'], [12, 4, 'E5']],
      [[0, 4, 'F5'], [4, 4, 'A5'], [8, 2, 'G5'], [10, 2, 'F5'], [12, 4, 'E5']],
      [[0, 6, 'C5'], [6, 2, 'D5'], [8, 8, 'E5']],
      [[0, 4, 'G5'], [4, 4, 'E5'], [8, 2, 'C5'], [10, 2, 'D5'], [12, 4, 'E5']],
      [[0, 6, 'G5'], [6, 2, 'A5'], [8, 4, 'G5'], [12, 4, 'E5']],
      [[0, 4, 'D5'], [4, 4, 'G5'], [8, 2, 'B4'], [10, 2, 'D5'], [12, 4, 'G5']],
      [[0, 6, 'B5'], [6, 2, 'A5'], [8, 4, 'G5'], [12, 4, 'D5']],
    ]);
    for (let b = 0; b < this.bars; b++) {
      const t = t0 + b * bar;
      const p = prog[Math.floor(b / 2) % 4];
      const intro = b < 2;
      const brk = b === 14 || b === 15;
      const rise = b === 16 || b === 17;
      const drop2 = b >= 18;
      const kicks = !brk;
      if (kicks) {
        // the hard kick on every beat, its tail on the chord's root (a kick roll in the build)
        const step = rise && b === 17 ? 2 : 4;
        for (let i = 0; i < 16; i += step) hardKick(m, t + i * s16, p.root + (rise ? Math.floor(i / 4) : 0), { gain: rise ? 0.6 + i * 0.02 : 0.9, tail: step === 2 ? 0.18 : 0.36 });
      }
      if (!brk && !rise) {
        for (let q = 0; q < 4; q++) hat(m, t + (q * 4 + 2) * s16, { gain: 0.1, open: q % 2 === 1 });
        if (!intro) {
          clap(m, t + 4 * s16, { gain: 0.75, rev: 0.3 });
          clap(m, t + 12 * s16, { gain: 0.75, rev: 0.3 });
          // offbeat supersaw stabs
          for (let q = 0; q < 4; q++) stab(m, t + (q * 4 + 2) * s16, p.ch.map((x) => x + 12), { gain: drop2 ? 0.06 : 0.045, decay: 0.16, cutoff: 5000 });
        }
      }
      if (brk || rise) {
        if (b % 2 === 0) pad(m, t, p.ch, bar * 2, { gain: 0.05, cutoff: 2600, attack: 0.15 });
        if (b % 2 === 0) choir(m, t, p.ch.map((x) => x + 12), bar * 2, { gain: 0.05 });
      }
      if (b === 17) riseChord(m, t, p.ch, bar, { gain: 0.07 });
      if (b === 16) for (let i = 0; i < 16; i += 2) snare(m, t + i * s16, { gain: 0.15 + i * 0.015, rev: 0.2, decay: 0.12 });
      if (b === 17) for (let i = 0; i < 16; i++) snare(m, t + i * s16, { gain: 0.25 + i * 0.02, rev: 0.2, decay: 0.1 });
      // the lead: softer in the break, screaming in the second drop
      const mel = tune[b % 8];
      if (brk || rise) for (const x of mel) superLead(m, t + x.s * s16, x.m, x.l * s16 * 0.9, { gain: 0.05, cutoff: 3000 });
      if (drop2) for (const x of mel) superLead(m, t + x.s * s16, x.m, x.l * s16 * 0.9, { gain: 0.075, cutoff: 6000 });
      if (b >= 4 && b < 14 && b % 2 === 0) bell(m, t, p.ch[2] + 12, { gain: 0.05, decay: 1.2 });
    }
  },
};

/** candidates for the match music (the user chooses one; not used in the game yet) */
export const MATCH_CANDIDATES: Track[] = [dnb, phonk, hardstyle];

export const TRACKS: Track[] = [trap, synthwave, epic];

/** the user's choice: which track plays where */
export type Scene = 'menu' | 'match' | 'gacha';
export const SCENE_TRACK: Record<Scene, string> = { menu: 'night-pressure', match: 'stadium-legend', gacha: 'neon-drive' };

/** seconds of one loop */
export const loopSeconds = (tr: Track) => (60 / tr.bpm) * 4 * tr.bars;
