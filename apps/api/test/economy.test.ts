import { describe, expect, it } from 'vitest';
import { testGrantsEnabled } from '../src/lib/auth';
import { requestIdOf } from '../src/lib/economy';

describe('economy guards', () => {
  it('test grants are never available in production (decision 42)', () => {
    expect(testGrantsEnabled({ ENVIRONMENT: 'production' })).toBe(false);
    expect(testGrantsEnabled({ ENVIRONMENT: 'staging' })).toBe(true);
    expect(testGrantsEnabled({ ENVIRONMENT: 'local' })).toBe(true);
    expect(testGrantsEnabled({ ENVIRONMENT: 'development' })).toBe(true);
    expect(testGrantsEnabled({ ENVIRONMENT: '' })).toBe(false);
  });

  it('request ids are validated', () => {
    expect(requestIdOf('abcd-1234_XYZ')).toBe('abcd-1234_XYZ');
    expect(() => requestIdOf('short')).toThrow();
    expect(() => requestIdOf('has space in it')).toThrow();
    expect(() => requestIdOf(undefined)).toThrow();
  });
});
