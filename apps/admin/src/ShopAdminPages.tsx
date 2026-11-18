import { useEffect, useState } from 'react';
import { adminApi } from './api';
import { confirmDialog, promptDialog } from './dialog';
import { BarList, ColumnChart, StatTile, fmtInt, fmtPct } from './charts';
import { PeriodFilter, usePeriod } from './InsightsPages';

const yen = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`);
const time = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—');
const STATUS_LABEL: Record<string, string> = { started: '開始のみ', completed: '完了', failed: '失敗・中止', refunded: '返金済み' };
const STORE_LABEL: Record<string, string> = { mock: '模擬ストア', apple: 'App Store', google: 'Google Play' };

interface Product {
  id: string;
  kind: 'gems' | 'membership';
  name: string;
  price_jpy: number;
  gems_base: number;
  gems_bonus: number;
  first_time_bonus: number;
  period_days: number | null;
  apple_product_id: string | null;
  google_product_id: string | null;
  active: number;
  sort_order: number;
}

/** products for real money (spec 11-2, 11-3; decision 53) */
export function ProductsPage({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<Product[] | null>(null);
  const [stores, setStores] = useState<Record<string, { available: boolean; reason?: string }> | null>(null);
  const [edit, setEdit] = useState<Record<string, Partial<Product>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    adminApi<{ items: Product[]; stores: Record<string, { available: boolean; reason?: string }> }>('/products').then((r) => {
      setItems(r.items);
      setStores(r.stores);
    });
  useEffect(() => {
    load();
  }, []);
  const save = async (p: Product) => {
    setError(null);
    setMsg(null);
    try {
      await adminApi(`/products/${p.id}`, edit[p.id], 'PATCH');
      setEdit((e) => ({ ...e, [p.id]: {} }));
      setMsg(`${p.name} を保存しました（これからの購入に適用。過去の購入は変わりません）`);
      load();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  const field = (p: Product, k: keyof Product, type: 'text' | 'number' = 'number', width = 90) => (
    <input
      type={type}
      disabled={!canWrite}
      value={String(edit[p.id]?.[k] ?? p[k] ?? '')}
      onChange={(e) => setEdit((x) => ({ ...x, [p.id]: { ...x[p.id], [k]: type === 'number' ? Number(e.target.value) : e.target.value } }))}
      style={{ width }}
    />
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1>商品</h1>
      {stores && (
        <div className="small">
          ストア：{Object.entries(stores).map(([s, v]) => `${STORE_LABEL[s]} ${v.available ? '利用可' : v.reason === 'not_connected' ? '未接続' : '利用不可（本番）'}`).join('・')}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {msg && <div className="small" style={{ color: 'var(--accent)' }}>{msg}</div>}
      <div className="panel scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>商品</th>
              <th>価格（円）</th>
              <th>有償GEMS（購入分＝価格）</th>
              <th>おまけ</th>
              <th>初回おまけ</th>
              <th>App Store ID</th>
              <th>Google Play ID</th>
              <th>販売</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items?.map((p) => (
              <tr key={p.id}>
                <td>
                  {field(p, 'name', 'text', 150)}
                  <div className="tiny muted">
                    {p.id}
                    {p.period_days ? `・${p.period_days}日の自動更新` : ''}
                  </div>
                </td>
                <td>{field(p, 'price_jpy')}</td>
                <td>{p.kind === 'gems' ? field(p, 'gems_base') : '—'}</td>
                <td>{p.kind === 'gems' ? field(p, 'gems_bonus') : '—'}</td>
                <td>{p.kind === 'gems' ? field(p, 'first_time_bonus') : '—'}</td>
                <td>{field(p, 'apple_product_id', 'text', 150)}</td>
                <td>{field(p, 'google_product_id', 'text', 150)}</td>
                <td>
                  <input
                    type="checkbox"
                    disabled={!canWrite}
                    checked={!!(edit[p.id]?.active ?? p.active)}
                    onChange={(e) => setEdit((x) => ({ ...x, [p.id]: { ...x[p.id], active: e.target.checked ? 1 : 0 } }))}
                    aria-label={`${p.name} を販売`}
                  />
                </td>
                <td>
                  {canWrite && (
                    <button className="btn" disabled={!edit[p.id] || Object.keys(edit[p.id]).length === 0} onClick={() => save(p)}>
                      保存
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tiny muted">GEMS パックの購入分は価格と同じ（1円＝1GEMS、決定 53）。おまけ・初回おまけは「有償GEMS（配布）」として付与されます。変更は操作ログに記録されます。</div>
    </div>
  );
}

interface PurchaseRow {
  id: string;
  username: string;
  display_name: string;
  product_name: string;
  store: string;
  status: string;
  store_transaction_id: string | null;
  price_jpy: number;
  gems_purchased: number;
  gems_granted: number;
  receipt_status: string;
  failure_reason: string | null;
  is_renewal: number;
  created_at: number;
  completed_at: number | null;
}

/** purchases, refunds and memberships (spec 12-8) */
export function PurchasesPage({ canWrite }: { canWrite: boolean }) {
  const [tab, setTab] = useState<'purchases' | 'refunds' | 'subscriptions'>('purchases');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1>Purchases</h1>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={tab === 'purchases' ? 'on' : ''} onClick={() => setTab('purchases')}>
          購入
        </button>
        <button className={tab === 'refunds' ? 'on' : ''} onClick={() => setTab('refunds')}>
          返金
        </button>
        <button className={tab === 'subscriptions' ? 'on' : ''} onClick={() => setTab('subscriptions')}>
          会員（定期購入）
        </button>
      </div>
      {tab === 'purchases' && <PurchaseList canWrite={canWrite} />}
      {tab === 'refunds' && <RefundList canWrite={canWrite} />}
      {tab === 'subscriptions' && <SubscriptionList canWrite={canWrite} />}
    </div>
  );
}

function PurchaseList({ canWrite }: { canWrite: boolean }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ items: PurchaseRow[]; mockActions: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    adminApi<{ items: PurchaseRow[]; mockActions: boolean }>(`/purchases?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}`)
      .then(setData)
      .catch((e) => setError(String(e.message)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  const refund = async (p: PurchaseRow) => {
    if (!(await confirmDialog(`${p.username} の ${p.product_name}（${yen(p.price_jpy)}）に模擬ストアの返金通知を送ります。付与した GEMS を回収します。`))) return;
    try {
      const r = await adminApi<{ gemsRecovered: number; shortfall: number }>(`/purchases/${p.id}/mock-refund`, {});
      setMsg(`返金：${fmtInt(r.gemsRecovered)} GEMS を回収${r.shortfall ? `、未回収 ${fmtInt(r.shortfall)}` : ''}`);
      load();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  return (
    <>
      <form
        className="filter-row"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="状態">
          <option value="">すべての状態</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input placeholder="ユーザー名・購入ID・ストアの取引ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">検索</button>
      </form>
      {error && <div className="error">{error}</div>}
      {msg && <div className="small" style={{ color: 'var(--accent)' }}>{msg}</div>}
      <div className="panel scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>日時</th>
              <th>購入者</th>
              <th>商品</th>
              <th className="num">金額</th>
              <th>ストア</th>
              <th>レシート</th>
              <th>状態</th>
              <th className="num">付与 GEMS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  購入はありません
                </td>
              </tr>
            )}
            {data?.items.map((p) => (
              <tr key={p.id}>
                <td>{time(p.created_at)}</td>
                <td>
                  {p.display_name}
                  <div className="tiny muted">{p.username}</div>
                </td>
                <td>
                  {p.product_name}
                  {p.is_renewal ? <span className="tiny muted">（更新）</span> : ''}
                </td>
                <td className="num">{yen(p.price_jpy)}</td>
                <td>{STORE_LABEL[p.store]}</td>
                <td className="small">{p.receipt_status}</td>
                <td>
                  {STATUS_LABEL[p.status]}
                  {p.failure_reason && <div className="tiny muted">{p.failure_reason}</div>}
                </td>
                <td className="num">{p.gems_purchased + p.gems_granted ? `${fmtInt(p.gems_purchased)}＋${fmtInt(p.gems_granted)}` : '—'}</td>
                <td>
                  {canWrite && data.mockActions && p.store === 'mock' && p.status === 'completed' && (
                    <button className="btn" onClick={() => refund(p)}>
                      模擬の返金
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          付与 GEMS は「購入分＋おまけ（配布分）」。本番の返金は App Store・Google Play からの通知で処理します（ストアの接続後）。
        </div>
      </div>
    </>
  );
}

interface RefundRow {
  id: string;
  transaction_id: string;
  username: string;
  product_id: string;
  amount_jpy: number;
  gems_to_recover: number;
  gems_recovered: number;
  shortfall: number;
  status: 'settled' | 'shortfall' | 'resolved';
  resolution_note: string | null;
  resolved_by_name: string | null;
  created_at: number;
}

function RefundList({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<RefundRow[] | null>(null);
  const load = () => adminApi<{ items: RefundRow[] }>('/refunds').then((r) => setItems(r.items));
  useEffect(() => {
    load();
  }, []);
  const resolve = async (r: RefundRow) => {
    const note = await promptDialog(`未回収 ${r.shortfall} GEMS の対応を記録します（例：少額のため回収しない、アカウントを停止した 等）`);
    if (!note) return;
    await adminApi(`/refunds/${r.id}/resolve`, { note });
    load();
  };
  return (
    <div className="panel scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th>日時</th>
            <th>購入者</th>
            <th>商品</th>
            <th className="num">返金額</th>
            <th className="num">回収</th>
            <th className="num">未回収</th>
            <th>状態</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items?.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                返金はありません
              </td>
            </tr>
          )}
          {items?.map((r) => (
            <tr key={r.id}>
              <td>{time(r.created_at)}</td>
              <td>{r.username}</td>
              <td>{r.product_id}</td>
              <td className="num">{yen(r.amount_jpy)}</td>
              <td className="num">
                {fmtInt(r.gems_recovered)} / {fmtInt(r.gems_to_recover)}
              </td>
              <td className="num">{fmtInt(r.shortfall)}</td>
              <td>
                {r.status === 'settled' ? '回収済み' : r.status === 'shortfall' ? <span className="prio high">未回収あり</span> : '対応済み'}
                {r.resolution_note && (
                  <div className="tiny muted">
                    {r.resolution_note}（{r.resolved_by_name}）
                  </div>
                )}
              </td>
              <td>
                {canWrite && r.status === 'shortfall' && (
                  <button className="btn" onClick={() => resolve(r)}>
                    対応を記録
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        返金時は、その購入で付与した GEMS のうち残っている分を回収し、足りない分を「未回収」として記録します（決定 57）。
      </div>
    </div>
  );
}

interface SubRow {
  id: string;
  username: string;
  display_name: string;
  store: string;
  status: string;
  auto_renew: number;
  current_period_end: number;
  payments: number;
  created_at: number;
}

function SubscriptionList({ canWrite }: { canWrite: boolean }) {
  const [data, setData] = useState<{ items: SubRow[]; now: number; mockActions: boolean } | null>(null);
  const load = () => adminApi<{ items: SubRow[]; now: number; mockActions: boolean }>('/subscriptions').then(setData);
  useEffect(() => {
    load();
  }, []);
  const act = async (s: SubRow, action: string, label: string) => {
    if (!(await confirmDialog(`${s.username}：模擬ストアの「${label}」通知を送ります`))) return;
    await adminApi(`/subscriptions/${s.id}/mock/${action}`, {});
    load();
  };
  return (
    <div className="panel scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th>会員</th>
            <th>ストア</th>
            <th>状態</th>
            <th>自動更新</th>
            <th>期間の終わり</th>
            <th className="num">支払い回数</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.items.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                会員はいません
              </td>
            </tr>
          )}
          {data?.items.map((s) => {
            const active = s.status === 'active' && s.current_period_end > data.now;
            return (
              <tr key={s.id}>
                <td>
                  {s.display_name}
                  <div className="tiny muted">{s.username}</div>
                </td>
                <td>{STORE_LABEL[s.store]}</td>
                <td>{active ? '有効' : s.status === 'refunded' ? '返金で終了' : '終了'}</td>
                <td>{s.auto_renew ? 'あり' : 'なし'}</td>
                <td>{time(s.current_period_end)}</td>
                <td className="num">{s.payments}</td>
                <td className="row">
                  {canWrite && data.mockActions && s.store === 'mock' && active && (
                    <>
                      {!!s.auto_renew && (
                        <button className="btn" onClick={() => act(s, 'renew', '更新')}>
                          模擬の更新
                        </button>
                      )}
                      {!!s.auto_renew && (
                        <button className="btn" onClick={() => act(s, 'cancel', '自動更新の停止')}>
                          模擬の解約
                        </button>
                      )}
                      <button className="btn" onClick={() => act(s, 'expire', '期限切れ')}>
                        模擬の期限切れ
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface Revenue {
  period: { from: string; to: string; days: number };
  gross: number;
  refunds: number;
  refundCount: number;
  net: number;
  purchases: number;
  payers: number;
  activeUsers: number;
  payerRate: number | null;
  arpu: number | null;
  arppu: number | null;
  firstPayers: number;
  firstPurchaseRate: number | null;
  failureRate: number | null;
  attempts: number;
  series: { bucket: string; gross: number; n: number }[];
  byProduct: { product_id: string; name: string; n: number; buyers: number; gross: number; purchaseRate: number | null }[];
  byStore: { store: string; n: number; gross: number }[];
  gacha: { banner_id: string; name: string; purchased_gems: number }[];
  unusedPaidGems: { purchased: number; granted: number };
  openShortfalls: { n: number; gems: number };
  mockGross: number;
}

/** revenue (spec 11-5) */
export function RevenuePage() {
  const [period, setPeriod] = usePeriod(30);
  const [unit, setUnit] = useState<'day' | 'week' | 'month'>('day');
  const [d, setD] = useState<Revenue | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    adminApi<Revenue>(`/revenue?from=${period.from}&to=${period.to}&unit=${unit}`)
      .then(setD)
      .finally(() => setLoading(false));
  }, [period, unit]);
  return (
    <div>
      <h1>Revenue</h1>
      <PeriodFilter value={period} onChange={setPeriod}>
        <div className="seg">
          {(
            [
              ['day', '日次'],
              ['week', '週次'],
              ['month', '月次'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={unit === k ? 'on' : ''} onClick={() => setUnit(k)}>
              {l}
            </button>
          ))}
        </div>
      </PeriodFilter>
      {d && (
        <div style={{ opacity: loading ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="notice-admin small">
            Apple・Google のストアはまだ接続されていません（決定 52）。{d.mockGross > 0 ? `この期間の売上のうち ${yen(d.mockGross)} は模擬ストア（テスト）の購入で、実際の売上ではありません。` : ''}
          </div>
          <div className="tiles">
            <StatTile label="売上（総額）" value={d.gross} format={yen} sub={`${fmtInt(d.purchases)}件`} />
            <StatTile label="返金" value={d.refunds} format={yen} sub={`${d.refundCount}件`} upIsGood={false} />
            <StatTile label="売上（返金後）" value={d.net} format={yen} />
            <StatTile label="課金者数" value={d.payers} sub={`アクティブ ${fmtInt(d.activeUsers)}人`} />
            <StatTile label="課金率" value={d.payerRate === null ? null : d.payerRate * 100} format={(n) => `${n.toFixed(1)}%`} />
            <StatTile label="ARPU" value={d.arpu} format={yen} />
            <StatTile label="ARPPU" value={d.arppu} format={yen} />
            <StatTile label="初回課金率" value={d.firstPurchaseRate === null ? null : d.firstPurchaseRate * 100} format={(n) => `${n.toFixed(1)}%`} sub={`初めて購入した人 ${d.firstPayers}人`} />
            <StatTile label="購入失敗率" value={d.failureRate === null ? null : d.failureRate * 100} format={(n) => `${n.toFixed(1)}%`} upIsGood={false} sub={`開始 ${d.attempts}件`} />
            <StatTile label="未使用の有償GEMS" value={d.unusedPaidGems.purchased + d.unusedPaidGems.granted} sub={`購入分 ${fmtInt(d.unusedPaidGems.purchased)}・配布分 ${fmtInt(d.unusedPaidGems.granted)}`} />
            <StatTile label="未回収（返金）" value={d.openShortfalls.gems} sub={`${d.openShortfalls.n}件`} upIsGood={false} />
          </div>
          <div className="grid2">
            <div className="panel">
              <ColumnChart title={`売上（${unit === 'day' ? '日次' : unit === 'week' ? '週次・月曜始まり' : '月次'}）`} data={d.series.map((s) => ({ label: s.bucket.length === 7 ? `${s.bucket}-01` : s.bucket, value: s.gross }))} format={yen} />
            </div>
            <div className="panel">
              <BarList title="ガシャ別の有償GEMS（購入分）消費" data={d.gacha.map((g) => ({ label: g.name, value: g.purchased_gems }))} />
            </div>
          </div>
          <div className="panel scroll-x">
            <h3>商品別</h3>
            <table className="tbl">
              <thead>
                <tr>
                  <th>商品</th>
                  <th className="num">件数</th>
                  <th className="num">購入者</th>
                  <th className="num">購入率</th>
                  <th className="num">売上</th>
                </tr>
              </thead>
              <tbody>
                {d.byProduct.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      この期間の購入はありません
                    </td>
                  </tr>
                )}
                {d.byProduct.map((p) => (
                  <tr key={p.product_id}>
                    <td>{p.name}</td>
                    <td className="num">{fmtInt(p.n)}</td>
                    <td className="num">{fmtInt(p.buyers)}</td>
                    <td className="num">{fmtPct(p.purchaseRate)}</td>
                    <td className="num">{yen(p.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tiny muted" style={{ marginTop: 6 }}>
              ストア別：{d.byStore.map((s) => `${STORE_LABEL[(s as { store: string }).store]} ${yen((s as { gross: number }).gross)}`).join('・') || 'なし'}。ARPU＝返金後の売上÷期間中のアクティブ人数、ARPPU＝返金後の売上÷課金者数。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
