import { CLUBS, LEAGUES, POSITION_GROUP, RARITIES, RARITY_INFO, enhancePlayer, type Player, type PositionGroup, type Rarity } from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CardDetail, LevelTag } from '../components/CardDetail';
import { useCatalog } from '../lib/catalog';
import { setFavorite, useTeam, type TeamCard } from '../lib/team';

type Sort = 'ovr' | 'rarity' | 'new' | 'level';
const RARITY_ORDER: Record<Rarity, number> = { icon: 0, legendary: 1, epic: 2, rare: 3, common: 4 };

/**
 * 選手図鑑 (user request, 2026-11-17): owned cards or every card. Tapping an
 * owned card opens its details; cards one does not own are grey and cannot be opened.
 */
export default function CatalogPage() {
  const catalog = useCatalog();
  const { data, setData } = useTeam();
  const [view, setView] = useState<'owned' | 'all'>('owned');
  const [rarity, setRarity] = useState<Rarity | 'all'>('all');
  const [group, setGroup] = useState<'ALL' | PositionGroup>('ALL');
  const [league, setLeague] = useState('all');
  const [favOnly, setFavOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('ovr');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const owned = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.playerId, c])), [data]);
  if (!catalog || !data) return <div className="muted">読み込み中…</div>;

  const ovrOf = (p: Player) => enhancePlayer(p, owned.get(p.id)?.level ?? 0).ovr;
  const list = [...catalog.values()]
    .filter((p) => view === 'all' || owned.has(p.id))
    .filter((p) => (rarity === 'all' || p.rarity === rarity) && (group === 'ALL' || POSITION_GROUP[p.primaryPosition] === group) && (league === 'all' || p.leagueId === league))
    .filter((p) => !favOnly || owned.get(p.id)?.favorite)
    .filter((p) => !q || `${p.name} ${CLUBS.find((c) => c.id === p.clubId)?.name}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      const oa = owned.get(a.id);
      const ob = owned.get(b.id);
      if (view === 'all' && !!oa !== !!ob) return oa ? -1 : 1;
      if (sort === 'rarity') return RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || ovrOf(b) - ovrOf(a);
      if (sort === 'new') return (ob?.obtainedAt ?? 0) - (oa?.obtainedAt ?? 0) || ovrOf(b) - ovrOf(a);
      if (sort === 'level') return (ob?.level ?? 0) - (oa?.level ?? 0) || ovrOf(b) - ovrOf(a);
      return ovrOf(b) - ovrOf(a) || a.id.localeCompare(b.id);
    });
  const ownedByRarity = (r: Rarity) => data.cards.filter((c) => catalog.get(c.playerId)?.rarity === r).length;
  const totalByRarity = (r: Rarity) => [...catalog.values()].filter((p) => p.rarity === r).length;
  const detail = open ? catalog.get(open) : null;
  const detailOwned = open ? owned.get(open) : null;

  const toggleFavorite = async (c: TeamCard, fav: boolean) => {
    const r = await setFavorite(c.playerId, fav).catch(() => null);
    if (r) setData({ ...data, cards: data.cards.map((x) => (x.playerId === c.playerId ? { ...x, favorite: r.favorite } : x)) });
  };

  return (
    <div className="screen">
      <div className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>
            選手図鑑 <span className="small muted">所持 {data.cards.length} / {catalog.size}</span>
          </h2>
          <div className="tabs" role="tablist" aria-label="表示">
            <button role="tab" aria-selected={view === 'owned'} className={view === 'owned' ? 'on' : ''} onClick={() => setView('owned')}>
              所持カード
            </button>
            <button role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>
              全カード
            </button>
          </div>
        </div>
        <div className="chip-row" style={{ marginTop: 8 }}>
          {RARITIES.map((r) => (
            <span key={r} className={`chip rar-${r}`}>
              {RARITY_INFO[r].label} {ownedByRarity(r)}/{totalByRarity(r)}
            </span>
          ))}
        </div>
        <div className="filters">
          <input placeholder="名前・クラブで検索" value={q} onChange={(e) => setQ(e.target.value)} aria-label="検索" />
          <select value={rarity} onChange={(e) => setRarity(e.target.value as Rarity | 'all')} aria-label="レアリティ">
            <option value="all">全レアリティ</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {RARITY_INFO[r].label}
              </option>
            ))}
          </select>
          <select value={group} onChange={(e) => setGroup(e.target.value as 'ALL' | PositionGroup)} aria-label="ポジション">
            <option value="ALL">全ポジション</option>
            {(['GK', 'DF', 'MF', 'FW'] as const).map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select value={league} onChange={(e) => setLeague(e.target.value)} aria-label="リーグ">
            <option value="all">全リーグ</option>
            {LEAGUES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="並べ替え">
            <option value="ovr">OVR順</option>
            <option value="rarity">レアリティ順</option>
            <option value="level">強化順</option>
            <option value="new">入手順</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} /> ★のみ
          </label>
        </div>
      </div>

      {list.length === 0 && (
        <div className="panel small muted">
          該当するカードがありません。カードは<Link to="/gacha">ガシャ</Link>や<Link to="/exchange">交換所</Link>で手に入ります。
        </div>
      )}
      <div className="card-grid">
        {list.map((p) => {
          const o = owned.get(p.id);
          return (
            <div key={p.id} className={`card-cell ${o ? '' : 'unowned'}`}>
              <PlayerCard
                player={p}
                width="100%"
                disabled={!o}
                onClick={o ? () => setOpen(p.id) : undefined}
                title={o ? `${p.name}（タップで詳細）` : `${p.name}（未所持）`}
              />
              {o && (
                <span className="card-tags">
                  <LevelTag level={o.level} />
                  {o.favorite && <span className="fav-tag">★</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {detail && detailOwned && <CardDetail player={detail} owned={detailOwned} onClose={() => setOpen(null)} onFavorite={(f) => toggleFavorite(detailOwned, f)} />}
    </div>
  );
}
