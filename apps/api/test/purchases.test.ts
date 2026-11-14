import { describe, expect, it } from 'vitest';
import { signMockReceipt, storeStatus, verifyReceipt } from '../src/lib/purchases';

const env = (ENVIRONMENT: string) => ({ ENVIRONMENT, WS_TICKET_SECRET: 'test-secret' }) as never;

describe('stores (decision 52)', () => {
  it('the mock store is never available in production; Apple / Google are not connected', () => {
    expect(storeStatus(env('production')).mock.available).toBe(false);
    expect(storeStatus(env('staging')).mock.available).toBe(true);
    expect(storeStatus(env('staging')).apple).toEqual({ available: false, reason: 'not_connected' });
    expect(storeStatus(env('local')).google.available).toBe(false);
  });

  it('mock receipts: signed by the server, refused when changed or in production', async () => {
    const r = { v: 1 as const, type: 'purchase' as const, tx: 'mock-1', otx: 'mock-1', product: 'gems_300', user: 'u1', purchase: 'p1', at: 1 };
    const receipt = await signMockReceipt(env('staging'), r);
    expect(await verifyReceipt(env('staging'), 'mock', receipt)).toMatchObject({ ok: true, storeTransactionId: 'mock-1', productId: 'gems_300', userId: 'u1', purchaseId: 'p1' });
    const [payload, sig] = receipt.split('.');
    const forged = `${payload.slice(0, -2)}AA.${sig}`;
    expect(await verifyReceipt(env('staging'), 'mock', forged)).toMatchObject({ ok: false, result: 'invalid' });
    expect(await verifyReceipt({ ENVIRONMENT: 'staging', WS_TICKET_SECRET: 'other' } as never, 'mock', receipt)).toMatchObject({ ok: false });
    expect(await verifyReceipt(env('production'), 'mock', receipt)).toMatchObject({ ok: false, result: 'invalid' });
    expect(await verifyReceipt(env('staging'), 'apple', receipt)).toMatchObject({ ok: false, result: 'not_connected' });
  });
});
