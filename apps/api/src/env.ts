import type { AuctionDO } from './room/AuctionDO';
import type { DraftMatchDO } from './room/DraftMatchDO';
import type { RoomDO } from './room/RoomDO';

export interface Env {
  DB: D1Database;
  ROOM: DurableObjectNamespace<RoomDO>;
  /** DRAFT MATCH rooms (official spec v2.0) */
  DRAFT_MATCH: DurableObjectNamespace<DraftMatchDO>;
  /** the player auction market (one instance) */
  AUCTION: DurableObjectNamespace<AuctionDO>;
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
  role: 'owner' | 'admin' | 'support' | 'viewer';
  sessionId: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser; admin: AuthAdmin; requestId: string };
};
