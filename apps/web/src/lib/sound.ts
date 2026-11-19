/**
 * Sound settings (saved per device): background music and sound effects can
 * each be turned on / off and get a volume. Both are on at the start (the
 * user's choice); browsers only allow sound after the first tap.
 * "fd:sound" (effects on / off) is also used by the SHOOT GACHA button.
 */
export interface SoundSettings {
  bgm: boolean;
  /** 0..1 */
  bgmVolume: number;
  sfx: boolean;
  /** 0..1 */
  sfxVolume: number;
}

const KEYS = { sfx: 'fd:sound', bgm: 'fd:bgm', bgmVolume: 'fd:bgm-volume', sfxVolume: 'fd:sfx-volume' } as const;
export const SOUND_DEFAULTS: SoundSettings = { bgm: true, bgmVolume: 0.6, sfx: true, sfxVolume: 0.8 };
const EVENT = 'fd:sound-settings';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

const volume = (v: string | null, def: number) => {
  const x = v === null ? NaN : Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : def;
};

export function soundSettings(): SoundSettings {
  return {
    bgm: read(KEYS.bgm) !== 'off',
    bgmVolume: volume(read(KEYS.bgmVolume), SOUND_DEFAULTS.bgmVolume),
    sfx: read(KEYS.sfx) !== 'off',
    sfxVolume: volume(read(KEYS.sfxVolume), SOUND_DEFAULTS.sfxVolume),
  };
}

export function setSoundSettings(patch: Partial<SoundSettings>) {
  if (patch.bgm !== undefined) write(KEYS.bgm, patch.bgm ? 'on' : 'off');
  if (patch.sfx !== undefined) write(KEYS.sfx, patch.sfx ? 'on' : 'off');
  if (patch.bgmVolume !== undefined) write(KEYS.bgmVolume, String(volume(String(patch.bgmVolume), SOUND_DEFAULTS.bgmVolume)));
  if (patch.sfxVolume !== undefined) write(KEYS.sfxVolume, String(volume(String(patch.sfxVolume), SOUND_DEFAULTS.sfxVolume)));
  window.dispatchEvent(new Event(EVENT));
}

export function onSoundSettings(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** sound effects on (the SHOOT GACHA uses this too) */
export function soundOn(): boolean {
  return soundSettings().sfx;
}

export function setSoundOn(on: boolean) {
  setSoundSettings({ sfx: on });
}
