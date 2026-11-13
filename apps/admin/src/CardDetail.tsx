import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS_JA,
  DISPLAY_KEYS,
  DISPLAY_LABELS_JA,
  POSITIONS,
  RARITY_INFO,
  ROLES,
  TRAITS,
  positionRatings,
  type ClubInfo,
  type LeagueInfo,
  type NationInfo,
  type Player,
} from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useEffect, useState } from 'react';
import { adminApi } from './api';

interface Detail {
  player: Player;
  league: LeagueInfo;
  club: ClubInfo;
  nation: NationInfo;
  draftStats: { picks: number; autoPicks: number; avgPickNo: number | null };
}

function color(v: number) {
  return v >= 85 ? '#3ec7b4' : v >= 70 ? '#8bd17c' : v >= 55 ? '#e3bf5e' : '#ff8a65';
}

export function CardDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminApi<Detail>(`/cards/${id}`)
      .then(setD)
      .catch((e) => setError(String(e.message)));
  }, [id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="カード詳細">
        <div className="spread" style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0 }}>{d ? d.player.name : 'カード詳細'}</h1>
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {d && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)', gap: 20 }}>
            <div>
              <PlayerCard player={d.player} width="100%" loading="eager" />
              <div className="tiny muted" style={{ marginTop: 6 }}>
                画像：{d.player.cardAsset}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="panel">
                <dl className="kv">
                  <dt>ID</dt>
                  <dd>{d.player.id}</dd>
                  <dt>レアリティ</dt>
                  <dd className={`rar-${d.player.rarity}`}>
                    {RARITY_INFO[d.player.rarity].label}（目安 OVR {RARITY_INFO[d.player.rarity].ovrMin}〜{RARITY_INFO[d.player.rarity].ovrMax}）
                  </dd>
                  <dt>ポジション</dt>
                  <dd>{d.player.positions.join(' / ')}（主：{d.player.primaryPosition}）</dd>
                  <dt>国籍</dt>
                  <dd>{d.nation.nameJa}</dd>
                  <dt>リーグ / クラブ</dt>
                  <dd>
                    {d.league.name} / {d.club.name}
                  </dd>
                  <dt>年齢・身長</dt>
                  <dd>
                    {d.player.age}歳・{d.player.heightCm}cm
                  </dd>
                  <dt>プレースタイル（自動判定）</dt>
                  <dd>
                    {ROLES[d.player.role].nameJa} — <span className="muted">{ROLES[d.player.role].descriptionJa}</span>
                  </dd>
                  <dt>ドラフト実績</dt>
                  <dd>
                    指名 {d.draftStats.picks}回（自動 {d.draftStats.autoPicks}回）・平均指名順 {d.draftStats.avgPickNo ?? '-'}
                  </dd>
                </dl>
              </div>
              <div className="panel">
                <h3>特殊能力（データベースの値・発動条件）</h3>
                {d.player.traits.map((t) => (
                  <div key={t} className="small" style={{ marginBottom: 6 }}>
                    <b>{TRAITS[t].nameJa}</b>（{TRAITS[t].name}）<div className="muted">{TRAITS[t].effectJa}</div>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h3>表示能力（データベースの値）</h3>
                {DISPLAY_KEYS.map((k) => (
                  <div className="attr" key={k}>
                    <span>{DISPLAY_LABELS_JA[k]}</span>
                    <div className="bar">
                      <div style={{ width: `${d.player.stats[k]}%`, background: color(d.player.stats[k]) }} />
                    </div>
                    <span style={{ textAlign: 'right' }}>{d.player.stats[k]}</span>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h3>内部能力（SIM専用・19項目）</h3>
                {ATTRIBUTE_KEYS.map((k) => (
                  <div className="attr" key={k}>
                    <span>{ATTRIBUTE_LABELS_JA[k]}</span>
                    <div className="bar">
                      <div style={{ width: `${d.player.attributes[k]}%`, background: color(d.player.attributes[k]) }} />
                    </div>
                    <span style={{ textAlign: 'right' }}>{d.player.attributes[k]}</span>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h3>ポジション別評価（主ポジション＝カードのOVR。適性外はペナルティ込み）</h3>
                <div className="row">
                  {POSITIONS.map((pos) => {
                    const r = positionRatings(d.player)[pos];
                    return (
                      <span key={pos} className="small" style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', color: d.player.positions.includes(pos) ? 'var(--accent)' : undefined }}>
                        {pos} <b>{r}</b>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
