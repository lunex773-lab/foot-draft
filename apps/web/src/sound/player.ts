import { useEffect } from 'react';
import { onSoundSettings, soundSettings } from '../lib/sound';
import { SFX, type SfxName } from './sfx';
import { createMix, type Mix } from './synth';
import { MATCH_TRACKS, SCENE_TRACK, type Scene } from './tracks';

/**
 * The game's sound: background music by scene (A menus, D rooms and drafts,
 * B gacha / exchange / auction; while a match plays on screen, one of the
 * three match tracks at random) and the HEAVY IMPACT sound effects.
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
/** the music under the SHOOT GACHA (its own stadium sound and crowd chant) */
const DUCKED = 0.08;

class SoundSystem {
  private ctx: AudioContext | null = null;
  private bgmBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private sfxMix: Mix | null = null;
  private manifest: Promise<Manifest | null> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private scene: Scene | null = null;
  /** while a match plays on screen: its track (decision 116) */
  private matchTrack: string | null = null;
  private lastMatchTrack: string | null = null;
  private matchEndedAt = -Infinity;
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
    this.refresh();
  }

  private applySettings() {
    const s = soundSettings();
    const t = this.ctx?.currentTime ?? 0;
    this.bgmBus?.gain.setTargetAtTime(s.bgm ? s.bgmVolume * (this.ducked ? DUCKED : 1) : 0, t, 0.15);
    this.sfxBus?.gain.setTargetAtTime(s.sfx ? s.sfxVolume : 0, t, 0.05);
    if (s.bgm && this.ctx && !this.playing) this.refresh();
  }

  /** the track that should play now */
  private wanted(): string | null {
    return this.matchTrack ?? (this.scene ? SCENE_TRACK[this.scene] : null);
  }

  private refresh() {
    if (!this.ctx) return;
    const id = this.wanted();
    if (!id) this.fadeOut();
    else void this.startTrack(id);
  }

  /** the screen changed: the music of its scene (null = no music) */
  setScene(scene: Scene | null) {
    if (scene === this.scene) return;
    this.scene = scene;
    this.refresh();
  }

  /** a match starts playing on screen: one of the match tracks at random, never the same twice in a row */
  startMatch() {
    if (this.lastMatchTrack && performance.now() - this.matchEndedAt < 400) {
      // the same match screen mounted again at once (not a new match): keep its track
      this.matchTrack = this.lastMatchTrack;
    } else {
      const pool = MATCH_TRACKS.filter((id) => id !== this.lastMatchTrack);
      this.matchTrack = pool[Math.floor(Math.random() * pool.length)] ?? MATCH_TRACKS[0];
      this.lastMatchTrack = this.matchTrack;
    }
    this.refresh();
  }

  /** the match left the screen: back to the music of the scene (a moment later, in case it comes back at once) */
  endMatch() {
    this.matchTrack = null;
    this.matchEndedAt = performance.now();
    window.setTimeout(() => {
      if (!this.matchTrack) this.refresh();
    }, 150);
  }

  /** the SHOOT GACHA (or anything with its own sound) is playing */
  duck(on: boolean) {
    this.ducked = on;
    this.applySettings();
  }

  /** the running audio context (the SHOOT GACHA plays on it too, so its crowd can start before the first touch) */
  audioContext(): AudioContext | null {
    return this.ctx;
  }

  /** development: what is playing (browser tests read it) */
  debug() {
    return {
      state: this.ctx?.state ?? 'none',
      scene: this.scene,
      matchTrack: this.matchTrack,
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

  private async startTrack(trackId: string) {
    if (this.playing?.trackId === trackId || !soundSettings().bgm) return;
    const [buf, manifest] = await Promise.all([this.buffer(trackId), this.loadManifest()]);
    // the screen may have changed while loading
    if (!buf || !this.ctx || !this.bgmBus || this.wanted() !== trackId) return;
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

/** while the calling component is on screen, a match is playing (match music) */
export function useMatchMusic(active = true) {
  useEffect(() => {
    if (!active) return;
    sound.startMatch();
    return () => sound.endMatch();
  }, [active]);
}

/** the final standing: 1st = win, last = lose, otherwise the plain confirm sound (once per result) */
export function playResult(rank: number, players: number) {
  sound.play(rank === 1 ? 'win' : rank >= players ? 'lose' : 'confirm');
}
