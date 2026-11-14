import type { Env } from '../env';
import { randomId } from './crypto';

/** admin operation log (spec 12, 14-5, 20-4) */
export function auditStatement(env: Env, adminId: string | null, action: string, target: { type?: string; id?: string } = {}, detail?: Record<string, unknown>, ip?: string | null) {
  return env.DB.prepare('INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, detail_json, ip, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(
    randomId(),
    adminId,
    action,
    target.type ?? null,
    target.id ?? null,
    detail ? JSON.stringify(detail) : null,
    ip ?? null,
    Date.now(),
  );
}

export function audit(env: Env, adminId: string | null, action: string, target: { type?: string; id?: string } = {}, detail?: Record<string, unknown>, ip?: string | null) {
  return auditStatement(env, adminId, action, target, detail, ip).run();
}

export const ipOf = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header('CF-Connecting-IP') ?? null;
