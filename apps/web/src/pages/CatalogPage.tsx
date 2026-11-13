import { CLUBS, LEAGUES, RARITIES, RARITY_INFO, type Player, type PositionGroup, POSITION_GROUP } from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useState } from 'react';
import { useCatalog } from '../lib/catalog';

/** 選手図鑑: all cards in the game (data from the server). */
export default function CatalogPage() {
  const catalog = useCatalog();
  const [rarity, setRarity] = useState<string>('all');
  const [group, setGroup] = useState<'ALL' | PositionGroup>('ALL');
  const [league, setLeague] = useState('all');
  const [q, setQ] = useState('');
  if (!catalog) return <div className="muted">読み込み中…</div>;
  const list = [...catalog.values()]
    .filter((p: Player) => (rarity === 'all' || p.rarity === rarity) && (group === 'ALL' || POSITION_GROUP[p.primaryPosition] === group) && (league === 'all' || p.leagueId === league))
    .filter((p) => !q || `${p.name} ${CLUBS.find((c) => c.id === p.clubId)?.name}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="spread">
          <h2 style={{ margin: 0 }}>選手図鑑（{list.length} / {catalog.size}）</h2>
          <input placeholder="名前・クラブで検索" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <div className="tabs">
            <button className={rarity === 'all' ? 'on' : ''} onClick={() => setRarity('all')}>
              全レアリティ
            </button>
            {RARITIES.map((r) => (
              <button key={r} className={rarity === r ? 'on' : ''} onClick={() => setRarity(r)}>
                {RARITY_INFO[r].label}
              </button>
            ))}
          </div>
          <div className="tabs">
            {(['ALL', 'GK', 'DF', 'MF', 'FW'] as const).map((g) => (
              <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>
                {g === 'ALL' ? '全ポジション' : g}
              </button>
            ))}
          </div>
          <select value={league} onChange={(e) => setLeague(e.target.value)} aria-label="リーグ">
            <option value="all">全リーグ</option>
            {LEAGUES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="pool" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {list.map((p) => (
          <PlayerCard key={p.id} player={p} width="100%" showLabel />
        ))}
      </div>
    </div>
  );
}
