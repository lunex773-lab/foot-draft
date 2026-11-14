import { tierOf } from '@fd/shared';

/** Ranked tier + rating, e.g. "GOLD 1084" */
export function TierBadge({ rating, size = 'normal' }: { rating: number; size?: 'normal' | 'large' }) {
  const t = tierOf(rating);
  return (
    <span className={`tier-badge ${size}`} style={{ borderColor: t.color, color: t.color }} title={t.labelJa}>
      <span className="tier-name">{t.label}</span>
      <span className="tier-rating">{rating}</span>
    </span>
  );
}
