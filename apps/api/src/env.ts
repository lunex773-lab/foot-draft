import type { RoomDO } from './room/RoomDO';

export interface Env {
  DB: D1Database;
  ROOM: DurableObjectNamespace<RoomDO>;
  ENVIRONMENT: 'local' | 'development' | 'staging' | 'production';
  /** HMAC secret for WebSocket tickets (secret) */
  WS_TICKET_SECRET: string;
  /** "true" -> admins must use TOTP */
  ADMIN_REQUIRE_2FA: string;
  /** "true" -> rooms may override timings (tests). Never in production. */
  ALLOW_TEST_TIMINGS: string;
  /** comma separated CORS origins */
  ALLOWED_ORIGINS: string;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  sessionId: string;
}

export interface AuthAdmin {
  id: string;
  username: string;
  role: 'owner' | 'admin' | 'viewer';
  sessionId: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser; admin: AuthAdmin; requestId: string };
};
