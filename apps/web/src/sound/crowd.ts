import { midiHz, shaper } from './synth';

/**
 * Stadium crowd voices made only of voiced sounds (no noise; decision 114).
 *
 * Every voice is a tone with the harmonics of a human voice, shaped by the
 * formants of a vowel ("ワー" = u -> a, "オー" = o), with its own pitch,
 * vibrato, timing and loudness. Many of them together are heard as a crowd.
 * The bus keeps everything below about 3 kHz, so a crowd is heard as
 * "ワー / オー" and never as the hiss ("ザー") of filtered noise.
 * Works on an AudioContext and on an OfflineAudioContext (rendered once).
 */

export type Vowel = 'a' | 'i' | 'u' | 'e' | 'o';

/** formant frequencies (adult male; female voices are scaled up) */
const FORMANTS: Record<Vowel, readonly [number, number, number]> = {
  a: [760, 1220, 2500],
  i: [310, 2150, 2850],
  u: [340, 1200, 2300],
  e: [480, 1820, 2500],
  o: [500, 860, 2450],
};
const FQ = [6, 9, 12] as const;
const FGAIN = [1, 0.62, 0.3] as const;

/** a seeded random source: the same seed gives the same crowd */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CrowdBus {
  ctx: BaseAudioContext;
  /** dry input (low-passed, no rumble) */
  input: GainNode;
  /** send to the far, wide stadium reverb */
  rev: GainNode;
}

/** the bus every crowd voice goes into */
export function crowdBus(ctx: BaseAudioContext, out: AudioNode, o: { cutoff?: number; reverbSeconds?: number; wet?: number; seed?: number } = {}): CrowdBus {
  const { cutoff = 3000, reverbSeconds = 2.6, wet = 0.6, seed = 77 } = o;
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 90;
  const lp1 = ctx.createBiquadFilter();
  lp1.type = 'lowpass';
  lp1.frequency.value = cutoff;
  lp1.Q.value = 0.6;
  const lp2 = ctx.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = cutoff * 1.3;
  lp2.Q.value = 0.6;
  input.connect(hp).connect(lp1).connect(lp2).connect(out);
  // the stadium: a short pre-delay and a long, dark tail
  const len = Math.floor(ctx.sampleRate * reverbSeconds);
  const pre = Math.floor(ctx.sampleRate * 0.03);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  const r = rng(seed);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = pre; i < len; i++) d[i] = (r() * 2 - 1) * (1 - (i - pre) / (len - pre)) ** 2.6;
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const rev = ctx.createGain();
  rev.gain.value = wet;
  const dark = ctx.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = cutoff * 0.75;
  rev.connect(conv).connect(dark).connect(out);
  return { ctx, input, rev };
}

const waves = new WeakMap<BaseAudioContext, PeriodicWave>();
/** the harmonics of a voice (falling about 7.5 dB per octave) */
function voiceWave(ctx: BaseAudioContext): PeriodicWave {
  let w = waves.get(ctx);
  if (!w) {
    const N = 48;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let k = 1; k < N; k++) imag[k] = 1 / k ** 1.25;
    w = ctx.createPeriodicWave(real, imag);
    waves.set(ctx, w);
  }
  return w;
}

interface Voice {
  freq: AudioParam;
  env: AudioParam;
  vowel(v: Vowel, t: number, glide?: number): void;
}

function voice(b: CrowdBus, o: { hz: number; scale: number; pan: number; level: number; wet: number; start: number; stop: number; vibRate: number; vibDepth: number; vowel: Vowel }): Voice {
  const { ctx } = b;
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(voiceWave(ctx));
  osc.frequency.setValueAtTime(o.hz, o.start);
  const vib = ctx.createOscillator();
  vib.frequency.value = o.vibRate;
  const vg = ctx.createGain();
  vg.gain.value = o.vibDepth;
  vib.connect(vg).connect(osc.detune);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, o.start);
  const filters = FORMANTS[o.vowel].map((f, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = FQ[i];
    bp.frequency.setValueAtTime(f * o.scale, o.start);
    const g = ctx.createGain();
    g.gain.value = FGAIN[i];
    osc.connect(bp).connect(g).connect(env);
    return bp;
  });
  const lvl = ctx.createGain();
  lvl.gain.value = o.level;
  const pan = ctx.createStereoPanner();
  pan.pan.value = o.pan;
  env.connect(lvl).connect(pan).connect(b.input);
  if (o.wet > 0) {
    const s = ctx.createGain();
    s.gain.value = o.wet;
    pan.connect(s).connect(b.rev);
  }
  osc.start(o.start);
  osc.stop(o.stop);
  vib.start(o.start);
  vib.stop(o.stop);
  return {
    freq: osc.frequency,
    env: env.gain,
    vowel(v, t, glide = 0.03) {
      filters.forEach((f, i) => f.frequency.setTargetAtTime(FORMANTS[v][i] * o.scale, t, glide));
    },
  };
}

/** a random member of the crowd: mostly men, some women */
function person(r: () => number, femaleShare: number) {
  const female = r() < femaleShare;
  return {
    hz: female ? 185 + r() * 110 : 92 + r() * 70,
    scale: female ? 1.16 : 1,
    pan: (r() * 2 - 1) * 0.85,
    vibRate: 4.2 + r() * 2.6,
    vibDepth: 12 + r() * 30,
  };
}

const semis = (s: number) => 2 ** (s / 12);

export interface ShoutOpts {
  voices?: number;
  dur?: number;
  gain?: number;
  seed?: number;
  /** seconds over which the voices come in */
  spread?: number;
  /** vowel paths a voice picks from, e.g. [['u', 'a']] = "ワー" */
  vowels?: Vowel[][];
  /** semitones the pitch rises into the shout */
  rise?: number;
  /** semitones the pitch climbs during the whole shout (an "オォォ" rising) */
  climb?: number;
  female?: number;
  wet?: number;
  /** how many separate shouts a voice makes in `dur` (1 = one long one) */
  repeats?: number;
}

/** a crowd shout: "ワーッ" (goal), "オォォ" (the ball in the air), "おぉ" (a nice card) */
export function shout(b: CrowdBus, t: number, o: ShoutOpts = {}) {
  const { voices = 36, dur = 2.5, gain = 0.5, seed = 1, spread = 0.25, vowels = [['u', 'a']], rise = 4, climb = 0, female = 0.3, wet = 0.5, repeats = 1 } = o;
  const r = rng(seed);
  for (let i = 0; i < voices; i++) {
    const p = person(r, female);
    const start = t + r() * spread;
    const end = t + dur * (0.75 + r() * 0.25);
    const v = voice(b, { ...p, level: gain * (0.45 + r() * 0.55), wet, start, stop: end + 1, vowel: vowels[0][0] });
    // one long shout or a few in a row ("ワーッ！ワーッ！")
    const n = repeats > 1 ? 1 + Math.floor(r() * repeats) : 1;
    let s = start;
    for (let k = 0; k < n && s < end - 0.2; k++) {
      const len = k === n - 1 ? end - s : Math.min(end - s, 0.45 + r() * 0.7);
      const path = vowels[Math.floor(r() * vowels.length)];
      const base = p.hz * semis((r() - 0.5) * 2);
      v.vowel(path[0], s, 0.01);
      if (path[1]) v.vowel(path[1], s + 0.05 + r() * 0.1, 0.04);
      v.freq.setValueAtTime(base * semis(-rise * (0.5 + r() * 0.5)), s);
      v.freq.exponentialRampToValueAtTime(base, s + 0.1 + r() * 0.18);
      if (climb) v.freq.exponentialRampToValueAtTime(base * semis(climb * (0.7 + r() * 0.5)), s + len * 0.92);
      else v.freq.exponentialRampToValueAtTime(base * semis(-(0.5 + r() * 2.5)), s + len);
      const peak = k === 0 ? 1 : 0.6 + r() * 0.4;
      v.env.setValueAtTime(0, s);
      v.env.linearRampToValueAtTime(peak, s + 0.04 + r() * 0.16);
      if (climb) v.env.linearRampToValueAtTime(peak, s + len * 0.9);
      else v.env.setTargetAtTime(peak * (0.55 + r() * 0.3), s + 0.3, 0.5);
      v.env.setTargetAtTime(0, s + len - 0.12, k === n - 1 ? 0.25 : 0.05);
      s += len + 0.08 + r() * 0.2;
    }
  }
}

/** finger whistles in the crowd (tonal) */
export function whistles(b: CrowdBus, t: number, dur: number, o: { count?: number; gain?: number; seed?: number } = {}) {
  const { count = 4, gain = 0.05, seed = 5 } = o;
  const r = rng(seed);
  const { ctx } = b;
  for (let i = 0; i < count; i++) {
    const s = t + r() * dur * 0.8;
    const len = 0.35 + r() * 0.9;
    const hz = 1500 + r() * 900;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz * 0.8, s);
    osc.frequency.exponentialRampToValueAtTime(hz, s + 0.08);
    // a long whistle falls at its end, a short one rises ("ピューイ")
    osc.frequency.setValueAtTime(hz, s + len * 0.7);
    osc.frequency.exponentialRampToValueAtTime(hz * (r() < 0.5 ? 0.82 : 1.12), s + len);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6 + r() * 3;
    const vg = ctx.createGain();
    vg.gain.value = 18;
    vib.connect(vg).connect(osc.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(gain * (0.5 + r() * 0.5), s + 0.03);
    g.gain.setTargetAtTime(0, s + len, 0.03);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (r() * 2 - 1) * 0.9;
    osc.connect(g).connect(pan).connect(b.input);
    const sg = ctx.createGain();
    sg.gain.value = 0.7;
    pan.connect(sg).connect(b.rev);
    osc.start(s);
    vib.start(s);
    osc.stop(s + len + 0.3);
    vib.stop(s + len + 0.3);
  }
}

/** the crowd talking ("ざわざわ"): many voices saying short syllables, far away */
export function murmur(b: CrowdBus, t: number, dur: number, o: { voices?: number; gain?: number; seed?: number; female?: number; wet?: number; excite?: number } = {}) {
  const { voices = 26, gain = 0.3, seed = 11, female = 0.4, wet = 0.8, excite = 0 } = o;
  const r = rng(seed);
  const all: Vowel[] = ['a', 'i', 'u', 'e', 'o', 'a', 'o'];
  for (let i = 0; i < voices; i++) {
    const p = person(r, female);
    const base = p.hz * semis(excite * 3);
    const v = voice(b, { ...p, hz: base, level: gain * (0.4 + r() * 0.6), wet, start: t, stop: t + dur + 0.5, vibDepth: p.vibDepth * 0.4, vowel: 'a' });
    let x = t + r() * 1.2;
    while (x < t + dur - 0.3) {
      // a phrase of syllables, then a pause
      const phraseEnd = Math.min(t + dur - 0.3, x + 0.6 + r() * 1.8);
      let pitch = base * semis((r() - 0.5) * 3);
      while (x < phraseEnd) {
        const syl = 0.08 + r() * 0.15;
        v.vowel(all[Math.floor(r() * all.length)], x, 0.018);
        pitch *= semis((r() - 0.55) * 2.2);
        pitch = Math.min(base * 1.5, Math.max(base * 0.75, pitch));
        v.freq.setTargetAtTime(pitch, x, 0.04);
        v.env.setTargetAtTime(0.35 + r() * 0.65 + excite * 0.3, x, 0.012);
        v.env.setTargetAtTime(0.04, x + syl * 0.7, 0.025);
        x += syl + (r() < 0.2 ? 0.05 + r() * 0.12 : 0.012);
      }
      v.freq.setTargetAtTime(pitch * semis(-2), x - 0.1, 0.08);
      v.env.setTargetAtTime(0, x, 0.04);
      x += 0.25 + r() * 1.3 * (1 - excite * 0.6);
    }
    v.env.setTargetAtTime(0, t + dur - 0.2, 0.05);
  }
}

export interface ChantNote {
  beat: number;
  len: number;
  midi: number;
  vowel: Vowel;
}

/** the crowd singing a chant together (a little out of time and tune, like a real crowd) */
export function chant(b: CrowdBus, t: number, notes: ChantNote[], bpm: number, o: { voices?: number; gain?: number; seed?: number; female?: number; wet?: number; end?: number } = {}) {
  const { voices = 40, gain = 0.45, seed = 21, female = 0.3, wet = 0.6 } = o;
  const spb = 60 / bpm;
  const last = notes.reduce((m, nn) => Math.max(m, nn.beat + nn.len), 0);
  const end = o.end ?? t + last * spb;
  const r = rng(seed);
  for (let i = 0; i < voices; i++) {
    const p = person(r, female);
    const isFemale = p.scale > 1;
    const tune = (r() - 0.5) * 50; // cents, this singer's own pitch
    const late = (r() - 0.3) * 0.06; // seconds, this singer's own timing
    const level = gain * (0.45 + r() * 0.55);
    const v = voice(b, { ...p, hz: 200, level, wet, start: t, stop: end + 0.6, vibDepth: p.vibDepth * 0.6, vowel: notes[0]?.vowel ?? 'o' });
    for (let k = 0; k < notes.length; k++) {
      const nn = notes[k];
      // (never before the start: a loop rendered from time 0)
      const at = Math.max(t + 0.04, t + nn.beat * spb + late + (r() - 0.5) * 0.03);
      if (at >= end) break;
      const next = notes[k + 1];
      const hz = midiHz(nn.midi - (isFemale ? 0 : 12)) * 2 ** ((tune + (r() - 0.5) * 16) / 1200);
      v.freq.setTargetAtTime(hz, at, 0.022);
      v.vowel(nn.vowel, at, 0.025);
      // each note is sung anew: a short dip, a push, then it settles
      v.env.setTargetAtTime(0.25, at - 0.035, 0.008);
      v.env.setTargetAtTime(1, at, 0.02);
      v.env.setTargetAtTime(0.78, at + 0.12, 0.12);
      const gap = next ? next.beat - (nn.beat + nn.len) : 1;
      if (gap > 0.01 || !next) v.env.setTargetAtTime(0, Math.min(end, at + nn.len * spb * 0.92), 0.04);
    }
    v.env.setTargetAtTime(0, end, 0.06);
  }
}

/** a big drum in the stands (tonal: a falling sine, driven a little; no noise) */
export function standDrum(b: CrowdBus, out: AudioNode, t: number, o: { hz?: number; gain?: number; decay?: number } = {}) {
  const { hz = 64, gain = 0.6, decay = 0.5 } = o;
  const { ctx } = b;
  const s = ctx.createOscillator();
  s.type = 'sine';
  s.frequency.setValueAtTime(hz * 2.2, t);
  s.frequency.exponentialRampToValueAtTime(hz, t + 0.04);
  s.frequency.exponentialRampToValueAtTime(hz * 0.85, t + decay);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  s.connect(g).connect(shaper(ctx, 1.8)).connect(out);
  const sg = ctx.createGain();
  sg.gain.value = 0.35;
  g.connect(sg).connect(b.rev);
  s.start(t);
  s.stop(t + decay + 0.05);
}

/** an original stadium chant (A minor, 120 BPM, 4 bars): "オー、オー、オオオー…" */
export const CHANT_BPM = 120;
export const CHANT: ChantNote[] = [
  { beat: 0, len: 1, midi: 57, vowel: 'o' },
  { beat: 1, len: 1, midi: 57, vowel: 'o' },
  { beat: 2, len: 0.5, midi: 60, vowel: 'o' },
  { beat: 2.5, len: 0.5, midi: 64, vowel: 'o' },
  { beat: 3, len: 1, midi: 62, vowel: 'o' },
  { beat: 4, len: 1, midi: 60, vowel: 'o' },
  { beat: 5, len: 0.5, midi: 59, vowel: 'o' },
  { beat: 5.5, len: 0.5, midi: 60, vowel: 'o' },
  { beat: 6, len: 1.6, midi: 57, vowel: 'a' },
  { beat: 8, len: 1, midi: 57, vowel: 'o' },
  { beat: 9, len: 1, midi: 57, vowel: 'o' },
  { beat: 10, len: 0.5, midi: 60, vowel: 'o' },
  { beat: 10.5, len: 0.5, midi: 64, vowel: 'o' },
  { beat: 11, len: 1, midi: 67, vowel: 'o' },
  { beat: 12, len: 1, midi: 65, vowel: 'o' },
  { beat: 13, len: 0.5, midi: 64, vowel: 'o' },
  { beat: 13.5, len: 0.5, midi: 62, vowel: 'o' },
  { beat: 14, len: 1.6, midi: 64, vowel: 'a' },
];
/** the drums under the chant: "ドン、ドン、ドドドン" in every bar */
export const CHANT_DRUMS: { beat: number; hz: number; gain: number }[] = [0, 4, 8, 12].flatMap((bar) => [
  { beat: bar, hz: 60, gain: 0.75 },
  { beat: bar + 1, hz: 60, gain: 0.6 },
  { beat: bar + 2, hz: 72, gain: 0.55 },
  { beat: bar + 2.5, hz: 72, gain: 0.5 },
  { beat: bar + 3, hz: 60, gain: 0.7 },
]);

// ------------------------------------------------------------------ the SHOOT GACHA crowd (decision 114: B, the chant)

/**
 * The crowd of the SHOOT GACHA, rendered once to audio files
 * (npm run sound:render -w @fd/web) and played by shoot/audio.ts:
 * the chant (a seamless loop) before the kick and, quieter, while the cards
 * come; "オォォ" while the ball flies; everyone's "オーッ！" and the drums at the
 * goal; and a reaction when a card shows its face (RARE small, EPIC /
 * LEGENDARY big, ICON the biggest). All clips are rendered at one common level.
 */
export interface CrowdClip {
  id: string;
  /** seconds of audio (a loop: exactly one loop; its tail is folded back into the start) */
  seconds: number;
  loop: boolean;
  play: (b: CrowdBus, out: AudioNode) => void;
}

const passes = (k: number) => Array.from({ length: k }, (_, i) => CHANT.map((x) => ({ ...x, beat: x.beat + i * 16 }))).flat();
const drumsOf = (k: number) => Array.from({ length: k }, (_, i) => CHANT_DRUMS.map((x) => ({ ...x, beat: x.beat + i * 16 }))).flat();

export const CROWD_CLIPS: CrowdClip[] = [
  {
    id: 'chant',
    seconds: (32 * 60) / CHANT_BPM,
    loop: true,
    play(b, out) {
      chant(b, 0, passes(2), CHANT_BPM, { gain: 0.5, seed: 21 });
      for (const d of drumsOf(2)) standDrum(b, out, (d.beat * 60) / CHANT_BPM, { hz: d.hz, gain: d.gain * 0.8 });
    },
  },
  {
    id: 'ooh',
    seconds: 3.8,
    loop: false,
    play(b) {
      shout(b, 0.02, { voices: 30, dur: 1.1, vowels: [['u', 'o'], ['o']], rise: 1, climb: 5, gain: 0.42, spread: 0.18, seed: 31 });
    },
  },
  {
    id: 'goal',
    seconds: 6,
    loop: false,
    play(b, out) {
      shout(b, 0, { voices: 46, dur: 1.6, vowels: [['o']], rise: 3, gain: 0.66, spread: 0.06, seed: 44 });
      shout(b, 1.9, { voices: 46, dur: 1.3, vowels: [['o']], rise: 3, gain: 0.55, spread: 0.06, seed: 45 });
      for (const k of [0, 0.5, 1.0, 1.9]) standDrum(b, out, k, { hz: 58, gain: 0.8 });
    },
  },
  {
    id: 'react-small',
    seconds: 3.4,
    loop: false,
    play(b) {
      shout(b, 0, { voices: 24, dur: 1.1, vowels: [['o']], rise: 0, gain: 0.3, spread: 0.15, seed: 55 });
    },
  },
  {
    id: 'react-big',
    seconds: 4,
    loop: false,
    play(b, out) {
      shout(b, 0, { voices: 40, dur: 1.4, vowels: [['o']], rise: 3, gain: 0.58, spread: 0.06, seed: 54 });
      standDrum(b, out, 0, { hz: 58, gain: 0.8 });
      standDrum(b, out, 0.5, { hz: 58, gain: 0.7 });
    },
  },
  {
    id: 'react-icon',
    seconds: 6.5,
    loop: false,
    play(b, out) {
      shout(b, 0, { voices: 50, dur: 1.8, vowels: [['o']], rise: 4, gain: 0.72, spread: 0.06, seed: 63 });
      for (const k of [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0]) standDrum(b, out, k, { hz: 56 + (k % 0.5 ? 10 : 0), gain: 0.85 });
      shout(b, 2.3, { voices: 50, dur: 1.6, vowels: [['o']], rise: 3, gain: 0.6, spread: 0.06, seed: 64 });
    },
  },
];
