/**
 * The big neon "DUEL" button of the home screen (from the design the user
 * provided, 2026-11-17). Opens the mode select.
 */
export function DuelButton({ onClick, label = 'DUEL', disabled = false, className = '' }: { onClick?: () => void; label?: string; disabled?: boolean; className?: string }) {
  return (
    <button type="button" className={`duel-button ${className}`} onClick={onClick} disabled={disabled} aria-label={label}>
      <span className="duel-inner">
        <span className="duel-pattern duel-pattern-left" />
        <span className="duel-label">{label}</span>
        <span className="duel-pattern duel-pattern-right" />
      </span>
    </button>
  );
}
