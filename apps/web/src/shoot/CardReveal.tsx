import { RARITY_INFO, type Player, type Rarity } from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShootAudio } from './audio';

/**
 * Card reveal after the goal (spec "SHOOT GACHA" 5): the net, a moment of
 * black, the card's silhouette, the card turning, the player revealed, the
 * rarity effect, then the name and the six stats. The card is the game's own
 * card image (no new card design).
 */

export interface RevealItem {
  playerId: string;
  rarity: Rarity;
  name: string;
  duplicate: boolean;
  enhancedTo: number | null;
  points: number;
}

type Stage = 'dark' | 'silhouette' | 'spin' | 'reveal' | 'info';
const STAGE_MS: Record<Exclude<Stage, 'info'>, number> = { dark: 350, silhouette: 650, spin: 1150, reveal: 650 };
const NEXT: Record<Exclude<Stage, 'info'>, Stage> = { dark: 'silhouette', silhouette: 'spin', spin: 'reveal', reveal: 'info' };

const STATS: { key: keyof Player['stats']; label: string }[] = [
  { key: 'pac', label: 'PAC' },
  { key: 'sho', label: 'SHO' },
  { key: 'pas', label: 'PAS' },
  { key: 'dri', label: 'DRI' },
  { key: 'def', label: 'DEF' },
  { key: 'phy', label: 'PHY' },
];

export function CardReveal({ items, catalog, audio, onFinish }: { items: RevealItem[]; catalog: Map<string, Player> | null; audio: ShootAudio | null; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>('dark');
  const timer = useRef<number | null>(null);
  const item = items[index];
  const player = catalog?.get(item.playerId) ?? null;

  useEffect(() => {
    if (stage === 'info') return;
    if (stage === 'spin') audio?.flip();
    if (stage === 'reveal') audio?.sting(item.rarity);
    timer.current = window.setTimeout(() => setStage(NEXT[stage]), STAGE_MS[stage]);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [stage, audio, item.rarity]);

  const next = useCallback(() => {
    if (stage !== 'info') {
      // a tap fast-forwards to the card
      if (timer.current) window.clearTimeout(timer.current);
      setStage('info');
      return;
    }
    if (index + 1 < items.length) {
      setIndex(index + 1);
      setStage('dark');
    } else onFinish();
  }, [stage, index, items.length, onFinish]);

  const tag = item.duplicate ? (item.enhancedTo !== null ? `強化 +${item.enhancedTo}` : `+${item.points}pt`) : 'NEW';
  return (
    <div className={`reveal rar-${item.rarity} stage-${stage}`} onClick={next} role="dialog" aria-label="カード登場">
      <div className="reveal-rays" aria-hidden="true" />
      <div className="reveal-sparks" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={{ ['--a' as string]: `${(i / 18) * 360}deg`, ['--d' as string]: `${0.4 + (i % 5) * 0.12}s` }} />
        ))}
      </div>
      <div className="reveal-count">
        {index + 1} / {items.length}
      </div>
      <div className="reveal-stage">
        <div className="reveal-card">
          <div className="face front">{player ? <PlayerCard player={player} width="100%" loading="eager" /> : <div className="card-missing">{item.name}</div>}</div>
          <div className="face back">
            <span>
              FOOTBALL
              <br />
              DRAFT
            </span>
          </div>
        </div>
      </div>
      <div className="reveal-label">{RARITY_INFO[item.rarity].label}</div>
      {stage === 'info' && (
        <div className="reveal-info" onClick={(e) => e.stopPropagation()}>
          <div className="spread">
            <div>
              <div className="reveal-name">{player?.name ?? item.name}</div>
              <div className="small muted">
                {player?.positions.join(' / ')}・OVR {player?.ovr}
              </div>
            </div>
            <span className={`chip ${item.duplicate ? '' : 'on'}`}>{tag}</span>
          </div>
          {player && (
            <div className="reveal-stats">
              {STATS.map((s) => (
                <div key={s.key}>
                  <span className="k">{s.label}</span>
                  <b>{player.stats[s.key]}</b>
                  <span className="bar">
                    <span style={{ width: `${player.stats[s.key]}%` }} />
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="button-row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={next}>
              {index + 1 < items.length ? '次のカード' : '結果を見る'}
            </button>
            {items.length > 1 && index + 1 < items.length && (
              <button className="btn ghost" onClick={onFinish}>
                まとめて表示
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
