import type { Rarity } from '@fd/shared';
import { setSoundOn, soundOn, soundSettings } from '../lib/sound';

/** the output level follows the effects volume of the settings */
const level = () => 1.1 * soundSettings().sfxVolume;

/**
 * Sounds of the SHOOT GACHA made with the Web Audio API (no sound files):
 * the kick, the ball, the net and a sting per rarity. Noise is used only in
 * short hits (a continuous crowd made of noise was heard as a hiss "ザー" and
 * was removed). Muted with the button in the animation or in Settings.
 */

export class ShootAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** a send to a large hall reverb (the ICON sounds) */
  private reverb: GainNode | null = null;
  muted = !soundOn();

  /** must be called from a user gesture (the first touch on the ball) */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : level();
    // a compressor keeps the heavy bass of the ICON sounds from clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    // a hall reverb (generated impulse: decaying stereo noise)
    const irLen = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / irLen) ** 3.2;
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.55;
    this.reverb.connect(conv).connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    setSoundOn(!m);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : level(), this.ctx.currentTime, 0.05);
  }

  private noiseBurst(dur: number, filter: BiquadFilterType, freq: number, gain: number, sweepTo?: number, wet = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    if (wet > 0) this.send(g, wet);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private send(node: AudioNode, amount: number) {
    if (!this.ctx || !this.reverb) return;
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g).connect(this.reverb);
  }

  private tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number, wet = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    if (wet > 0) this.send(g, wet);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** the boot on the turf (plant foot) */
  plant() {
    this.noiseBurst(0.08, 'lowpass', 700, 0.25);
  }

  /** the strike: a deep thump and a leather slap */
  kick(power: number) {
    this.tone(140, 0, 0.18, 0.9, 'sine', 48);
    this.noiseBurst(0.05, 'highpass', 1800, 0.35 + power * 0.25);
    this.noiseBurst(0.35, 'bandpass', 1400, 0.06, 500);
  }

  /** the ball hits the net: a short swish and a soft thud */
  net() {
    this.noiseBurst(0.18, 'bandpass', 2200, 0.2, 600);
    this.noiseBurst(0.15, 'lowpass', 300, 0.3);
    this.tone(90, 0, 0.3, 0.5, 'sine', 50);
  }

  /** the goal: a deep, clean boom (tonal; no noise) */
  roar() {
    this.bass(120, 40, 0, 1.2, 0.5, 2);
  }

  /** ICON: the time stops — a deep sub drop and a dark low chord */
  hush() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.bass(78, 26, 0, 1.5, 1.0, 2.6);
    this.braam([41.2, 41.45, 61.7], 0, 1.4, 0.22, 90, 260, 0.5);
    // a shimmer slowing down (tape stop)
    this.tone(1760, 0.05, 1.1, 0.05, 'triangle', 220, 0.8);
  }

  /** ICON: a swell rising into the card reveal (tonal: a rising saw and a sub swell, no noise) */
  riser(dur: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(220, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.16, t + dur);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(lp).connect(og).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.1);
    this.bass(36, 52, 0, dur, 0.5, 1.5, true);
  }

  /** ICON: a huge, bass-heavy impact (the goal and the card reveal) */
  private iconImpact() {
    // a sub drop with a long tail (distorted a little so phone speakers carry it)
    this.bass(150, 30, 0, 2.6, 1.15, 3.2);
    // a dark distorted brass-like chord (A1 / E2 / A2) opening and closing
    this.braam([55, 55.35, 82.41, 110, 109.4, 164.81], 0, 2.4, 0.3, 140, 1700, 0.45);
    // the impact (a short hit only)
    this.noiseBurst(0.25, 'lowpass', 1800, 0.45, 80);
    this.noiseBurst(0.06, 'highpass', 3000, 0.2);
    // a rainbow sparkle in the hall
    [1318.5, 1661.22, 1975.53, 2637.02, 3322.44].forEach((f, i) => this.tone(f, 0.14 + i * 0.07, 1.8, 0.045, 'sine', undefined, 1));
  }

  /** a sine bass from one pitch to another, driven a little (harmonics) */
  private bass(from: number, to: number, at: number, dur: number, gain: number, drive: number, swell = false) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur * (swell ? 1 : 0.6));
    const g = ctx.createGain();
    if (swell) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    } else {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(gain * 0.5, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    o.connect(g).connect(this.shaper(drive)).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /** detuned saws through a sweeping low-pass and a little drive (cinematic "braam") */
  private braam(freqs: number[], at: number, dur: number, gain: number, cutFrom: number, cutPeak: number, wet: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + at;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(cutFrom, t);
    f.frequency.exponentialRampToValueAtTime(cutPeak, t + 0.22);
    f.frequency.exponentialRampToValueAtTime(cutFrom * 1.4, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
    g.gain.exponentialRampToValueAtTime(gain * 0.6, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const out = f.connect(this.shaper(1.8)).connect(g);
    out.connect(this.master);
    if (this.reverb && wet > 0) {
      const send = ctx.createGain();
      send.gain.value = wet;
      out.connect(send).connect(this.reverb);
    }
    for (const fr of freqs) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private shaper(drive: number): WaveShaperNode {
    const ws = this.ctx!.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    const k = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / k;
    }
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  /** the sting of a rarity (keeper reaction / card reveal) */
  sting(r: Rarity) {
    const chords: Record<Rarity, number[]> = {
      common: [523.25, 659.25],
      rare: [523.25, 659.25, 783.99],
      epic: [440, 554.37, 659.25, 880],
      legendary: [523.25, 659.25, 783.99, 987.77, 1046.5],
      icon: [392, 493.88, 587.33, 739.99, 880, 1174.66],
    };
    if (r === 'icon') {
      this.iconImpact();
      return;
    }
    const notes = chords[r];
    notes.forEach((f, i) => {
      this.tone(f, i * 0.07, 0.9 - i * 0.05, 0.16, r === 'common' ? 'sine' : 'triangle');
      if (r === 'legendary') this.tone(f * 2, i * 0.07 + 0.02, 0.6, 0.05, 'sine');
    });
  }

  /** the card turns */
  flip() {
    this.noiseBurst(0.22, 'bandpass', 1200, 0.18, 4000);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
