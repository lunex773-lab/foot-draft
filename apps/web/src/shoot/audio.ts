import type { Rarity } from '@fd/shared';
import { setSoundOn, soundOn } from '../lib/sound';

/**
 * Sounds of the SHOOT GACHA made with the Web Audio API (no sound files):
 * the crowd, the kick, the ball, the net, the roar and a sting per rarity.
 * Muted with the button in the animation or in Settings (saved per device).
 */

export class ShootAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: GainNode | null = null;
  private noise: AudioBuffer | null = null;
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
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // the crowd: band-passed noise with a slow swell
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    this.crowd = ctx.createGain();
    this.crowd.gain.value = 0.07;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain).connect(this.crowd.gain);
    src.connect(bp).connect(this.crowd).connect(this.master);
    src.start();
    lfo.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    setSoundOn(!m);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  private noiseBurst(dur: number, filter: BiquadFilterType, freq: number, gain: number, sweepTo?: number) {
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
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number) {
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

  /** the ball hits the net */
  net() {
    this.noiseBurst(0.5, 'bandpass', 2600, 0.32, 380);
    this.noiseBurst(0.25, 'lowpass', 300, 0.3);
  }

  /** the crowd roars for the goal */
  roar() {
    const ctx = this.ctx;
    if (!ctx || !this.crowd) return;
    const t = ctx.currentTime;
    this.crowd.gain.cancelScheduledValues(t);
    this.crowd.gain.setValueAtTime(this.crowd.gain.value, t);
    this.crowd.gain.linearRampToValueAtTime(0.42, t + 0.25);
    this.crowd.gain.linearRampToValueAtTime(0.16, t + 2.6);
    this.crowd.gain.linearRampToValueAtTime(0.07, t + 5);
  }

  /** a short hush (Icon: the time stops) */
  hush() {
    const ctx = this.ctx;
    if (!ctx || !this.crowd) return;
    this.crowd.gain.setTargetAtTime(0.01, ctx.currentTime, 0.05);
    this.tone(55, 0, 1.2, 0.35, 'sine', 40);
    this.tone(880, 0.1, 1.1, 0.08, 'triangle', 1760);
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
    const notes = chords[r];
    notes.forEach((f, i) => {
      this.tone(f, i * 0.07, 0.9 - i * 0.05, 0.16, r === 'common' ? 'sine' : 'triangle');
      if (r === 'legendary' || r === 'icon') this.tone(f * 2, i * 0.07 + 0.02, 0.6, 0.05, 'sine');
    });
    if (r === 'icon') this.noiseBurst(1.2, 'bandpass', 6000, 0.08, 1500);
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
