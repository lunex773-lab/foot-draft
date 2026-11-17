import type { Env } from '../env';
import { ApiError } from './http';

export function roomStub(env: Env, roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(roomId));
}

/** Calls an internal RoomDO endpoint and converts errors to ApiError. */
export async function callRoom<T = Record<string, unknown>>(env: Env, roomId: string, path: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
  const url = new URL(`https://room${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await roomStub(env, roomId).fetch(url.toString(), {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as { error?: { code: string; message: string } } & T;
  if (!res.ok) throw new ApiError(data.error?.code ?? 'INTERNAL', data.error?.message ?? 'room error', res.status);
  return data;
}

export function draftMatchStub(env: Env, roomId: string) {
  return env.DRAFT_MATCH.get(env.DRAFT_MATCH.idFromName(roomId));
}

/** Calls an internal DraftMatchDO endpoint and converts errors to ApiError. */
export async function callDraftMatch<T = Record<string, unknown>>(env: Env, roomId: string, path: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
  const url = new URL(`https://draft-match${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await draftMatchStub(env, roomId).fetch(url.toString(), {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as { error?: { code: string; message: string } } & T;
  if (!res.ok) throw new ApiError(data.error?.code ?? 'INTERNAL', data.error?.message ?? 'room error', res.status);
  return data;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomRoomCode(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
