/**
 * Beta test settings (Phase 7, decisions 60-67, docs/10-phase7-plan.md).
 */

/** room modes whose pick time takes part in the draft timer comparison (decision 66) */
export const TIMER_EXPERIMENT_MODES = ['quick', 'ranked', 'collection'] as const;

/** "compare": rooms are split between the variants; "fixed": every room uses `seconds` */
export type DraftTimerSetting = { mode: 'compare'; variants: number[] } | { mode: 'fixed'; seconds: number };

export const DEFAULT_DRAFT_TIMER: DraftTimerSetting = { mode: 'compare', variants: [8, 12] };

/** allowed pick times for the setting (the comparison needs 2-3 different values) */
export const DRAFT_TIMER_CHOICES = [5, 8, 10, 12, 15] as const;

export function validDraftTimer(v: unknown): DraftTimerSetting | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === 'number' && (DRAFT_TIMER_CHOICES as readonly number[]).includes(n);
  if (o.mode === 'fixed' && ok(o.seconds)) return { mode: 'fixed', seconds: o.seconds };
  if (o.mode === 'compare' && Array.isArray(o.variants) && o.variants.length >= 2 && o.variants.length <= 3 && o.variants.every(ok) && new Set(o.variants).size === o.variants.length) {
    return { mode: 'compare', variants: [...(o.variants as number[])].sort((a, b) => a - b) };
  }
  return null;
}

/**
 * Pick time of a room. In "compare" mode the room id decides the variant, so the
 * same room always gets the same value and the rooms split about evenly.
 */
export function pickSecondsFor(roomId: string, setting: DraftTimerSetting): number {
  if (setting.mode === 'fixed') return setting.seconds;
  let h = 2166136261;
  for (let i = 0; i < roomId.length; i++) {
    h ^= roomId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return setting.variants[h % setting.variants.length];
}

/** league rating after a league (decision 65): two questions on a 1-5 scale, once per Japan day */
export const RATING_QUESTIONS = [
  { key: 'draftFun', label: 'ドラフトは楽しかった？' },
  { key: 'resultFair', label: '試合結果は納得できた？' },
] as const;

/** what a test data reset sets back (decision 67) */
export const TEST_RESET_SCOPE = ['currencies', 'exchange_points', 'collection', 'collection_draft_roster', 'gacha_pity', 'missions', 'season_pass'] as const;
