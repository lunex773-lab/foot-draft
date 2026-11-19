import { onSoundSettings, soundSettings } from '../lib/sound';
import { SFX, type SfxName } from './sfx';
import { createMix, type Mix } from './synth';
import { SCENE_TRACK, type Scene } from './tracks';

/**
 * The game's sound: background music by scene (A menus, D matches and drafts,
 * B gacha / exchange / auction) and the HEAVY IMPACT sound effects.
 *
 * - Browsers allow sound only after a tap: the audio starts at the first tap.
 * - The music files are rendered loops (public/audio, see manifest.json) that
 *   loop without a seam; scenes cross-fade.
 * - The music is lowered while the SHOOT GACHA plays its own sound, and
 *   paused while the page is hidden.
 */

interface Manifest {
  version: number;
  tracks: Record<string, { file: string; loopSeconds: number }>;
}

const FADE = 1.2;
const DUCKED = 0.18;

class SoundSystem {
  private ctx: AudioContext | null = null;
  private bgmBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private sfxMix: Mix | null = null;
  private manifest: Promise<Manifest | null> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private scene: Scene | null = null;
  private playing: { trackId: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private ducked = false;
  private lastTap = 0;

  constructor() {
    if (typeof window === 'undefined') return;
    onSoundSettings(() => this.applySettings());
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** called on every tap (the first one creates the audio) */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running' && !document.hidden) void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.bgmBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.bgmBus.connect(ctx.destination);
    this.sfxBus.connect(ctx.destination);
    this.sfxMix = createMix(ctx, this.sfxBus, { level: 0.9, reverbSeconds: 1.6 });
    this.applySettings();
    if (this.scene) void this.startScene(this.scene);
  }

  private applySettings() {
    const s = soundSettings();
    const t = this.ctx?.currentTime ?? 0;
    this.bgmBus?.gain.setTargetAtTime(s.bgm ? s.bgmVolume * (this.ducked ? DUCKED : 1) : 0, t, 0.15);
    this.sfxBus?.gain.setTargetAtTime(s.sfx ? s.sfxVolume : 0, t, 0.05);
    if (s.bgm && this.ctx && this.scene && !this.playing) void this.startScene(this.scene);
  }

  /** the screen changed: the music of its scene (null = no music) */
  setScene(scene: Scene | null) {
    if (scene === this.scene) return;
    this.scene = scene;
    if (!this.ctx) return;
    if (!scene) this.fadeOut();
    else void this.startScene(scene);
  }

  /** the SHOOT GACHA (or anything with its own sound) is playing */
  duck(on: boolean) {
    this.ducked = on;
    this.applySettings();
  }

  /** development: what is playing (browser tests read it) */
  debug() {
    return {
      state: this.ctx?.state ?? 'none',
      scene: this.scene,
      track: this.playing?.trackId ?? null,
      ducked: this.ducked,
      bgmGain: this.bgmBus?.gain.value ?? null,
      sfxGain: this.sfxBus?.gain.value ?? null,
      played: this.played.slice(-20),
    };
  }

  private played: string[] = [];

  /** a sound effect */
  play(name: SfxName) {
    if (import.meta.env.DEV) this.played.push(name);
    if (!this.ctx || !this.sfxMix || !soundSettings().sfx) return;
    if (this.ctx.state !== 'running') return;
    try {
      SFX[name](this.sfxMix, this.ctx.currentTime + 0.005);
    } catch (err) {
      console.warn('sound effect failed', name, err);
    }
  }

  /** button taps (a short gap so that one tap never sounds twice) */
  tap(name: SfxName) {
    const now = performance.now();
    if (now - this.lastTap < 60) return;
    this.lastTap = now;
    this.play(name);
  }

  private loadManifest(): Promise<Manifest | null> {
    this.manifest ??= fetch('/audio/manifest.json')
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null);
    return this.manifest;
  }

  private buffer(trackId: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(trackId);
    if (!p) {
      p = this.loadManifest().then(async (m) => {
        const entry = m?.tracks[trackId];
        if (!entry || !this.ctx) return null;
        try {
          const data = await (await fetch(`/audio/${entry.file}`)).arrayBuffer();
          return await this.ctx.decodeAudioData(data);
        } catch (err) {
          console.warn('music could not be loaded', trackId, err);
          return null;
        }
      });
      this.buffers.set(trackId, p);
    }
    return p;
  }

  private async startScene(scene: Scene) {
    const trackId = SCENE_TRACK[scene];
    if (this.playing?.trackId === trackId || !soundSettings().bgm) return;
    const [buf, manifest] = await Promise.all([this.buffer(trackId), this.loadManifest()]);
    // the scene may have changed while loading
    if (!buf || !this.ctx || !this.bgmBus || SCENE_TRACK[this.scene ?? 'menu'] !== trackId || this.scene !== scene) return;
    if (this.playing?.trackId === trackId) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    // the loop length of the render (the decoder may add a few samples)
    src.loopEnd = Math.min(buf.duration, manifest?.tracks[trackId]?.loopSeconds ?? buf.duration);
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1, t + FADE);
    src.connect(gain).connect(this.bgmBus);
    src.start(t);
    this.fadeOut();
    this.playing = { trackId, src, gain };
  }

  private fadeOut() {
    const p = this.playing;
    if (!p || !this.ctx) return;
    const t = this.ctx.currentTime;
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(p.gain.gain.value || 0.0001, t);
    p.gain.gain.exponentialRampToValueAtTime(0.0001, t + FADE);
    p.src.stop(t + FADE + 0.05);
    this.playing = null;
  }
}

export const sound = new SoundSystem();
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __fdSound?: SoundSystem }).__fdSound = sound;

/** which music a path plays */
export function sceneOf(path: string): Scene {
  if (/^\/(room|draft|match)\b/.test(path)) return 'match';
  if (/^\/(gacha|exchange|auction)\b/.test(path)) return 'gacha';
  return 'menu';
}

/** the final standing: 1st = win, last = lose, otherwise the plain confirm sound (once per result) */
export function playResult(rank: number, players: number) {
  sound.play(rank === 1 ? 'win' : rank >= players ? 'lose' : 'confirm');
}
