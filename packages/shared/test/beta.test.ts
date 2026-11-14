import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_TIMER, GAME_CONFIG, pickSecondsFor, validDraftTimer } from '../src';

describe('draft timer comparison (decision 66)', () => {
  it('splits rooms about evenly between 8 and 12 seconds and is stable per room', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 4000; i++) {
      const id = crypto.randomUUID().replace(/-/g, '');
      const s = pickSecondsFor(id, DEFAULT_DRAFT_TIMER);
      expect(pickSecondsFor(id, DEFAULT_DRAFT_TIMER)).toBe(s);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([8, 12]);
    for (const n of counts.values()) expect(n / 4000).toBeGreaterThan(0.45);
  });

  it('fixed mode always gives the same value', () => {
    expect(pickSecondsFor('abc', { mode: 'fixed', seconds: 10 })).toBe(10);
  });

  it('validates settings', () => {
    expect(validDraftTimer({ mode: 'compare', variants: [12, 8] })).toEqual({ mode: 'compare', variants: [8, 12] });
    expect(validDraftTimer({ mode: 'compare', variants: [8] })).toBeNull();
    expect(validDraftTimer({ mode: 'compare', variants: [8, 8] })).toBeNull();
    expect(validDraftTimer({ mode: 'compare', variants: [8, 9] })).toBeNull();
    expect(validDraftTimer({ mode: 'fixed', seconds: 12 })).toEqual({ mode: 'fixed', seconds: 12 });
    expect(validDraftTimer({ mode: 'fixed', seconds: 99 })).toBeNull();
    expect(validDraftTimer(null)).toBeNull();
  });

  it('private rooms can choose 12 seconds too', () => {
    expect(GAME_CONFIG.pickSecondsOptions).toContain(12);
  });
});
