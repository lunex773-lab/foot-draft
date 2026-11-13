import {
  CLUBS,
  CLUB_BY_ID,
  DISPLAY_KEYS,
  DISPLAY_LABELS,
  LEAGUES,
  LEAGUE_BY_ID,
  NATIONS,
  NATION_BY_CODE,
  POSITIONS,
  RARITIES,
  RARITY_INFO,
  ROLES,
  TRAITS,
  type Player,
  type Rarity,
} from '@fd/shared';
import { Flag, PlayerCard } from '@fd/ui';
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from './api';
import { CardDetail } from './CardDetail';

interface ListResponse {
  total: number;
  catalogTotal: number;
  counts: Record<Rarity, number>;
  items: Player[];
}

type Sort = 'ovr' | 'name' | 'rarity' | 'position' | 'id' | 'pac' | 'sho' | 'pas' | 'dri' | 'def' | 'phy';

/** カード一覧 — every player card with filters, grid (card design) and table views. */
export function CardsPage() {
  const [rarity, setRarity] = useState<Rarity | ''>('');
  const [position, setPosition] = useState('');
  const [league, setLeague] = useState('');
  const [club, setClub] = useState('');
  const [nation, setNation] = useState('');
  const [trait, setTrait] = useState('');
  const [role, setRole] = useState('');
  const [minOvr, setMinOvr] = useState('');
  const [maxOvr, setMaxOvr] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState<Sort>('ovr');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (rarity) p.set('rarity', rarity);
    if (position) p.set('position', position);
    if (league) p.set('league', league);
    if (club) p.set('club', club);
    if (nation) p.set('nation', nation);
    if (trait) p.set('trait', trait);
    if (role) p.set('role', role);
    if (minOvr) p.set('minOvr', minOvr);
    if (maxOvr) p.set('maxOvr', maxOvr);
    if (debouncedQ) p.set('q', debouncedQ);
    p.set('sort', sort);
    p.set('order', order);
    return p.toString();
  }, [rarity, position, league, club, nation, trait, role, minOvr, maxOvr, debouncedQ, sort, order]);

  useEffect(() => {
    let alive = true;
    adminApi<ListResponse>(`/cards?${query}`)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message)));
    return () => {
      alive = false;
    };
  }, [query]);

  const reset = () => {
    setRarity('');
    setPosition('');
    setLeague('');
    setClub('');
    setNation('');
    setTrait('');
    setRole('');
    setMinOvr('');
    setMaxOvr('');
    setQ('');
  };

  const sortBy = (s: Sort) => {
    if (s === sort) setOrder(order === 'desc' ? 'asc' : 'desc');
    else {
      setSort(s);
      setOrder(s === 'name' || s === 'id' || s === 'position' ? 'asc' : 'desc');
    }
  };

  return (
    <div>
      <div className="spread">
        <h1>カード一覧</h1>
        <div className="row small muted">
          {data && `表示 ${data.total} / 全 ${data.catalogTotal} 枚`}
          <button className={`btn ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')}>
            カード表示
          </button>
          <button className={`btn ${view === 'table' ? 'on' : ''}`} onClick={() => setView('table')}>
            表で表示
          </button>
        </div>
      </div>
      <div className="stat-chips">
        <button className={`stat-chip ${rarity === '' ? 'on' : ''}`} onClick={() => setRarity('')}>
          <div className="tiny muted">全レアリティ</div>
          <div className="n">{data?.catalogTotal ?? '-'}</div>
        </button>
        {RARITIES.map((r) => (
          <button key={r} className={`stat-chip ${rarity === r ? 'on' : ''}`} onClick={() => setRarity(rarity === r ? '' : r)}>
            <div className={`tiny rar-${r}`}>
              {RARITY_INFO[r].label}（{RARITY_INFO[r].ovrMin}〜{RARITY_INFO[r].ovrMax}）
            </div>
            <div className={`n rar-${r}`}>{data?.counts[r] ?? '-'}</div>
          </button>
        ))}
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="filters">
          <label>
            検索（名前・ID・クラブ・国）
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="例：Moretti / fd0004" />
          </label>
          <label>
            ポジション
            <select value={position} onChange={(e) => setPosition(e.target.value)}>
              <option value="">すべて</option>
              {POSITIONS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            リーグ
            <select
              value={league}
              onChange={(e) => {
                setLeague(e.target.value);
                setClub('');
              }}
            >
              <option value="">すべて</option>
              {LEAGUES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            クラブ
            <select value={club} onChange={(e) => setClub(e.target.value)}>
              <option value="">すべて</option>
              {CLUBS.filter((c) => !league || c.leagueId === league).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            国籍
            <select value={nation} onChange={(e) => setNation(e.target.value)}>
              <option value="">すべて</option>
              {NATIONS.map((n) => (
                <option key={n.code} value={n.code}>
                  {n.nameJa}
                </option>
              ))}
            </select>
          </label>
          <label>
            特殊能力
            <select value={trait} onChange={(e) => setTrait(e.target.value)}>
              <option value="">すべて</option>
              {Object.values(TRAITS).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nameJa}
                </option>
              ))}
            </select>
          </label>
          <label>
            プレースタイル
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">すべて</option>
              {Object.values(ROLES).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nameJa}
                </option>
              ))}
            </select>
          </label>
          <label>
            OVR 下限 / 上限
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <input value={minOvr} onChange={(e) => setMinOvr(e.target.value.replace(/\D/g, ''))} style={{ width: '50%' }} inputMode="numeric" />
              <input value={maxOvr} onChange={(e) => setMaxOvr(e.target.value.replace(/\D/g, ''))} style={{ width: '50%' }} inputMode="numeric" />
            </span>
          </label>
          <label>
            並び替え
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ flex: 1 }}>
                <option value="ovr">OVR</option>
                <option value="rarity">レアリティ</option>
                <option value="name">名前</option>
                <option value="position">ポジション</option>
                <option value="id">ID</option>
                {DISPLAY_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {DISPLAY_LABELS[k]}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')} title="昇順/降順">
                {order === 'desc' ? '↓' : '↑'}
              </button>
            </span>
          </label>
        </div>
        <button className="btn small" onClick={reset}>
          条件をリセット
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {!data && !error && <div className="muted">読み込み中…</div>}
      {data && data.items.length === 0 && <div className="muted">条件に合うカードがありません。</div>}
      {data && view === 'grid' && (
        <div className="cards">
          {data.items.map((p) => (
            <div key={p.id} style={{ textAlign: 'center' }}>
              <PlayerCard player={p} width="100%" showLabel onClick={() => setSelected(p.id)} />
              <div className="tiny muted" style={{ marginTop: 4 }}>
                {p.id}
              </div>
            </div>
          ))}
        </div>
      )}
      {data && view === 'table' && (
        <div className="panel scroll-x">
          <table>
            <thead>
              <tr>
                <th onClick={() => sortBy('id')}>ID</th>
                <th onClick={() => sortBy('name')}>名前</th>
                <th onClick={() => sortBy('rarity')}>レアリティ</th>
                <th onClick={() => sortBy('position')}>POS</th>
                <th className="num" onClick={() => sortBy('ovr')}>
                  OVR
                </th>
                {DISPLAY_KEYS.map((k) => (
                  <th key={k} className="num" onClick={() => sortBy(k)}>
                    {DISPLAY_LABELS[k]}
                  </th>
                ))}
                <th>国籍</th>
                <th>リーグ / クラブ</th>
                <th>プレースタイル</th>
                <th>特殊能力</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} onClick={() => setSelected(p.id)}>
                  <td className="muted">{p.id}</td>
                  <td>{p.name}</td>
                  <td className={`rar-${p.rarity}`}>{RARITY_INFO[p.rarity].label}</td>
                  <td>{p.positions.join(' / ')}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {p.ovr}
                  </td>
                  {DISPLAY_KEYS.map((k) => (
                    <td key={k} className="num">
                      {p.stats[k]}
                    </td>
                  ))}
                  <td>
                    <span className="row" style={{ flexWrap: 'nowrap' }}>
                      <Flag code={p.nationality} width={18} /> {NATION_BY_CODE[p.nationality]?.nameJa}
                    </span>
                  </td>
                  <td>
                    {LEAGUE_BY_ID[p.leagueId]?.name} / {CLUB_BY_ID[p.clubId]?.name}
                  </td>
                  <td>{ROLES[p.role].nameJa}</td>
                  <td>{p.traits.map((t) => TRAITS[t].nameJa).join('・')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <CardDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
