import { FORMATIONS, positionRatings, type Lineup, type Player } from '@fd/shared';
import { PlayerAvatar } from '@fd/ui';
import { useState } from 'react';
import { PlayerRow } from './PlayerRow';

type Sel = { kind: 'slot'; index: number } | { kind: 'bench'; index: number } | null;

/** Lineup editing: tap a slot / bench player, then tap another to swap. */
export function PitchEditor({ roster, lineup, onChange, disabled }: { roster: Player[]; lineup: Lineup; onChange: (l: Lineup) => void; disabled?: boolean }) {
  const [sel, setSel] = useState<Sel>(null);
  const byId = new Map(roster.map((p) => [p.id, p]));
  const slots = FORMATIONS[lineup.formation].slots;

  const tap = (target: NonNullable<Sel>) => {
    if (disabled) return;
    if (!sel) return setSel(target);
    if (sel.kind === target.kind && sel.index === target.index) return setSel(null);
    const starters = [...lineup.starters];
    const bench = [...lineup.bench];
    const get = (s: NonNullable<Sel>) => (s.kind === 'slot' ? starters[s.index] : bench[s.index]);
    const put = (s: NonNullable<Sel>, id: string) => (s.kind === 'slot' ? (starters[s.index] = id) : (bench[s.index] = id));
    const a = get(sel);
    const b = get(target);
    put(sel, b);
    put(target, a);
    setSel(null);
    onChange({ ...lineup, starters, bench });
  };

  return (
    <div>
      <div className="pitch">
        <svg className="lines" viewBox="0 0 68 100" preserveAspectRatio="none">
          <g fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="0.3">
            <rect x="1" y="1" width="66" height="98" />
            <line x1="1" y1="50" x2="67" y2="50" />
            <circle cx="34" cy="50" r="8" />
            <rect x="14" y="1" width="40" height="16" />
            <rect x="14" y="83" width="40" height="16" />
          </g>
        </svg>
        {slots.map((slot, i) => {
          const p = byId.get(lineup.starters[i]);
          const r = p ? positionRatings(p)[slot.pos] : 0;
          const fit = p ? (p.positions.includes(slot.pos) ? 'fit-good' : r >= p.ovr - 6 ? 'fit-ok' : 'fit-bad') : 'fit-bad';
          const selected = sel?.kind === 'slot' && sel.index === i;
          return (
            <div key={slot.id} className={`pslot ${selected ? 'sel' : ''}`} style={{ left: `${slot.x}%`, top: `${94 - slot.y * 0.86}%` }} onClick={() => tap({ kind: 'slot', index: i })}>
              {p ? <PlayerAvatar player={p} size={40} /> : <div style={{ width: 40, height: 40, borderRadius: 20, background: '#0008' }} />}
              <span className={`rt ${fit}`}>
                {slot.pos} {r || ''}
              </span>
              <span className="lbl">{p?.lastName ?? '—'}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="small muted" style={{ marginBottom: 6 }}>
          控え（3人）{!disabled && '— 選手をタップしてから入れ替え先をタップ'}
        </div>
        <div className="plist">
          {lineup.bench.map((id, i) => {
            const p = byId.get(id);
            return p ? <PlayerRow key={id} player={p} selected={sel?.kind === 'bench' && sel.index === i} onClick={disabled ? undefined : () => tap({ kind: 'bench', index: i })} right={<span className="chip">SUB</span>} /> : null;
          })}
        </div>
      </div>
    </div>
  );
}
