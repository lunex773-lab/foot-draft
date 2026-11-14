import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'ROOM_FULL'
  | 'ROOM_NOT_JOINABLE'
  | 'INSUFFICIENT_FUNDS'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  ROOM_FULL: 409,
  ROOM_NOT_JOINABLE: 409,
  INSUFFICIENT_FUNDS: 409,
  INTERNAL: 500,
};

export class ApiError extends HTTPException {
  readonly code: string;
  constructor(code: ErrorCode | (string & {}), message?: string, status?: number) {
    super((status ?? STATUS[code as ErrorCode] ?? 400) as 400, { message: message ?? code });
    this.code = code;
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export async function readJson<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return body as T;
  } catch {
    throw new ApiError('BAD_REQUEST', 'invalid JSON body');
  }
}

export function str(v: unknown, field: string, opts: { min?: number; max?: number; pattern?: RegExp; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw new ApiError('BAD_REQUEST', `${field} is required`);
  }
  if (typeof v !== 'string') throw new ApiError('BAD_REQUEST', `${field} must be a string`);
  const s = v.trim();
  if (opts.min !== undefined && s.length < opts.min) throw new ApiError('BAD_REQUEST', `${field} must be at least ${opts.min} characters`);
  if (opts.max !== undefined && s.length > opts.max) throw new ApiError('BAD_REQUEST', `${field} must be at most ${opts.max} characters`);
  if (opts.pattern && !opts.pattern.test(s)) throw new ApiError('BAD_REQUEST', `${field} has an invalid format`);
  return s;
}
