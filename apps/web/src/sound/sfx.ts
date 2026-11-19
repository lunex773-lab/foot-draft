import { blip, bell, boom, braam, burst, crowd, kick, n, snare, stab, sub808, sweep, type Mix } from './synth';

/**
 * Sound effects (set 1 "HEAVY IMPACT", chosen by the user from three): every
 * sound is a function scheduling Web Audio nodes from time t (live or offline).
 */
export type SfxName = 'tap' | 'confirm' | 'cancel' | 'coin' | 'card' | 'pick' | 'kickoff' | 'goal' | 'win' | 'lose' | 'tick' | 'error';

export const SFX_LABEL: Record<SfxName, string> = {
  tap: 'ボタンを押す',
  confirm: '決定',
  cancel: '戻る・キャンセル',
  coin: 'コイン・GEMS を受け取る',
  card: 'カードをめくる',
  pick: '選手を指名・入札',
  kickoff: '試合開始',
  goal: 'ゴール',
  win: '勝利',
  lose: '敗北',
  tick: '残り時間のカウント',
  error: 'エラー・できない操作',
};

export const SFX_ORDER: SfxName[] = ['tap', 'confirm', 'cancel', 'coin', 'card', 'pick', 'kickoff', 'goal', 'win', 'lose', 'tick', 'error'];

export interface SfxSet {
  id: string;
  name: string;
  style: string;
  sounds: Record<SfxName, (m: Mix, t: number) => void>;
}

// ------------------------------------------------------------------ 1: heavy (deep, punchy, a little distorted)
const heavy: SfxSet = {
  id: 'heavy',
  name: '1. HEAVY IMPACT',
  style: '重くて太い音。どの音にも低いドンが入り、少し歪ませた迫力系',
  sounds: {
    tap: (m, t) => {
      kick(m, t, { from: 220, to: 90, decay: 0.08, gain: 0.45, click: 0.2 });
    },
    confirm: (m, t) => {
      kick(m, t, { from: 180, to: 55, decay: 0.25, gain: 0.7 });
      blip(m, t + 0.01, 440, { to: 660, dur: 0.12, gain: 0.12, type: 'square' });
    },
    cancel: (m, t) => {
      kick(m, t, { from: 140, to: 50, decay: 0.18, gain: 0.5, click: 0.1 });
      blip(m, t, 330, { to: 180, dur: 0.14, gain: 0.1, type: 'triangle' });
    },
    coin: (m, t) => {
      sub808(m, t, n('C2'), 0.25, { gain: 0.5 });
      [n('C6'), n('G6')].forEach((md, i) => bell(m, t + i * 0.07, md, { gain: 0.1, decay: 0.5, ratio: 2 }));
    },
    card: (m, t) => {
      burst(m, t, { from: 600, to: 4000, dur: 0.18, gain: 0.25 });
      kick(m, t + 0.17, { from: 120, to: 45, decay: 0.35, gain: 0.6, click: 0 });
    },
    pick: (m, t) => {
      kick(m, t, { from: 200, to: 50, decay: 0.3, gain: 0.85, drive: 3 });
      snare(m, t, { gain: 0.25, rev: 0.1, decay: 0.1 });
    },
    kickoff: (m, t) => {
      sweep(m, t, 0.5, { from: 200, to: 3000, gain: 0.2 });
      boom(m, t + 0.5, { from: 120, to: 35, dur: 1.4, gain: 0.9 });
      braam(m, t + 0.5, [n('C2'), n('G2'), n('C3')], 1.4, { gain: 0.12 });
    },
    goal: (m, t) => {
      boom(m, t, { from: 150, to: 32, dur: 2, gain: 1 });
      braam(m, t, [n('D2'), n('A2'), n('D3'), n('F#3')], 2, { gain: 0.14 });
      crowd(m, t, 2.5, { gain: 0.14 });
    },
    win: (m, t) => {
      [n('C4'), n('E4'), n('G4'), n('C5')].forEach((md, i) => {
        kick(m, t + i * 0.13, { from: 160, to: 55, decay: 0.2, gain: 0.5 });
        stab(m, t + i * 0.13, [md, md + 7], { gain: 0.06, decay: 0.25 });
      });
      boom(m, t + 0.52, { from: 130, to: 40, dur: 1.4, gain: 0.8 });
      stab(m, t + 0.52, [n('C4'), n('E4'), n('G4'), n('C5')], { gain: 0.07, decay: 1.2 });
    },
    lose: (m, t) => {
      braam(m, t, [n('C2'), n('Eb2'), n('G2')], 1.6, { gain: 0.12 });
      sub808(m, t, n('C2'), 1.4, { glideFrom: n('G2'), gain: 0.6 });
    },
    tick: (m, t) => {
      kick(m, t, { from: 400, to: 200, decay: 0.05, gain: 0.35, click: 0.15 });
    },
    error: (m, t) => {
      sub808(m, t, n('F1'), 0.25, { gain: 0.6, drive: 4 });
      blip(m, t, 110, { dur: 0.22, gain: 0.12, type: 'square', rev: 0 });
    },
  },
};

export const SFX_SETS: SfxSet[] = [heavy];

/** the user's choice */
export const SFX = heavy.sounds;
