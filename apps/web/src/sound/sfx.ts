import { blip, bell, boom, braam, burst, clap, crowd, hat, kick, lead, n, pluck, snare, stab, sub808, sweep, tom, type Mix } from './synth';

/**
 * Sound effect candidates: three sets with the same 12 sounds. Every sound
 * is a function scheduling Web Audio nodes from time t (live or offline).
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

// ------------------------------------------------------------------ 2: neon (clean synth with a sub layer)
const neon: SfxSet = {
  id: 'neon',
  name: '2. NEON PULSE',
  style: 'ゲームの配色に合うネオン系。澄んだシンセ音の下に低い音を重ねた、すっきりした音',
  sounds: {
    tap: (m, t) => {
      blip(m, t, 1200, { to: 900, dur: 0.05, gain: 0.12 });
      blip(m, t, 90, { dur: 0.06, gain: 0.3 });
    },
    confirm: (m, t) => {
      blip(m, t, 880, { dur: 0.08, gain: 0.12, type: 'triangle' });
      blip(m, t + 0.07, 1320, { dur: 0.14, gain: 0.12, type: 'triangle', rev: 0.25 });
      blip(m, t, 70, { dur: 0.18, gain: 0.35 });
    },
    cancel: (m, t) => {
      blip(m, t, 900, { to: 450, dur: 0.12, gain: 0.1, type: 'triangle' });
      blip(m, t, 60, { dur: 0.12, gain: 0.25 });
    },
    coin: (m, t) => {
      [n('E6'), n('B6')].forEach((md, i) => pluck(m, t + i * 0.06, md, { gain: 0.1, decay: 0.3, type: 'square', cutoff: 6000 }));
      blip(m, t, 75, { dur: 0.15, gain: 0.3 });
    },
    card: (m, t) => {
      burst(m, t, { type: 'highpass', from: 3000, dur: 0.12, gain: 0.15 });
      blip(m, t + 0.1, 400, { to: 1600, dur: 0.18, gain: 0.08, type: 'sawtooth', rev: 0.3 });
      blip(m, t + 0.1, 65, { dur: 0.3, gain: 0.3 });
    },
    pick: (m, t) => {
      stab(m, t, [n('A4'), n('E5'), n('A5')], { gain: 0.06, decay: 0.25 });
      kick(m, t, { from: 150, to: 55, decay: 0.2, gain: 0.55, click: 0.1 });
    },
    kickoff: (m, t) => {
      sweep(m, t, 0.6, { from: 400, to: 8000, gain: 0.15 });
      [n('A3'), n('E4'), n('A4'), n('E5')].forEach((md, i) => pluck(m, t + 0.6 + i * 0.05, md, { gain: 0.08, decay: 0.8 }));
      kick(m, t + 0.6, { from: 140, to: 40, decay: 0.8, gain: 0.8 });
    },
    goal: (m, t) => {
      kick(m, t, { from: 150, to: 38, decay: 1.2, gain: 0.9 });
      stab(m, t, [n('D4'), n('F#4'), n('A4'), n('D5')], { gain: 0.07, decay: 1.4, cutoff: 6000 });
      [0, 1, 2, 3, 4, 5].forEach((i) => pluck(m, t + 0.1 + i * 0.07, n('D5') + [0, 4, 7, 12, 16, 19][i], { gain: 0.06, decay: 0.5 }));
    },
    win: (m, t) => {
      const mel = ['E5', 'G5', 'B5', 'E6'];
      mel.forEach((nm, i) => lead(m, t + i * 0.12, n(nm), 0.14, { gain: 0.06 }));
      stab(m, t + 0.48, [n('E4'), n('G#4'), n('B4'), n('E5')], { gain: 0.07, decay: 1.2 });
      kick(m, t + 0.48, { from: 140, to: 40, decay: 0.9, gain: 0.8 });
    },
    lose: (m, t) => {
      ['E4', 'D4', 'C4', 'B3'].forEach((nm, i) => lead(m, t + i * 0.18, n(nm), 0.2, { gain: 0.05, cutoff: 1500 }));
      blip(m, t + 0.6, 80, { to: 40, dur: 0.8, gain: 0.35 });
    },
    tick: (m, t) => {
      blip(m, t, 1600, { dur: 0.03, gain: 0.1, type: 'square', rev: 0 });
      blip(m, t, 100, { dur: 0.04, gain: 0.2 });
    },
    error: (m, t) => {
      blip(m, t, 220, { dur: 0.09, gain: 0.12, type: 'square', rev: 0 });
      blip(m, t + 0.11, 196, { dur: 0.14, gain: 0.12, type: 'square', rev: 0 });
      blip(m, t, 55, { dur: 0.25, gain: 0.3 });
    },
  },
};

// ------------------------------------------------------------------ 3: stadium (drums, ball, whistle, crowd)
const stadium: SfxSet = {
  id: 'stadium',
  name: '3. STADIUM',
  style: 'サッカー場の雰囲気。太鼓・ボールを蹴る音・笛・歓声を低音でまとめた音',
  sounds: {
    tap: (m, t) => {
      tom(m, t, { hz: 140, gain: 0.35, decay: 0.08, rev: 0 });
    },
    confirm: (m, t) => {
      tom(m, t, { hz: 110, gain: 0.5, decay: 0.2, rev: 0.1 });
      tom(m, t + 0.08, { hz: 165, gain: 0.4, decay: 0.15, rev: 0.1 });
    },
    cancel: (m, t) => {
      tom(m, t, { hz: 150, gain: 0.35, decay: 0.12, rev: 0 });
      tom(m, t + 0.08, { hz: 95, gain: 0.35, decay: 0.15, rev: 0 });
    },
    coin: (m, t) => {
      hat(m, t, { gain: 0.15, tone: 6000 });
      bell(m, t, n('A5'), { gain: 0.08, decay: 0.6, ratio: 5.1, index: 2 });
      tom(m, t, { hz: 80, gain: 0.4, decay: 0.2, rev: 0 });
    },
    card: (m, t) => {
      burst(m, t, { from: 1500, to: 400, dur: 0.12, gain: 0.25, q: 0.7 });
      tom(m, t + 0.1, { hz: 70, gain: 0.5, decay: 0.3, rev: 0.2 });
    },
    pick: (m, t) => {
      // a ball being kicked
      kick(m, t, { from: 300, to: 80, decay: 0.12, gain: 0.7, click: 0.5 });
      burst(m, t, { from: 1200, dur: 0.05, gain: 0.2 });
    },
    kickoff: (m, t) => {
      // a referee's whistle (two tones with a trill), then the crowd
      for (const [dt, len] of [
        [0, 0.18],
        [0.25, 0.55],
      ] as const) {
        blip(m, t + dt, 2900, { dur: len, gain: 0.08, type: 'sine', rev: 0.3 });
        blip(m, t + dt, 3020, { dur: len, gain: 0.06, type: 'sine', rev: 0.3 });
      }
      crowd(m, t + 0.6, 2, { gain: 0.12 });
      tom(m, t + 0.8, { hz: 60, gain: 0.8, decay: 0.8 });
    },
    goal: (m, t) => {
      kick(m, t, { from: 300, to: 80, decay: 0.12, gain: 0.6, click: 0.5 });
      burst(m, t + 0.25, { from: 300, to: 120, dur: 0.6, gain: 0.3, q: 0.6, rev: 0.4 });
      boom(m, t + 0.25, { from: 100, to: 35, dur: 1.6, gain: 0.8 });
      crowd(m, t + 0.25, 3, { gain: 0.2 });
    },
    win: (m, t) => {
      [0, 0.25, 0.5].forEach((dt) => {
        tom(m, t + dt, { hz: 70, gain: 0.7, decay: 0.3 });
        clap(m, t + dt, { gain: 0.4, rev: 0.5 });
      });
      crowd(m, t + 0.5, 2.5, { gain: 0.18 });
      boom(m, t + 0.75, { from: 110, to: 38, dur: 1.4, gain: 0.7 });
    },
    lose: (m, t) => {
      crowd(m, t, 1.6, { gain: 0.07 });
      tom(m, t, { hz: 70, gain: 0.6, decay: 0.6 });
      tom(m, t + 0.4, { hz: 55, gain: 0.6, decay: 0.9 });
    },
    tick: (m, t) => {
      tom(m, t, { hz: 200, gain: 0.3, decay: 0.05, rev: 0 });
    },
    error: (m, t) => {
      tom(m, t, { hz: 60, gain: 0.6, decay: 0.25, rev: 0 });
      burst(m, t, { from: 400, dur: 0.2, gain: 0.15, q: 3, rev: 0 });
    },
  },
};

export const SFX_SETS: SfxSet[] = [heavy, neon, stadium];
