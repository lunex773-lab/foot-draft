import { RARITIES, RARITY_INFO, type Player, type Rarity } from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PlayerRow } from '../components/PlayerRow';
import { api } from '../lib/api';
import { useCatalog } from '../lib/catalog';
import { errorText } from '../lib/labels';

interface CollectionData {
  items: { playerId: string; source: 'gacha' | 'exchange' | 'test_grant'; obtainedAt: number }[];
  roster: (string | null)[];
  slots: number;
  counts: { owned: number; total: number; ownedByRarity: Record<Rarity, number>; totalByRarity: Record<Rarity, number> };
}

const SOURCE_LABEL = { gacha: 'ガシャ', exchange: '交換所', test_grant: 'テスト付与' } as const;

/** Owned cards and the Collection Draft roster (decision 36). */
export default function CollectionPage() {
  const catalog = useCatalog();
  const nav = useNavigate();
  const [data, setData] = useState<CollectionData | null>(null);
  const [view, setView] = useState<'owned' | 'all'>('owned');
  const [rarity, setRarity] = useState<Rarity | 'all'>('all');
  const [roster, setRoster] = useState<string[]>([]);
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CollectionData>('/api/collection')
      .then((d) => {
        setData(d);
        setRoster(d.roster.filter((x): x is string => !!x));
      })
      .catch(() => undefined);
  }, []);

  if (!data || !catalog) return <div className="muted">読み込み中…</div>;
  const owned = new Map(data.items.map((i) => [i.playerId, i]));
  const list = [...catalog.values()]
    .filter((p) => (view === 'all' || owned.has(p.id)) && (rarity === 'all' || p.rarity === rarity))
    .sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));

  const toggle = (p: Player) => {
    if (!owned.has(p.id)) return;
    setMsg(null);
    setSaved(false);
    setRoster((r) => (r.includes(p.id) ? r.filter((x) => x !== p.id) : r.length >= data.slots ? r : [...r, p.id]));
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ roster: (string | null)[] }>('/api/collection/roster', { method: 'PUT', body: { playerIds: roster } });
      setRoster(r.roster.filter((x): x is string => !!x));
      setSaved(true);
      setMsg('専用枠を保存しました');
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const play = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!saved) await api('/api/collection/roster', { method: 'PUT', body: { playerIds: roster } });
      const r = await api<{ roomId: string }>('/api/collection/draft/quick', { body: {} });
      nav(`/room/${r.roomId}`);
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>
            コレクション（{data.counts.owned} / {data.counts.total}）
          </h2>
          <div className="row small">
            <Link to="/gacha">ガシャ</Link>
            <Link to="/exchange">交換所</Link>
          </div>
        </div>
        <div className="row tiny" style={{ marginTop: 8 }}>
          {RARITIES.map((r) => (
            <span key={r} className={`chip rar-${r}`}>
              {RARITY_INFO[r].label} {data.counts.ownedByRarity[r]} / {data.counts.totalByRarity[r]}
            </span>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Collection Draft の専用枠（最大{data.slots}枚）</h3>
          <div className="row">
            <button className="btn small" disabled={busy || saved} onClick={save}>
              専用枠を保存
            </button>
            <button className="btn primary small" disabled={busy} onClick={play}>
              Collection Draft で遊ぶ
            </button>
          </div>
        </div>
        <div className="small muted" style={{ margin: '6px 0 10px' }}>
          登録したカードは Collection Draft の候補に入り、あなただけが指名できます（14回の指名のうち1回を使います）。ほかの人も同じカードを登録していた場合は、登録した人の中で先に指名した人のものになります。ランク戦などほかのモードでは使われません。下の一覧で所持カードをクリックして選びます。
        </div>
        <div className="grid3">
          {Array.from({ length: data.slots }, (_, i) => {
            const p = roster[i] ? catalog.get(roster[i]) : null;
            return (
              <div key={i} className="roster-slot">
                {p ? <PlayerRow player={p} right={<button className="btn small ghost" onClick={() => toggle(p)}>外す</button>} /> : <span className="muted small">空き枠 {i + 1}</span>}
              </div>
            );
          })}
        </div>
        {msg && <div className="small" style={{ color: 'var(--good)', marginTop: 8 }}>{msg}</div>}
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <div className="panel">
        <div className="spread" style={{ marginBottom: 10 }}>
          <div className="tabs">
            <button className={view === 'owned' ? 'on' : ''} onClick={() => setView('owned')}>
              所持カード
            </button>
            <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>
              全カード
            </button>
          </div>
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
        </div>
        {list.length === 0 && (
          <div className="small muted">
            まだカードを持っていません。<Link to="/gacha">ガシャ</Link>や<Link to="/exchange">交換所</Link>で手に入ります。
          </div>
        )}
        <div className="pool">
          {list.map((p) => {
            const o = owned.get(p.id);
            const inRoster = roster.includes(p.id);
            return (
              <div className="slot" key={p.id}>
                <PlayerCard player={p} width="100%" disabled={!o} selected={inRoster} onClick={o ? () => toggle(p) : undefined} title={o ? `${SOURCE_LABEL[o.source]}で入手` : '未所持'} />
                {inRoster && <span className="reserved-tag">専用枠</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
