import { describe, expect, it } from 'vitest';
import { Rng } from '../src';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng('seed-1');
    const b = new Rng('seed-1');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('differs for different seeds', () => {
    const a = new Rng('seed-1');
    const b = new Rng('seed-2');
    const sa = Array.from({ length: 10 }, () => a.next());
    const sb = Array.from({ length: 10 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });
  it('int stays in range', () => {
    const r = new Rng('x');
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});
