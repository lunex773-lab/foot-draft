/**
 * The sound setting (saved per device). Used by the SHOOT GACHA (the button
 * in the animation) and by the Settings page.
 */
const KEY = 'fd:sound';

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
}
