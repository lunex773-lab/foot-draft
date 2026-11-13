/** Crypto helpers built on WebCrypto (available in Workers and Node 20+). */

const enc = new TextEncoder();

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toHex(b: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function toB64(b: ArrayBuffer | Uint8Array): string {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64Url(b: ArrayBuffer | Uint8Array): string {
  return toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

export function randomId(bytes = 16): string {
  return toHex(randomBytes(bytes));
}

export function randomToken(): string {
  return toB64Url(randomBytes(32));
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/** constant-time comparison */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Workers caps PBKDF2 at 100k iterations */
export const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string, saltB64?: string, iterations = PBKDF2_ITERATIONS): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = saltB64 ? fromB64(saltB64) : randomBytes(16);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return { hash: toB64(bits), salt: toB64(salt), iterations };
}

export async function verifyPassword(password: string, hash: string, salt: string, iterations: number): Promise<boolean> {
  const h = await hashPassword(password, salt, iterations);
  return safeEqual(h.hash, hash);
}

async function hmacKey(secret: string, hash: 'SHA-256' | 'SHA-1', raw?: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw ?? enc.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
}

export async function hmacSha256(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'SHA-256'), enc.encode(data));
  return toB64Url(sig);
}

// ------------------------------------------------------------- WS tickets

export interface WsTicket {
  u: string; // user id
  r: string; // room id
  e: number; // expires at (ms)
}

export async function signTicket(secret: string, t: WsTicket): Promise<string> {
  const payload = toB64Url(enc.encode(JSON.stringify(t)));
  return `${payload}.${await hmacSha256(secret, payload)}`;
}

export async function verifyTicket(secret: string, ticket: string, now = Date.now()): Promise<WsTicket | null> {
  const [payload, sig] = ticket.split('.');
  if (!payload || !sig) return null;
  const expected = await hmacSha256(secret, payload);
  if (!safeEqual(expected, sig)) return null;
  try {
    const t = JSON.parse(new TextDecoder().decode(fromB64Url(payload))) as WsTicket;
    if (typeof t.e !== 'number' || t.e < now) return null;
    return t;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- TOTP (RFC 6238)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(b: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of b) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function totpCode(secretB32: string, time = Date.now(), step = 30): Promise<string> {
  const counter = Math.floor(time / 1000 / step);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 255;
    c = Math.floor(c / 256);
  }
  const key = await hmacKey('', 'SHA-1', base32Decode(secretB32));
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export async function verifyTotp(secretB32: string, code: string, time = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  for (const drift of [-1, 0, 1]) {
    if (safeEqual(await totpCode(secretB32, time + drift * 30_000), code)) return true;
  }
  return false;
}
