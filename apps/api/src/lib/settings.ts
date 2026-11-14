import { DEFAULT_DRAFT_TIMER, validDraftTimer, type DraftTimerSetting } from '@fd/shared';
import type { Env } from '../env';

/** server settings stored in app_settings (changed from the admin site) */
export async function settingOf(env: Env, key: string): Promise<{ value: unknown; updatedAt: number; updatedBy: string | null } | null> {
  const row = await env.DB.prepare('SELECT value_json, updated_at, updated_by FROM app_settings WHERE key = ?').bind(key).first<{ value_json: string; updated_at: number; updated_by: string | null }>();
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value_json), updatedAt: row.updated_at, updatedBy: row.updated_by };
  } catch {
    return null;
  }
}

/** draft timer comparison (decision 66); the default applies when the setting is missing or broken */
export async function draftTimerSetting(env: Env): Promise<DraftTimerSetting> {
  return validDraftTimer((await settingOf(env, 'draft_timer'))?.value) ?? DEFAULT_DRAFT_TIMER;
}
