import { formatAuctionDuration } from '@fd/shared';
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from './api';
import { promptDialog } from './dialog';
import { StatTile, fmtInt } from './charts';

/**
 * PLAYER AUCTION (spec 7, decisions 97-106): figures, prices by player and
 * rarity, unsold players, lots, bids, balances, fraud log, and the operation
 * (open / pause, listing mode and queue, numbers, cancel a lot).
 */
const RARITIES = ['common', 'rare', 'epic', 'legendary', 'icon'] as const;
type Rarity = (typeof RARITIES)[number];
const RARITY_LABEL: Record<Rarity, string> = { common: 'COMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY', icon: 'ICON' };
const STATUS_LABEL: Record<string, string> = { open: '開催中', sold: '落札', unsold: '未落札', cancelled: '取り消し' };
const time = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—');
const n = (v: unknown) => (typeof v === 'number' ? fmtInt(v) : '—');
const duration = formatAuctionDuration;

interface Settings {
  open: boolean;
  mode: 'random' | 'manual';
  pauseWhenIdle: boolean;
  initialFunds: number;
  concurrentLots: number;
  bidSeconds: number;
  extendWindowSeconds: number;
  extendSeconds: number;
  minRaisePercent: number;
  minRaiseAmount: number;
  startPrice: Record<Rarity, number>;
  coinsPerGem: number;
}

interface MarketLot {
  id: string;
  no: number;
  playerId: string;
  rarity: Rarity;
  endsAt: number;
  currentPrice: number | null;
  leaderName: string | null;
  bidCount: number;
  source: string;
}

interface Overview {
  days: number;
  totals: { sold: number; totalPrice: number; averagePrice: number; maxPrice: number; bids: number; bidders: number };
  byRarity: { rarity: Rarity; sold: number; averagePrice: number; minPrice: number; maxPrice: number }[];
  lots: Record<string, number>;
  wallets: { users: number; balance: number; held: number };
  exchange: { count: number; coins: number };
  fraud24h: Record<string, number>;
  market: { settings: Settings; connections: number; lots: MarketLot[]; bagRemaining: number; catalogSize: number; serverNow: number };
}

type Tab = 'overview' | 'players' | 'lots' | 'bids' | 'balances' | 'fraud' | 'operate';

export function AuctionAdminPage({ canWrite, canUsers }: { canWrite: boolean; canUsers: boolean }) {
  const [tab, setTab] = useState<Tab>('overview');
  const tabs: [Tab, string, boolean][] = [
    ['overview', '概要', true],
    ['players', '選手別・未落札', true],
    ['lots', '出品の履歴', true],
    ['bids', '入札履歴', canUsers],
    ['balances', 'プレイヤー別残高', canUsers],
    ['fraud', '不正検知ログ', canUsers],
    ['operate', '運営・設定', true],
  ];
  return (
    <div>
      <h1>オークション</h1>
      <div className="seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs
          .filter(([, , show]) => show)
          .map(([t, label]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
      </div>
      {tab === 'overview' && <OverviewTab canWrite={canWrite} />}
      {tab === 'players' && <PlayersTab />}
      {tab === 'lots' && <LotsTab />}
      {tab === 'bids' && canUsers && <BidsTab />}
      {tab === 'balances' && canUsers && <BalancesTab />}
      {tab === 'fraud' && canUsers && <FraudTab />}
      {tab === 'operate' && <OperateTab canWrite={canWrite} />}
    </div>
  );
}

function DaysPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="seg">
      {[1, 7, 30, 90].map((d) => (
        <button key={d} className={days === d ? 'on' : ''} onClick={() => onChange(d)}>
          {d === 1 ? '24時間' : `${d}日`}
        </button>
      ))}
    </div>
  );
}

function OverviewTab({ canWrite }: { canWrite: boolean }) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () =>
    adminApi<Overview>(`/auction/overview?days=${days}`)
      .then(setD)
      .catch((e) => setErr((e as Error).message));
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
  if (err) return <div className="error">{err}</div>;
  if (!d) return <div className="muted">読み込み中…</div>;
  const m = d.market;
  const cancel = async (lot: MarketLot) => {
    const reason = await promptDialog(`#${lot.no} を取り消します（仮押さえは解除され、だれも支払いません）。理由：`, '', { okLabel: '取り消す' });
    if (reason === null) return;
    await adminApi(`/auction/lots/${lot.id}/cancel`, { reason });
    load();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DaysPicker days={days} onChange={setDays} />
      <div className="tiles">
        <StatTile label="落札数" value={d.totals.sold} />
        <StatTile label="総落札金額" value={d.totals.totalPrice} />
        <StatTile label="平均落札価格" value={d.totals.averagePrice} />
        <StatTile label="最高落札価格" value={d.totals.maxPrice} />
        <StatTile label="入札数" value={d.totals.bids} sub={`入札した人 ${fmtInt(d.totals.bidders)}`} />
        <StatTile label="GEMS からの交換" value={d.exchange.coins} sub={`${fmtInt(d.exchange.count)} 回`} />
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>レアリティ別の落札価格</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>レアリティ</th>
                <th className="num">落札数</th>
                <th className="num">平均</th>
                <th className="num">最低</th>
                <th className="num">最高</th>
              </tr>
            </thead>
            <tbody>
              {d.byRarity.map((r) => (
                <tr key={r.rarity}>
                  <td>{RARITY_LABEL[r.rarity]}</td>
                  <td className="num">{fmtInt(r.sold)}</td>
                  <td className="num">{r.sold ? fmtInt(r.averagePrice) : '—'}</td>
                  <td className="num">{r.sold ? fmtInt(r.minPrice) : '—'}</td>
                  <td className="num">{r.sold ? fmtInt(r.maxPrice) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 8 }}>
            出品の結果（期間内）：落札 {n(d.lots.sold ?? 0)}・未落札 {n(d.lots.unsold ?? 0)}・取り消し {n(d.lots.cancelled ?? 0)}
          </div>
        </div>
        <div className="panel">
          <h3>資金と不正検知</h3>
          <div className="small">
            オークション資金を持つプレイヤー {fmtInt(d.wallets.users)} 人・残高の合計 {fmtInt(d.wallets.balance)}・仮押さえの合計 {fmtInt(d.wallets.held)}
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            直近24時間の不正検知：警告 {fmtInt(d.fraud24h.warn ?? 0)}・要確認 {fmtInt(d.fraud24h.alert ?? 0)}（拒否された通常の入札 {fmtInt(d.fraud24h.info ?? 0)}）
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="spread">
          <h3>今の市場</h3>
          <span className="small muted">
            {m.settings.open ? '開催中' : '停止中'}・{m.settings.mode === 'random' ? 'ランダム出品' : '管理者が選ぶ'}・見ている人 {m.connections}
            {m.settings.mode === 'random' ? `・この一巡の残り ${m.bagRemaining}/${m.catalogSize}` : ''}
          </span>
        </div>
        {m.lots.length === 0 ? (
          <div className="small muted">出品中の選手はいません{m.settings.pauseWhenIdle && m.connections === 0 ? '（だれも見ていないため新しい出品を止めています）' : ''}</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>選手</th>
                <th className="num">現在の価格</th>
                <th>最高額の人</th>
                <th className="num">入札</th>
                <th>残り</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {m.lots.map((l) => (
                <tr key={l.id}>
                  <td>{l.no}</td>
                  <td>
                    {l.playerId} <span className="muted">{RARITY_LABEL[l.rarity]}</span>
                  </td>
                  <td className="num">{l.currentPrice === null ? '—' : fmtInt(l.currentPrice)}</td>
                  <td>{l.leaderName ?? '—'}</td>
                  <td className="num">{l.bidCount}</td>
                  <td>{duration(l.endsAt - m.serverNow)}</td>
                  {canWrite && (
                    <td>
                      <button className="btn small danger" onClick={() => cancel(l)}>
                        取り消し
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PlayersTab() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [onlyUnsold, setOnlyUnsold] = useState(false);
  useEffect(() => {
    adminApi<{ players: Record<string, unknown>[] }>(`/auction/players?days=${days}`).then((r) => setRows(r.players));
  }, [days]);
  const shown = (rows ?? []).filter((r) => !onlyUnsold || (r.sold === 0 && (r.unsold as number) > 0));
  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 8 }}>
        <DaysPicker days={days} onChange={setDays} />
        <label className="small">
          <input type="checkbox" checked={onlyUnsold} onChange={(e) => setOnlyUnsold(e.target.checked)} /> 一度も落札されていない選手だけ
        </label>
      </div>
      {!rows ? (
        <div className="muted">読み込み中…</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>選手</th>
              <th>レアリティ</th>
              <th className="num">OVR</th>
              <th className="num">出品</th>
              <th className="num">落札</th>
              <th className="num">未落札</th>
              <th className="num">平均価格</th>
              <th className="num">最低</th>
              <th className="num">最高</th>
              <th className="num">直近</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={String(r.playerId)}>
                <td>
                  {String(r.name)} <span className="muted tiny">{String(r.playerId)}</span>
                </td>
                <td>{RARITY_LABEL[r.rarity as Rarity]}</td>
                <td className="num">{n(r.ovr)}</td>
                <td className="num">{n(r.listed)}</td>
                <td className="num">{n(r.sold)}</td>
                <td className="num">{n(r.unsold)}</td>
                <td className="num">{n(r.averagePrice)}</td>
                <td className="num">{n(r.minPrice)}</td>
                <td className="num">{n(r.maxPrice)}</td>
                <td className="num">{n(r.lastPrice)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LotsTab() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  useEffect(() => {
    adminApi<{ lots: Record<string, unknown>[] }>(`/auction/lots?limit=100${status ? `&status=${status}` : ''}`).then((r) => setRows(r.lots));
  }, [status]);
  return (
    <div className="panel">
      <div className="seg" style={{ marginBottom: 8 }}>
        {['', 'open', 'sold', 'unsold', 'cancelled'].map((s) => (
          <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
            {s ? STATUS_LABEL[s] : 'すべて'}
          </button>
        ))}
      </div>
      {!rows ? (
        <div className="muted">読み込み中…</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>選手</th>
              <th>状態</th>
              <th className="num">価格</th>
              <th className="num">入札</th>
              <th>落札・最高額</th>
              <th>結果</th>
              <th>出品</th>
              <th>終了</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{n(r.no)}</td>
                <td>
                  {String(r.name)} <span className="muted tiny">{RARITY_LABEL[r.rarity as Rarity]}</span>
                </td>
                <td>
                  {STATUS_LABEL[String(r.status)]}
                  {r.close_note ? <span className="tiny muted">（{String(r.close_note)}）</span> : null}
                </td>
                <td className="num">{n(r.current_price)}</td>
                <td className="num">{n(r.bid_count)}</td>
                <td>{(r.leader_username as string | undefined) ?? (r.current_price ? '（表示権限なし）' : '—')}</td>
                <td>{r.outcome === 'new' ? 'NEW' : r.outcome === 'enhanced' ? `+${String(r.level_after)}` : r.outcome === 'points' ? '交換pt' : '—'}</td>
                <td className="tiny">{time(r.listed_at as number)}</td>
                <td className="tiny">{time(r.closed_at as number | null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BidsTab() {
  const [q, setQ] = useState({ username: '', lotNo: '', playerId: '' });
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const search = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v.trim()) p.set(k, v.trim());
    adminApi<{ bids: Record<string, unknown>[] }>(`/auction/bids?limit=200&${p}`).then((r) => setRows(r.bids));
  };
  useEffect(search, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="panel">
      <form
        className="row"
        style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input placeholder="ユーザー名" value={q.username} onChange={(e) => setQ({ ...q, username: e.target.value })} />
        <input placeholder="出品番号" value={q.lotNo} onChange={(e) => setQ({ ...q, lotNo: e.target.value })} style={{ width: 100 }} />
        <input placeholder="カードID（FD-001）" value={q.playerId} onChange={(e) => setQ({ ...q, playerId: e.target.value })} style={{ width: 160 }} />
        <button className="btn">検索</button>
      </form>
      {!rows ? (
        <div className="muted">読み込み中…</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>日時</th>
              <th>#</th>
              <th>選手</th>
              <th>プレイヤー</th>
              <th className="num">金額</th>
              <th className="num">何件目</th>
              <th>延長</th>
              <th>出品の状態</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td className="tiny">{time(r.created_at as number)}</td>
                <td>{n(r.no)}</td>
                <td>{String(r.name)}</td>
                <td>
                  {String(r.username)} <span className="tiny muted">{String(r.display_name)}</span>
                </td>
                <td className="num">{n(r.amount)}</td>
                <td className="num">{n(r.bid_no)}</td>
                <td>{r.extended ? '延長' : ''}</td>
                <td>
                  {STATUS_LABEL[String(r.status)]}
                  {r.leading && r.status === 'sold' ? '（落札）' : ''}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  入札はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BalancesTab() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const search = () => adminApi<{ balances: Record<string, unknown>[] }>(`/auction/balances?limit=200${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`).then((r) => setRows(r.balances));
  useEffect(() => {
    search();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="panel">
      <form
        className="row"
        style={{ gap: 8, marginBottom: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input placeholder="ユーザー名・表示名" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">検索</button>
      </form>
      {!rows ? (
        <div className="muted">読み込み中…</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>プレイヤー</th>
              <th className="num">残高</th>
              <th className="num">仮押さえ</th>
              <th className="num">使える額</th>
              <th className="num">落札に使った額</th>
              <th className="num">GEMS から交換</th>
              <th className="num">落札数</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.username)}>
                <td>
                  {String(r.username)} <span className="tiny muted">{String(r.display_name)}</span>
                </td>
                <td className="num">{n(r.balance)}</td>
                <td className="num">{n(r.held)}</td>
                <td className="num">{n(r.available)}</td>
                <td className="num">{n(r.spent)}</td>
                <td className="num">{n(r.exchanged)}</td>
                <td className="num">{n(r.wins)}</td>
                <td className="tiny">{time(r.updated_at as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const FRAUD_LABEL: Record<string, string> = {
  rate_limited: '短時間の大量入札',
  shared_network: '同じ通信元の複数アカウントが同じ出品に入札',
  settle_failed: '落札者が支払えなかった',
  settle_retry: '決済のやり直し',
  'refused:LOT_CLOSED': '終了した出品への入札',
  'refused:BID_TOO_LOW': '最低額未満の入札',
  'refused:BAD_AMOUNT': '不正な金額',
  'refused:ALREADY_LEADING': '自分の最高額への入札',
  'refused:MAX_LEVEL': '+5 の選手への入札',
  'refused:INSUFFICIENT_FUNDS': '資金不足の入札',
  'refused:INTERNAL': 'サーバーエラー',
};

function FraudTab() {
  const [sev, setSev] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  useEffect(() => {
    adminApi<{ logs: Record<string, unknown>[] }>(`/auction/fraud?limit=300${sev === 'all' ? '&all=1' : sev ? `&severity=${sev}` : ''}`).then((r) => setRows(r.logs));
  }, [sev]);
  return (
    <div className="panel">
      <div className="seg" style={{ marginBottom: 8 }}>
        {[
          ['', '警告・要確認'],
          ['alert', '要確認'],
          ['warn', '警告'],
          ['all', 'すべて（通常の拒否も）'],
        ].map(([v, l]) => (
          <button key={v} className={sev === v ? 'on' : ''} onClick={() => setSev(v)}>
            {l}
          </button>
        ))}
      </div>
      <div className="small muted" style={{ marginBottom: 8 }}>
        通信元はハッシュ（同じ通信元かどうかだけ分かる値）で保存しています。
      </div>
      {!rows ? (
        <div className="muted">読み込み中…</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>日時</th>
              <th>重要度</th>
              <th>内容</th>
              <th>プレイヤー</th>
              <th>#</th>
              <th>詳細</th>
              <th>通信元</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td className="tiny">{time(r.created_at as number)}</td>
                <td>{r.severity === 'alert' ? '要確認' : r.severity === 'warn' ? '警告' : '情報'}</td>
                <td>{FRAUD_LABEL[String(r.kind)] ?? String(r.kind)}</td>
                <td>{(r.username as string | null) ?? '—'}</td>
                <td>{n(r.lot_no)}</td>
                <td className="tiny" style={{ maxWidth: 320, wordBreak: 'break-all' }}>
                  {String(r.detail_json ?? '')}
                </td>
                <td className="tiny">{String(r.ip_hash ?? '—').slice(0, 10)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  記録はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface Card {
  id: string;
  name: string;
  rarity: Rarity;
  ovr?: number;
}

function OperateTab({ canWrite }: { canWrite: boolean }) {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [queueSaved, setQueueSaved] = useState<string[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [filter, setFilter] = useState('');
  const load = () => {
    adminApi<{ settings: Settings }>('/auction/settings').then((r) => {
      setS(r.settings);
      setSaved(r.settings);
    });
    adminApi<{ queue: { player_id: string }[] }>('/auction/queue').then((r) => {
      const ids = r.queue.map((x) => x.player_id);
      setQueue(ids);
      setQueueSaved(ids);
    });
  };
  useEffect(() => {
    load();
    adminApi<{ items: Card[] }>('/cards?limit=500').then((r) => setCards(r.items));
  }, []);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  if (!s || !saved) return <div className="muted">読み込み中…</div>;
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const queueDirty = queue.join() !== queueSaved.join();
  const num = (k: keyof Settings, label: string, unit = '') => (
    <label className="form-field">
      {label}
      <span className="row" style={{ gap: 6 }}>
        <input type="number" value={s[k] as number} disabled={!canWrite} onChange={(e) => setS({ ...s, [k]: Math.floor(Number(e.target.value)) })} style={{ width: 130 }} />
        {unit && <span className="small muted">{unit}</span>}
      </span>
    </label>
  );
  const save = async (next: Settings, text: string) => {
    setMsg(null);
    try {
      const r = await adminApi<{ settings: Settings }>('/auction/settings', next, 'PUT');
      setS(r.settings);
      setSaved(r.settings);
      setMsg({ ok: true, text });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const move = (i: number, d: number) => {
    const next = [...queue];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setQueue(next);
  };
  const matches = filter.trim()
    ? cards.filter((c) => !queue.includes(c.id) && (c.id.toLowerCase().includes(filter.toLowerCase()) || c.name.toLowerCase().includes(filter.toLowerCase()))).slice(0, 12)
    : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!canWrite && <div className="small muted">表示のみ（変更は owner・admin）</div>}
      <div className="panel">
        <div className="spread">
          <h3>市場の開催</h3>
          <span className={saved.open ? 'good-text' : 'warn-text'}>{saved.open ? '開催中' : '停止中'}</span>
        </div>
        <p className="small muted">止めると新しい出品をしません。入札がある出品は時間どおりに決済します。</p>
        {canWrite && (
          <button className={`btn ${saved.open ? 'danger' : 'primary'}`} onClick={() => save({ ...saved, open: !saved.open }, saved.open ? '市場を止めました' : '市場を開きました')}>
            {saved.open ? '市場を止める' : '市場を開く'}
          </button>
        )}
      </div>

      <div className="panel">
        <h3>出品の方法</h3>
        <div className="seg" style={{ marginBottom: 8 }}>
          <button className={s.mode === 'random' ? 'on' : ''} disabled={!canWrite} onClick={() => setS({ ...s, mode: 'random' })}>
            ランダム（全選手を一巡ずつ）
          </button>
          <button className={s.mode === 'manual' ? 'on' : ''} disabled={!canWrite} onClick={() => setS({ ...s, mode: 'manual' })}>
            管理者が選ぶ
          </button>
        </div>
        <label className="small">
          <input type="checkbox" checked={s.pauseWhenIdle} disabled={!canWrite} onChange={(e) => setS({ ...s, pauseWhenIdle: e.target.checked })} /> だれもオークション画面を見ていない間は新しい出品を止める
        </label>
      </div>

      <div className="panel">
        <h3>数値</h3>
        <div className="grid2">
          <div>
            {num('initialFunds', '初期資金（これから受け取る人に適用）', 'コイン')}
            {num('concurrentLots', '同時に出品する数', '人')}
            <label className="form-field">
              入札時間（最短1日・最長30日）
              <span className="row" style={{ gap: 6 }}>
                <input
                  type="number"
                  min={24}
                  max={720}
                  value={Math.round((s.bidSeconds / 3600) * 100) / 100}
                  disabled={!canWrite}
                  onChange={(e) => setS({ ...s, bidSeconds: Math.round(Number(e.target.value) * 3600) })}
                  style={{ width: 130 }}
                />
                <span className="small muted">時間（{duration(s.bidSeconds * 1000)}）</span>
              </span>
            </label>
            {num('extendWindowSeconds', '終了前この秒数以内の入札で…', '秒')}
            {num('extendSeconds', '…延長する秒数', '秒')}
          </div>
          <div>
            {num('minRaisePercent', '最低上乗せ率', '%')}
            {num('minRaiseAmount', '最低上乗せ額', 'コイン')}
            {num('coinsPerGem', '交換レート：1 GEMS =', 'コイン')}
            <div className="small" style={{ marginTop: 8 }}>
              開始価格
            </div>
            {RARITIES.map((r) => (
              <label key={r} className="row small" style={{ gap: 6, marginTop: 4 }}>
                <span style={{ width: 90 }}>{RARITY_LABEL[r]}</span>
                <input
                  type="number"
                  value={s.startPrice[r]}
                  disabled={!canWrite}
                  onChange={(e) => setS({ ...s, startPrice: { ...s.startPrice, [r]: Math.floor(Number(e.target.value)) } })}
                  style={{ width: 130 }}
                />
              </label>
            ))}
          </div>
        </div>
        <p className="tiny muted">変更は新しく出品する選手から適用されます（開催中の出品はそのまま）。変更は管理者操作ログに記録されます。</p>
        {canWrite && (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" disabled={!dirty} onClick={() => save(s, '設定を保存しました')}>
              設定を保存
            </button>
            <button className="btn ghost" disabled={!dirty} onClick={() => setS(saved)}>
              元に戻す
            </button>
          </div>
        )}
        {msg && <div className={msg.ok ? 'good-text small' : 'error'}>{msg.text}</div>}
      </div>

      <div className="panel">
        <div className="spread">
          <h3>出品する選手の列（管理者が選ぶ時）</h3>
          <span className="small muted">{queue.length} 人</span>
        </div>
        <p className="small muted">上から順に出品します。列が空になると新しい出品はありません。落札されなかった選手は列の最後に戻ります。</p>
        {canWrite && (
          <div style={{ marginBottom: 8 }}>
            <input placeholder="選手名かカードIDで追加" value={filter} onChange={(e) => setFilter(e.target.value)} />
            {matches.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {matches.map((c) => (
                  <button key={c.id} className="btn small" onClick={() => setQueue([...queue, c.id])}>
                    + {c.name}（{RARITY_LABEL[c.rarity]}）
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <table className="tbl">
          <tbody>
            {queue.map((id, i) => (
              <tr key={id}>
                <td>{i + 1}</td>
                <td>
                  {byId.get(id)?.name ?? id} <span className="tiny muted">{id}</span>
                </td>
                <td>{byId.get(id) ? RARITY_LABEL[byId.get(id)!.rarity] : ''}</td>
                {canWrite && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small" onClick={() => move(i, -1)} aria-label="上へ">
                      ↑
                    </button>{' '}
                    <button className="btn small" onClick={() => move(i, 1)} aria-label="下へ">
                      ↓
                    </button>{' '}
                    <button className="btn small danger" onClick={() => setQueue(queue.filter((x) => x !== id))}>
                      外す
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td className="muted">列は空です</td>
              </tr>
            )}
          </tbody>
        </table>
        {canWrite && (
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button
              className="btn primary"
              disabled={!queueDirty}
              onClick={async () => {
                setMsg(null);
                try {
                  await adminApi('/auction/queue', { playerIds: queue }, 'PUT');
                  setQueueSaved(queue);
                  setMsg({ ok: true, text: '出品する選手の列を保存しました' });
                } catch (e) {
                  setMsg({ ok: false, text: (e as Error).message });
                }
              }}
            >
              列を保存
            </button>
            <button className="btn ghost" disabled={!queueDirty} onClick={() => setQueue(queueSaved)}>
              元に戻す
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
