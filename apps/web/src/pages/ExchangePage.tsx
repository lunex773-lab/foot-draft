import { RARITY_INFO, type Player, type Rarity } from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useCatalog } from '../lib/catalog';
import { errorText, formatDateTime } from '../lib/labels';
import { fmt, newRequestId, useWallet, type Wallet } from '../lib/wallet';
import { POINT_LABEL } from './GachaPage';

type PointType = 'standard' | 'premium';

interface Catalog {
  points: { standard: number; premium: number };
  sections: { pointType: PointType; prices: { rarity: Rarity; price: number }[]; cards: { playerId: string; rarity: Rarity; price: number }[] }[];
}

interface HistoryRow {
  id: string;
  point_type: PointType;
  player_id: string;
  name: string;
  rarity: Rarity;
  price: number;
  created_at: number;
}

/** Exchange shop (spec 9-5, decision 43): cards for duplicate points. */
export default function ExchangePage() {
  const catalog = useCatalog();
  const { setWallet } = useWallet();
  const [data, setData] = useState<Catalog | null>(null);
  const [tab, setTab] = useState<PointType>('standard');
  const [rarity, setRarity] = useState<Rarity | 'all'>('all');
  const [confirm, setConfirm] = useState<{ player: Player; price: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const load = () => {
    api<Catalog>('/api/exchange/catalog').then(setData).catch(() => undefined);
    api<{ items: HistoryRow[] }>('/api/exchange/history')
      .then((r) => setHistory(r.items))
      .catch(() => undefined);
  };
  useEffect(load, []);

  if (!data || !catalog) return <div className="muted">読み込み中…</div>;
  const section = data.sections.find((s) => s.pointType === tab)!;
  const have = data.points[tab];
  const cards = section.cards.filter((c) => rarity === 'all' || c.rarity === rarity);

  const redeem = async () => {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ playerId: string; wallet: Wallet }>('/api/exchange/redeem', { body: { playerId: confirm.player.id, pointType: tab, requestId: newRequestId() } });
      setWallet(r.wallet);
      setMsg(`${confirm.player.name} を手に入れました`);
      setConfirm(null);
      load();
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>交換所</h2>
          <div className="row small">
            <span className="chip">Standardポイント {fmt(data.points.standard)}</span>
            <span className="chip on">Premiumポイント {fmt(data.points.premium)}</span>
          </div>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          ガシャで所持済みのカードが出ると、そのガシャの種類のポイントになります。Standardポイントは Common〜Legendary、Premiumポイントは Rare〜Icon のまだ持っていないカードと交換できます。
        </div>
      </div>
      <div className="panel">
        <div className="spread" style={{ marginBottom: 10 }}>
          <div className="tabs">
            {(['standard', 'premium'] as const).map((t) => (
              <button
                key={t}
                className={tab === t ? 'on' : ''}
                onClick={() => {
                  setTab(t);
                  setRarity('all');
                }}
              >
                {POINT_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="tabs">
            <button className={rarity === 'all' ? 'on' : ''} onClick={() => setRarity('all')}>
              すべて
            </button>
            {section.prices.map((p) => (
              <button key={p.rarity} className={rarity === p.rarity ? 'on' : ''} onClick={() => setRarity(p.rarity)}>
                {RARITY_INFO[p.rarity].label} {fmt(p.price)}pt
              </button>
            ))}
          </div>
        </div>
        {msg && <div className="small" style={{ color: 'var(--good)', marginBottom: 8 }}>{msg}</div>}
        {cards.length === 0 && <div className="small muted">交換できるカードはありません（すべて所持済み）。</div>}
        <div className="pool">
          {cards.map((c) => {
            const p = catalog.get(c.playerId);
            if (!p) return null;
            const affordable = have >= c.price;
            return (
              <div className="slot" key={c.playerId}>
                <PlayerCard player={p} width="100%" disabled={!affordable} onClick={() => setConfirm({ player: p, price: c.price })} />
                <div className="tiny" style={{ textAlign: 'center', marginTop: 4, color: affordable ? 'var(--gold)' : 'var(--muted)' }}>
                  {fmt(c.price)} pt
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {history.length > 0 && (
        <div className="panel">
          <h3>交換の履歴</h3>
          {history.map((h) => (
            <div key={h.id} className="spread small" style={{ padding: '4px 0' }}>
              <span>
                {formatDateTime(h.created_at)}　{h.name}（<span className={`rar-${h.rarity}`}>{RARITY_INFO[h.rarity].label}</span>）
              </span>
              <span className="muted">
                {POINT_LABEL[h.point_type]} -{fmt(h.price)}
              </span>
            </div>
          ))}
        </div>
      )}
      {confirm && (
        <div className="modal-bg" onClick={() => setConfirm(null)}>
          <div className="modal panel" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <PlayerCard player={confirm.player} width={200} style={{ margin: '0 auto' }} />
            <p className="small" style={{ textAlign: 'center' }}>
              {POINT_LABEL[tab]} {fmt(confirm.price)} と交換しますか？（所持 {fmt(have)}）
            </p>
            {error && <div className="error">{error}</div>}
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                やめる
              </button>
              <button className="btn primary" disabled={busy || have < confirm.price} onClick={redeem}>
                {have < confirm.price ? 'ポイントが足りません' : '交換する'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="row small" style={{ justifyContent: 'center' }}>
        <Link to="/gacha">ガシャ</Link>
        <Link to="/cards">選手図鑑</Link>
      </div>
    </div>
  );
}
