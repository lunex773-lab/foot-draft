import { CLUB_BY_ID, LEAGUE_BY_ID, MATCH_CONFIG, NATION_BY_CODE, RARITY_INFO, ROLES, TRAITS, enhancePlayer, type Player } from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useEffect } from 'react';

export interface OwnedInfo {
  level: number;
  favorite: boolean;
  source: string;
  obtainedAt: number;
}

export const SOURCE_LABEL: Record<string, string> = { gacha: 'ガシャ', exchange: '交換所', test_grant: 'テスト付与', season_pass: 'Season Pass', starter: '初期選手' };

const STATS: { key: keyof Player['stats']; label: string }[] = [
  { key: 'pac', label: 'PAC' },
  { key: 'sho', label: 'SHO' },
  { key: 'pas', label: 'PAS' },
  { key: 'dri', label: 'DRI' },
  { key: 'def', label: 'DEF' },
  { key: 'phy', label: 'PHY' },
];

/** strengthening level as a small tag ("+3", "MAX" at +5) */
export function LevelTag({ level }: { level: number }) {
  if (!level) return null;
  return <span className={`lv-tag ${level >= MATCH_CONFIG.maxLevel ? 'max' : ''}`}>{level >= MATCH_CONFIG.maxLevel ? 'MAX' : `+${level}`}</span>;
}

/**
 * Card details (選手図鑑 / チーム): the card, its six stats and special abilities.
 * Owned cards show the strengthening level (MATCH only, decision 70).
 */
export function CardDetail({ player, owned, onClose, onFavorite }: { player: Player; owned: OwnedInfo; onClose: () => void; onFavorite?: (fav: boolean) => void }) {
  const p = enhancePlayer(player, owned.level);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const club = CLUB_BY_ID[player.clubId];
  const league = LEAGUE_BY_ID[player.leagueId];
  const nation = NATION_BY_CODE[player.nationality];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal card-detail panel" role="dialog" aria-modal="true" aria-label={`${player.name} の詳細`} onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <span className={`chip rar-${player.rarity}`}>{RARITY_INFO[player.rarity].label}</span>
          <button className="btn small ghost" onClick={onClose} aria-label="閉じる">
            閉じる
          </button>
        </div>
        <div className="cd-top">
          <PlayerCard player={player} width="100%" loading="eager" className="cd-card" />
          <div className="cd-head">
            <h2>{player.name}</h2>
            <div className="cd-ovr">
              <span className="display">{p.ovr}</span>
              <span className="small muted">OVR</span>
              <LevelTag level={owned.level} />
            </div>
            <div className="small muted">
              {player.positions.join(' / ')}・{player.age}歳・{player.heightCm}cm
            </div>
            <div className="small muted">
              {nation?.nameJa ?? player.nationality}・{club?.name ?? player.clubId}
              {league ? `（${league.name}）` : ''}
            </div>
            <div className="small muted">プレースタイル：{ROLES[player.role]?.nameJa ?? player.role}</div>
          </div>
        </div>

        <div className="cd-stats">
          {STATS.map((s) => (
            <div key={s.key} className="cd-stat">
              <span className="k">{s.label}</span>
              <span className="v">
                {p.stats[s.key]}
                {owned.level > 0 && <span className="tiny plus">+{p.stats[s.key] - player.stats[s.key]}</span>}
              </span>
              <span className="bar">
                <span style={{ width: `${p.stats[s.key]}%` }} />
              </span>
            </div>
          ))}
        </div>

        <h3>特殊能力</h3>
        {player.traits.length === 0 && <div className="small muted">なし（特殊能力は EPIC 以上のカードだけが持っています）</div>}
        <div className="list">
          {player.traits.map((t) => (
            <div key={t} className={`list-item block${TRAITS[t]?.iconOnly ? ' trait-icon' : ''}`}>
              <strong>
                {TRAITS[t]?.nameJa ?? t}
                {TRAITS[t]?.iconOnly && <span className="chip trait-icon-chip">ICON 専用</span>}
              </strong>
              <span className="small muted">{(TRAITS[t]?.effectJa ?? '').replace(/^【ICON専用】/, '')}</span>
            </div>
          ))}
        </div>

        <h3>強化</h3>
        <div className="lv-meter" aria-label={`強化 +${owned.level} / +${MATCH_CONFIG.maxLevel}`}>
          {Array.from({ length: MATCH_CONFIG.maxLevel }, (_, i) => (
            <span key={i} className={i < owned.level ? 'on' : ''} />
          ))}
          <b>
            +{owned.level} / +{MATCH_CONFIG.maxLevel}
          </b>
        </div>
        <div className="tiny muted" style={{ marginTop: 4 }}>
          ガシャで同じカードが出ると +1（OVR・能力値がそれぞれ +1）。+{MATCH_CONFIG.maxLevel} の後は交換ポイントになります。強化は MATCH で使われます。
        </div>

        <div className="spread" style={{ marginTop: 12 }}>
          <span className="small muted">
            {SOURCE_LABEL[owned.source] ?? owned.source}で入手・{new Date(owned.obtainedAt).toLocaleDateString('ja-JP')}
          </span>
          {onFavorite && (
            <button className={`btn small ${owned.favorite ? 'primary' : ''}`} onClick={() => onFavorite(!owned.favorite)} aria-pressed={owned.favorite}>
              {owned.favorite ? '★ お気に入り' : '☆ お気に入り'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
