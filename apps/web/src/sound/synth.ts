/**
 * Small synthesizer for the game's music and sound effects (Web Audio, no
 * sound files). Works on an AudioContext (live) and on an
 * OfflineAudioContext (a music loop rendered once into a buffer).
 * Bass-heavy by design: the low parts get a little saturation so that phone
 * speakers, which cannot play real sub-bass, still carry them.
 */

export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

const NOTE: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** "F#3" -> MIDI number */
export function n(name: string): number {
  const m = /^([A-G][b#]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return NOTE[m[1]] + (Number(m[2]) + 1) * 12;
}

export interface Mix {
  ctx: BaseAudioContext;
  /** everything ends here (master chain) */
  master: AudioNode;
  /** drums and bass (not ducked) */
  drums: AudioNode;
  /** chords, pads, leads: ducked by the kick when `duck` is used */
  music: GainNode;
  /** send to the hall reverb */
  reverb: AudioNode;
  noise: AudioBuffer;
}

/** master chain: glue compressor + gentle soft clip + output level */
export function createMix(ctx: BaseAudioContext, out: AudioNode, opts: { level?: number; reverbSeconds?: number; input?: number } = {}): Mix {
  const level = ctx.createGain();
  level.gain.value = opts.level ?? 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.006;
  comp.release.value = 0.2;
  const clip = shaper(ctx, 1.3);
  comp.connect(clip).connect(level).connect(out);
  // headroom before the compressor (it adds its own make-up gain): the soft clip stays a safety net
  const input = ctx.createGain();
  input.gain.value = opts.input ?? 0.45;
  input.connect(comp);
  const music = ctx.createGain();
  music.connect(input);
  const drums = ctx.createGain();
  drums.connect(input);
  // hall reverb: generated impulse (decaying stereo noise)
  const seconds = opts.reverbSeconds ?? 2.6;
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = rnd() * (1 - i / len) ** 3;
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const rev = ctx.createGain();
  rev.gain.value = 0.32;
  // keep the low end dry: the reverb gets no sub
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 220;
  rev.connect(hp).connect(conv).connect(input);
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = rnd();
  return { ctx, master: input, drums, music, reverb: rev, noise };
}

const curves = new Map<number, Float32Array<ArrayBuffer>>();
export function shaper(ctx: BaseAudioContext, drive: number): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  let c = curves.get(drive);
  if (!c) {
    c = new Float32Array(1024);
    const k = Math.tanh(drive);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      c[i] = Math.tanh(drive * x) / k;
    }
    curves.set(drive, c);
  }
  ws.curve = c;
  ws.oversample = '2x';
  return ws;
}

function send(m: Mix, node: AudioNode, amount: number) {
  if (amount <= 0) return;
  const g = m.ctx.createGain();
  g.gain.value = amount;
  node.connect(g).connect(m.reverb);
}

/** attack / decay envelope on a gain (exponential, never touching 0) */
function env(g: GainNode, t: number, peak: number, attack: number, decay: number, hold = 0) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
}

function osc(m: Mix, type: OscillatorType, hz: number, t: number, stop: number, detune = 0): OscillatorNode {
  const o = m.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  o.detune.value = detune;
  o.start(t);
  o.stop(stop);
  return o;
}

function noiseSrc(m: Mix, t: number, dur: number): AudioBufferSourceNode {
  const s = m.ctx.createBufferSource();
  s.buffer = m.noise;
  s.loop = true;
  s.start(t, (t * 7.31) % 1.5);
  s.stop(t + dur + 0.05);
  return s;
}

function filter(m: Mix, type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode {
  const f = m.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

/** sidechain: the music bus dips at each kick and comes back (pumping) */
export function duck(m: Mix, t: number, depth = 0.45, release = 0.2) {
  const g = m.music.gain;
  g.setValueAtTime(1, t);
  g.linearRampToValueAtTime(1 - depth, t + 0.01);
  g.linearRampToValueAtTime(1, t + release);
}

// ------------------------------------------------------------------ drums

/** a punchy kick: pitch drop, a click, saturated */
export function kick(m: Mix, t: number, o: { from?: number; to?: number; decay?: number; gain?: number; drive?: number; click?: number } = {}) {
  const { from = 160, to = 48, decay = 0.42, gain = 1, drive = 2, click = 0.35 } = o;
  const s = osc(m, 'sine', from, t, t + decay + 0.1);
  s.frequency.exponentialRampToValueAtTime(to, t + 0.07);
  s.frequency.exponentialRampToValueAtTime(to * 0.85, t + decay);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.002, decay);
  s.connect(g).connect(shaper(m.ctx, drive)).connect(m.drums);
  if (click > 0) {
    const nz = noiseSrc(m, t, 0.02);
    const hp = filter(m, 'highpass', 2500);
    const cg = m.ctx.createGain();
    env(cg, t, click, 0.001, 0.018);
    nz.connect(hp).connect(cg).connect(m.drums);
  }
}

export function snare(m: Mix, t: number, o: { gain?: number; tone?: number; rev?: number; decay?: number } = {}) {
  const { gain = 0.7, tone = 190, rev = 0.25, decay = 0.2 } = o;
  const nz = noiseSrc(m, t, decay);
  const bp = filter(m, 'bandpass', 2200, 0.8);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.001, decay);
  nz.connect(bp).connect(g).connect(m.drums);
  send(m, g, rev);
  const s = osc(m, 'triangle', tone, t, t + 0.15);
  s.frequency.exponentialRampToValueAtTime(tone * 0.6, t + 0.1);
  const sg = m.ctx.createGain();
  env(sg, t, gain * 0.6, 0.001, 0.1);
  s.connect(sg).connect(m.drums);
}

export function clap(m: Mix, t: number, o: { gain?: number; rev?: number } = {}) {
  const { gain = 0.6, rev = 0.35 } = o;
  const bp = filter(m, 'bandpass', 1300, 1.2);
  const g = m.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  for (const [k, dt] of [0, 0.011, 0.022].entries()) {
    g.gain.setValueAtTime(gain * (k === 2 ? 1 : 0.7), t + dt);
    g.gain.exponentialRampToValueAtTime(0.02, t + dt + 0.009);
  }
  g.gain.setValueAtTime(gain, t + 0.033);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  noiseSrc(m, t, 0.25).connect(bp).connect(g).connect(m.drums);
  send(m, g, rev);
}

export function hat(m: Mix, t: number, o: { open?: boolean; gain?: number; tone?: number } = {}) {
  const { open = false, gain = 0.18, tone = 8000 } = o;
  const hp = filter(m, 'highpass', tone, 0.6);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.001, open ? 0.24 : 0.04);
  noiseSrc(m, t, open ? 0.3 : 0.06).connect(hp).connect(g).connect(m.drums);
}

/** low drum with skin noise (taiko-like) */
export function tom(m: Mix, t: number, o: { hz?: number; gain?: number; decay?: number; rev?: number } = {}) {
  const { hz = 75, gain = 0.9, decay = 0.6, rev = 0.4 } = o;
  const s = osc(m, 'sine', hz * 1.6, t, t + decay + 0.1);
  s.frequency.exponentialRampToValueAtTime(hz, t + 0.05);
  s.frequency.exponentialRampToValueAtTime(hz * 0.8, t + decay);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.003, decay);
  s.connect(g).connect(shaper(m.ctx, 1.6)).connect(m.drums);
  const nz = noiseSrc(m, t, 0.15);
  const lp = filter(m, 'lowpass', 900);
  const ng = m.ctx.createGain();
  env(ng, t, gain * 0.5, 0.002, 0.12);
  nz.connect(lp).connect(ng).connect(m.drums);
  send(m, g, rev);
}

/** a noise swell (riser / sweep), `up` or down */
export function sweep(m: Mix, t: number, dur: number, o: { from?: number; to?: number; gain?: number; rev?: number } = {}) {
  const { from = 300, to = 6000, gain = 0.25, rev = 0.4 } = o;
  const bp = filter(m, 'bandpass', from, 1.2);
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = m.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.95);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
  noiseSrc(m, t, dur + 0.1).connect(bp).connect(g).connect(m.music);
  send(m, g, rev);
}

// ------------------------------------------------------------------ bass

/** 808: a long sine with a glide, saturated so that phones hear it */
export function sub808(m: Mix, t: number, midi: number, dur: number, o: { glideFrom?: number; gain?: number; drive?: number } = {}) {
  const { glideFrom, gain = 0.85, drive = 2.6 } = o;
  const hz = midiHz(midi);
  const s = osc(m, 'sine', glideFrom ? midiHz(glideFrom) : hz, t, t + dur + 0.1);
  if (glideFrom) s.frequency.exponentialRampToValueAtTime(hz, t + 0.09);
  const g = m.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.setValueAtTime(gain, t + Math.max(0.01, dur - 0.12));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = filter(m, 'lowpass', 1400);
  s.connect(g).connect(shaper(m.ctx, drive)).connect(lp).connect(m.drums);
}

/** short plucked saw bass (synthwave pulse) */
export function pulseBass(m: Mix, t: number, midi: number, dur: number, o: { gain?: number; cutoff?: number } = {}) {
  const { gain = 0.38, cutoff = 900 } = o;
  const hz = midiHz(midi);
  const lp = filter(m, 'lowpass', cutoff * 2.2, 2);
  lp.frequency.setValueAtTime(cutoff * 2.2, t);
  lp.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + dur);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.003, dur);
  osc(m, 'sawtooth', hz, t, t + dur + 0.05).connect(lp);
  osc(m, 'square', hz / 2, t, t + dur + 0.05, 4).connect(lp);
  lp.connect(shaper(m.ctx, 1.6)).connect(g).connect(m.music);
}

// ------------------------------------------------------------------ chords and melody

/** a slow pad: detuned saws through a soft low-pass, lots of reverb */
export function pad(m: Mix, t: number, midis: number[], dur: number, o: { gain?: number; cutoff?: number; attack?: number; rev?: number } = {}) {
  const { gain = 0.07, cutoff = 1400, attack = 0.6, rev = 0.5 } = o;
  const lp = filter(m, 'lowpass', cutoff, 0.6);
  const g = m.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur - 0.4));
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
  for (const md of midis) for (const d of [-9, 9]) osc(m, 'sawtooth', midiHz(md), t, t + dur + 0.4, d).connect(lp);
  lp.connect(g).connect(m.music);
  send(m, g, rev);
}

/** "ah" choir: saws through vowel formants */
export function choir(m: Mix, t: number, midis: number[], dur: number, o: { gain?: number; rev?: number } = {}) {
  const { gain = 0.09, rev = 0.7 } = o;
  const g = m.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.8);
  g.gain.setValueAtTime(gain, t + Math.max(0.8, dur - 0.5));
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
  const mixIn = m.ctx.createGain();
  for (const md of midis) for (const d of [-7, 0, 7]) {
    const o2 = osc(m, 'sawtooth', midiHz(md), t, t + dur + 0.5, d);
    const vib = osc(m, 'sine', 5.2, t, t + dur + 0.5);
    const vg = m.ctx.createGain();
    vg.gain.value = 6;
    vib.connect(vg).connect(o2.detune);
    o2.connect(mixIn);
  }
  for (const [f, q, a] of [
    [800, 6, 1],
    [1150, 7, 0.6],
    [2900, 9, 0.25],
  ] as const) {
    const bp = filter(m, 'bandpass', f, q);
    const fg = m.ctx.createGain();
    fg.gain.value = a;
    mixIn.connect(bp).connect(fg).connect(g);
  }
  g.connect(m.music);
  send(m, g, rev);
}

/** FM bell / pluck (dark melody) */
export function bell(m: Mix, t: number, midi: number, o: { gain?: number; decay?: number; ratio?: number; index?: number; rev?: number } = {}) {
  const { gain = 0.16, decay = 1.2, ratio = 3.5, index = 3, rev = 0.45 } = o;
  const hz = midiHz(midi);
  const car = osc(m, 'sine', hz, t, t + decay + 0.1);
  const mod = osc(m, 'sine', hz * ratio, t, t + decay + 0.1);
  const mg = m.ctx.createGain();
  mg.gain.setValueAtTime(hz * index, t);
  mg.gain.exponentialRampToValueAtTime(hz * 0.05, t + decay * 0.6);
  mod.connect(mg).connect(car.frequency);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.002, decay);
  car.connect(g).connect(m.music);
  send(m, g, rev);
}

/** a plucked synth note (arpeggios) */
export function pluck(m: Mix, t: number, midi: number, o: { gain?: number; decay?: number; cutoff?: number; rev?: number; type?: OscillatorType } = {}) {
  const { gain = 0.12, decay = 0.25, cutoff = 3000, rev = 0.3, type = 'sawtooth' } = o;
  const lp = filter(m, 'lowpass', cutoff, 1.5);
  lp.frequency.setValueAtTime(cutoff, t);
  lp.frequency.exponentialRampToValueAtTime(cutoff * 0.2, t + decay);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.002, decay);
  osc(m, type, midiHz(midi), t, t + decay + 0.05).connect(lp).connect(g).connect(m.music);
  send(m, g, rev);
}

/** chord stab of detuned saws (supersaw) */
export function stab(m: Mix, t: number, midis: number[], o: { gain?: number; decay?: number; cutoff?: number; rev?: number } = {}) {
  const { gain = 0.06, decay = 0.3, cutoff = 4000, rev = 0.35 } = o;
  const lp = filter(m, 'lowpass', cutoff, 0.8);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.004, decay);
  for (const md of midis) for (const d of [-18, -7, 0, 7, 18]) osc(m, 'sawtooth', midiHz(md), t, t + decay + 0.05, d).connect(lp);
  lp.connect(g).connect(m.music);
  send(m, g, rev);
}

/** a lead note: saw + square, vibrato, optional slide from the previous note */
export function lead(m: Mix, t: number, midi: number, dur: number, o: { gain?: number; from?: number; cutoff?: number; rev?: number } = {}) {
  const { gain = 0.08, from, cutoff = 3200, rev = 0.35 } = o;
  const hz = midiHz(midi);
  const lp = filter(m, 'lowpass', cutoff, 1);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.01, 0.12, Math.max(0, dur - 0.12));
  for (const [type, d] of [
    ['sawtooth', -6],
    ['square', 6],
  ] as const) {
    const o2 = osc(m, type, from ? midiHz(from) : hz, t, t + dur + 0.15, d);
    if (from) o2.frequency.exponentialRampToValueAtTime(hz, t + 0.06);
    const vib = osc(m, 'sine', 5.5, t + 0.15, t + dur + 0.15);
    const vg = m.ctx.createGain();
    vg.gain.value = 8;
    vib.connect(vg).connect(o2.detune);
    o2.connect(lp);
  }
  lp.connect(g).connect(m.music);
  send(m, g, rev);
}

/** cinematic "braam": detuned saws, opening low-pass, drive */
export function braam(m: Mix, t: number, midis: number[], dur: number, o: { gain?: number; rev?: number } = {}) {
  const { gain = 0.12, rev = 0.5 } = o;
  const lp = filter(m, 'lowpass', 150, 4);
  lp.frequency.setValueAtTime(150, t);
  lp.frequency.exponentialRampToValueAtTime(1600, t + 0.25);
  lp.frequency.exponentialRampToValueAtTime(260, t + dur);
  const g = m.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.05);
  g.gain.exponentialRampToValueAtTime(gain * 0.5, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const md of midis) for (const d of [-10, 10]) osc(m, 'sawtooth', midiHz(md), t, t + dur + 0.1, d).connect(lp);
  lp.connect(shaper(m.ctx, 1.8)).connect(g).connect(m.music);
  send(m, g, rev);
}

/** short string note (ostinato): bowed saw, quick attack */
export function strings(m: Mix, t: number, midi: number, dur: number, o: { gain?: number; rev?: number } = {}) {
  const { gain = 0.06, rev = 0.4 } = o;
  const lp = filter(m, 'lowpass', 2200, 0.8);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.015, Math.max(0.05, dur * 0.8));
  for (const d of [-8, 8]) osc(m, 'sawtooth', midiHz(midi), t, t + dur + 0.05, d).connect(lp);
  lp.connect(g).connect(m.music);
  send(m, g, rev);
}

/** a deep boom (sub drop) */
export function boom(m: Mix, t: number, o: { from?: number; to?: number; dur?: number; gain?: number } = {}) {
  const { from = 110, to = 32, dur = 1.6, gain = 0.9 } = o;
  const s = osc(m, 'sine', from, t, t + dur + 0.1);
  s.frequency.exponentialRampToValueAtTime(to, t + dur * 0.7);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.005, dur);
  s.connect(g).connect(shaper(m.ctx, 2.4)).connect(m.drums);
}

/** a crowd swell (band-passed noise in two bands) */
export function crowd(m: Mix, t: number, dur: number, o: { gain?: number } = {}) {
  const { gain = 0.12 } = o;
  for (const [f, q] of [
    [700, 0.8],
    [1800, 1.2],
  ] as const) {
    const bp = filter(m, 'bandpass', f, q);
    const g = m.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(gain * 0.6, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    noiseSrc(m, t, dur).connect(bp).connect(g).connect(m.music);
    send(m, g, 0.5);
  }
}

/** a short sine blip (UI) */
export function blip(m: Mix, t: number, hz: number, o: { to?: number; dur?: number; gain?: number; type?: OscillatorType; rev?: number } = {}) {
  const { to, dur = 0.08, gain = 0.25, type = 'sine', rev = 0.1 } = o;
  const s = osc(m, type, hz, t, t + dur + 0.05);
  if (to) s.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.002, dur);
  s.connect(g).connect(m.music);
  send(m, g, rev);
}

/** a filtered noise burst (UI / impact) */
export function burst(m: Mix, t: number, o: { type?: BiquadFilterType; from?: number; to?: number; dur?: number; gain?: number; q?: number; rev?: number } = {}) {
  const { type = 'bandpass', from = 2000, to, dur = 0.15, gain = 0.3, q = 1, rev = 0.15 } = o;
  const f = filter(m, type, from, q);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = m.ctx.createGain();
  env(g, t, gain, 0.002, dur);
  noiseSrc(m, t, dur).connect(f).connect(g).connect(m.music);
  send(m, g, rev);
}
