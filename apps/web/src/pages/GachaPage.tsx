import { CURRENCY_LABEL_JA, ECONOMY_CONFIG, RARITIES, RARITY_INFO, type Player, type Rarity } from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useCatalog } from '../lib/catalog';
import { errorText, formatDateTime, formatJst } from '../lib/labels';
import { fmt, newRequestId, useWallet, type Wallet } from '../lib/wallet';

interface PityView {
  epicIn: number;
  legendaryIn: number;
  bonusIn: number;
  total: number;
}

export interface Banner {
  id: string;
  kind: 'standard' | 'premium';
  seriesId: string;
  name: string;
  description: string;
  cost: { currency: 'COINS' | 'GEMS_PAID'; single: number; multi: number };
  ratesPpm: Record<Rarity, number>;
  ratesVersion: number;
  pityRules: null | { epicAt: number; legendaryAt: number; bonusEvery: number };
  pity: PityView | null;
  startsAt: number;
  endsAt: number | null;
  open: boolean;
}

interface DrawResult {
  playerId: string;
  rarity: Rarity;
  guarantee: 'none' | 'epic' | 'legendary' | 'bonus';
  free: boolean;
  duplicate: boolean;
  points: number;
  pointType: 'standard' | 'premium';
  name: string;
}

interface DrawResponse {
  drawId: string;
  count: number;
  cost: { currency: string; amount: number; split: Record<string, number> };
  results: DrawResult[];
  pointsGained: { type: 'standard' | 'premium'; amount: number };
  pity: PityView | null;
  wallet: Wallet;
  missionsCompleted: string[];
}

export const pct = (ppm: number) => `${(ppm / 10_000).toLocaleString('ja-JP', { maximumFractionDigits: 4 })}%`;
const costLabel = (c: Banner['cost']['currency']) => (c === 'COINS' ? 'COINS' : '有償GEMS');
const GUARANTEE_LABEL = { none: '', epic: 'Epic以上保証', legendary: 'Legendary以上保証', bonus: '150回特典' } as const;
export const POINT_LABEL = { standard: 'Standardポイント', premium: 'Premiumポイント' } as const;

function balanceFor(b: Banner, w: Wallet | null) {
  if (!w) return 0;
  return b.cost.currency === 'COINS' ? w.coins : w.gems.paid;
}

function PityBox({ banner }: { banner: Banner }) {
  if (!banner.pityRules || !banner.pity) return null;
  const p = banner.pity;
  return (
    <div className="row tiny">
      <span className="chip">Epic以上まで あと {p.epicIn}回</span>
      <span className="chip">Legendary以上まで あと {p.legendaryIn}回</span>
      <span className="chip on">150回特典まで あと {p.bonusIn}回</span>
      <span className="chip">累計 {p.total}回</span>
    </div>
  );
}

/** Gacha (spec 9). Draws happen on the server; the page shows rates, pity and history. */
export default function GachaPage() {
  const { wallet, setWallet } = useWallet();
  const catalog = useCatalog();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DrawResponse | null>(null);
  const [confirm, setConfirm] = useState<{ banner: Banner; count: 1 | 10 } | null>(null);

  const load = () =>
    api<{ items: Banner[]; wallet: Wallet }>('/api/gacha/banners')
      .then((r) => {
        setBanners(r.items);
        setWallet(r.wallet);
      })
      .catch(() => undefined);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = async (banner: Banner, count: 1 | 10) => {
    setConfirm(null);
    setBusy(banner.id);
    setError(null);
    try {
      const r = await api<DrawResponse>(`/api/gacha/banners/${banner.id}/draw`, { body: { count, requestId: newRequestId() } });
      setResult(r);
      setWallet(r.wallet);
      setBanners((bs) => bs.map((b) => (b.id === banner.id ? { ...b, pity: r.pity } : b)));
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>ガシャ</h2>
          <div className="row small">
            <Link to="/gacha/history">抽選履歴</Link>
            <Link to="/collection">コレクション</Link>
            <Link to="/exchange">交換所</Link>
          </div>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          抽選はすべてサーバーで行います。所持済みのカードが出た場合は、そのガシャの種類の交換ポイントになります。Collection Draft 以外のモード（ランク戦など）では所持カードは使われません。
        </div>
      </div>
      {banners.length === 0 && <div className="muted">開催中のガシャはありません。</div>}
      {banners.map((b) => {
        const have = balanceFor(b, wallet);
        return (
          <div key={b.id} className={`panel gacha-banner ${b.kind}`}>
            <div className="spread">
              <div>
                <div className="tiny muted">{b.kind === 'premium' ? 'PREMIUM GACHA' : 'STANDARD GACHA'}</div>
                <h3 style={{ margin: '2px 0' }}>{b.name}</h3>
              </div>
              <div className="tiny muted" style={{ textAlign: 'right' }}>
                {b.endsAt ? `終了：${formatJst(b.endsAt)}` : '常設'}
                <br />
                <Link to={`/gacha/${b.id}`}>排出率・全候補・天井の詳細</Link>
              </div>
            </div>
            <div className="small muted" style={{ margin: '6px 0' }}>
              {b.description}
            </div>
            <div className="row tiny" style={{ marginBottom: 8 }}>
              {RARITIES.map((r) => (
                <span key={r} className={`chip rar-${r}`}>
                  {RARITY_INFO[r].label} {pct(b.ratesPpm[r])}
                </span>
              ))}
            </div>
            <PityBox banner={b} />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" disabled={!!busy || have < b.cost.single} onClick={() => setConfirm({ banner: b, count: 1 })}>
                1回 {fmt(b.cost.single)} {costLabel(b.cost.currency)}
              </button>
              <button className="btn primary" disabled={!!busy || have < b.cost.multi} onClick={() => setConfirm({ banner: b, count: 10 })}>
                10回 {fmt(b.cost.multi)} {costLabel(b.cost.currency)}
              </button>
              <span className="small muted">
                所持：{fmt(have)} {costLabel(b.cost.currency)}
                {b.cost.currency === 'GEMS_PAID' && '（無償GEMSは使えません）'}
              </span>
            </div>
          </div>
        );
      })}
      {error && <div className="error">{error}</div>}
      {confirm && (
        <div className="modal-bg" onClick={() => setConfirm(null)}>
          <div className="modal panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.banner.name}</h3>
            <p className="small">
              {confirm.count}回引きます。{fmt(confirm.count === 10 ? confirm.banner.cost.multi : confirm.banner.cost.single)} {costLabel(confirm.banner.cost.currency)} を使います。
            </p>
            {confirm.banner.cost.currency === 'GEMS_PAID' && (
              <p className="tiny muted">有償GEMSは {ECONOMY_CONFIG.paidGemsSpendOrder.map((c) => CURRENCY_LABEL_JA[c]).join(' → ')} の順に使われます。</p>
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                やめる
              </button>
              <button className="btn primary" onClick={() => draw(confirm.banner, confirm.count)}>
                引く
              </button>
            </div>
          </div>
        </div>
      )}
      {result && <DrawResultModal result={result} catalog={catalog} onClose={() => setResult(null)} />}
    </div>
  );
}

function DrawResultModal({ result, catalog, onClose }: { result: DrawResponse; catalog: Map<string, Player> | null; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel" style={{ maxWidth: 980 }} onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h3 style={{ margin: 0 }}>抽選結果（{result.results.length}枚）</h3>
          <button className="btn small ghost" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="pool" style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
          {result.results.map((r, i) => {
            const p = catalog?.get(r.playerId);
            return (
              <div key={i} className="slot draw-slot">
                {p ? <PlayerCard player={p} width="100%" /> : <div className="small">{r.name}</div>}
                <div className="row tiny" style={{ justifyContent: 'center', marginTop: 4 }}>
                  {r.duplicate ? <span className="chip">重複 +{r.points}pt</span> : <span className="chip on">NEW</span>}
                  {r.guarantee !== 'none' && <span className="chip on">{GUARANTEE_LABEL[r.guarantee]}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="small" style={{ marginTop: 12 }}>
          使用：{fmt(result.cost.amount)} {result.cost.currency === 'COINS' ? 'COINS' : '有償GEMS'}
          {result.cost.currency === 'GEMS_PAID' &&
            `（${Object.entries(result.cost.split)
              .map(([c, n]) => `${CURRENCY_LABEL_JA[c as keyof typeof CURRENCY_LABEL_JA]} ${fmt(n)}`)
              .join('・')}）`}
          {result.pointsGained.amount > 0 && `　重複カード → ${POINT_LABEL[result.pointsGained.type]} +${fmt(result.pointsGained.amount)}`}
          {result.missionsCompleted.length > 0 && (
            <>
              {'　'}
              <Link to="/missions">ミッション達成！</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface Details {
  banner: Banner;
  counts: Record<Rarity, number>;
  cards: { playerId: string; name: string; rarity: Rarity; position: string | null; ovr: number | null; ratePpm: number; owned: boolean }[];
  duplicatePoints: { type: 'standard' | 'premium'; values: Record<Rarity, number> };
  paidGemsSpendOrder: string[] | null;
  /** change history (decision 58) */
  versions?: { version: number; change_note: string | null; created_at: number }[];
}

/** transparency page (spec 9-6) */
export function GachaDetailPage() {
  const { bannerId } = useParams();
  const [d, setD] = useState<Details | null>(null);
  const [rarity, setRarity] = useState<Rarity | 'all'>('all');
  useEffect(() => {
    api<Details>(`/api/gacha/banners/${bannerId}`).then(setD).catch(() => undefined);
  }, [bannerId]);
  if (!d) return <div className="muted">読み込み中…</div>;
  const b = d.banner;
  const cards = d.cards.filter((c) => rarity === 'all' || c.rarity === rarity);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <Link className="small" to="/gacha">
          ← ガシャへ
        </Link>
        <h2 style={{ margin: '6px 0' }}>{b.name}：提供割合と詳細</h2>
        <div className="small muted">{b.description}</div>
        <table className="tbl wrap" style={{ marginTop: 12 }}>
          <tbody>
            <tr>
              <th>期間</th>
              <td>
                {formatJst(b.startsAt)} 〜 {b.endsAt ? formatJst(b.endsAt) : '常設（終了日なし）'}
              </td>
            </tr>
            <tr>
              <th>価格</th>
              <td>
                1回 {fmt(b.cost.single)}／10回 {fmt(b.cost.multi)} {costLabel(b.cost.currency)}
                {d.paidGemsSpendOrder && <div className="tiny muted">使う順：{d.paidGemsSpendOrder.map((c) => CURRENCY_LABEL_JA[c as keyof typeof CURRENCY_LABEL_JA]).join(' → ')}。無償GEMSは使えません</div>}
              </td>
            </tr>
            <tr>
              <th>天井</th>
              <td>
                {b.pityRules ? (
                  <>
                    Epic以上が{b.pityRules.epicAt}回出なければ{b.pityRules.epicAt}回目でEpic以上、Legendary以上が{b.pityRules.legendaryAt}回出なければ{b.pityRules.legendaryAt}回目でLegendary以上を保証（途中で出たら0から数え直し）。累計{b.pityRules.bonusEvery}
                    回ごとにEpic以上確定の1回が無料で自動的に引かれます（この1回は天井の回数に数えません）。
                    <div className="tiny muted">天井の回数はシリーズ「{b.seriesId}」の中で引き継がれ（復刻を含む）、別のシリーズには移りません。</div>
                  </>
                ) : (
                  'なし（天井・確率上昇・最低保証なし）'
                )}
              </td>
            </tr>
            {b.pity && (
              <tr>
                <th>あなたの状態</th>
                <td>
                  <PityBox banner={b} />
                </td>
              </tr>
            )}
            <tr>
              <th>重複カード</th>
              <td>
                {POINT_LABEL[d.duplicatePoints.type]}に変換：
                {RARITIES.filter((r) => d.counts[r] > 0)
                  .map((r) => `${RARITY_INFO[r].label} ${d.duplicatePoints.values[r]}`)
                  .join('・')}
              </td>
            </tr>
            <tr>
              <th>排出率の版</th>
              <td>v{b.ratesVersion}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {d.versions && d.versions.length > 0 && (
        <div className="panel">
          <h3>変更履歴</h3>
          {d.versions.map((v) => (
            <div key={v.version} className="small" style={{ padding: '3px 0' }}>
              v{v.version}　{formatJst(v.created_at)}　{v.change_note ?? ''}
              {v.version === b.ratesVersion && <span className="chip on" style={{ marginLeft: 6 }}>現在</span>}
            </div>
          ))}
          <div className="tiny muted">抽選履歴には、どの版で引いたかが記録されます。</div>
        </div>
      )}
      <div className="panel">
        <h3>レアリティごとの提供割合</h3>
        <table className="tbl" style={{ maxWidth: 560 }}>
          <thead>
            <tr>
              <th>レアリティ</th>
              <th className="num">提供割合</th>
              <th className="num">対象の選手</th>
              <th className="num">1人あたり</th>
            </tr>
          </thead>
          <tbody>
            {RARITIES.map((r) => (
              <tr key={r}>
                <td className={`rar-${r}`}>{RARITY_INFO[r].label}</td>
                <td className="num">{pct(b.ratesPpm[r])}</td>
                <td className="num">{d.counts[r]}人</td>
                <td className="num">{d.counts[r] ? pct(b.ratesPpm[r] / d.counts[r]) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          同じレアリティの中では全員同じ確率です。保証・150回特典の回は、その対象レアリティの中で上の割合を比べて決まります。
        </div>
      </div>
      <div className="panel">
        <div className="spread" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>全候補（{d.cards.length}人）</h3>
          <div className="tabs">
            <button className={rarity === 'all' ? 'on' : ''} onClick={() => setRarity('all')}>
              すべて
            </button>
            {RARITIES.filter((r) => d.counts[r] > 0).map((r) => (
              <button key={r} className={rarity === r ? 'on' : ''} onClick={() => setRarity(r)}>
                {RARITY_INFO[r].label}
              </button>
            ))}
          </div>
        </div>
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>選手</th>
                <th>レアリティ</th>
                <th>ポジション</th>
                <th className="num">OVR</th>
                <th className="num">提供割合</th>
                <th>所持</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.playerId}>
                  <td>{c.name}</td>
                  <td className={`rar-${c.rarity}`}>{RARITY_INFO[c.rarity].label}</td>
                  <td>{c.position}</td>
                  <td className="num">{c.ovr}</td>
                  <td className="num">{pct(c.ratePpm)}</td>
                  <td>{c.owned ? '所持' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface HistoryRow {
  draw_id: string;
  idx: number;
  player_id: string;
  name: string;
  rarity: Rarity;
  guarantee: DrawResult['guarantee'];
  is_free: number;
  is_duplicate: number;
  point_type: 'standard' | 'premium';
  points: number;
  created_at: number;
  banner_name: string;
  rates_version: number;
}

export function GachaHistoryPage() {
  const [items, setItems] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    api<{ items: HistoryRow[] }>('/api/gacha/history?limit=200')
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);
  return (
    <div className="panel">
      <Link className="small" to="/gacha">
        ← ガシャへ
      </Link>
      <h2 style={{ margin: '6px 0' }}>抽選履歴（最新200件）</h2>
      {!items ? (
        <div className="muted">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="muted small">まだガシャを引いていません。</div>
      ) : (
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>日時</th>
                <th>ガシャ</th>
                <th>選手</th>
                <th>レアリティ</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={`${h.draw_id}-${h.idx}`}>
                  <td>{formatDateTime(h.created_at)}</td>
                  <td>
                    {h.banner_name} <span className="tiny muted">v{h.rates_version}</span>
                  </td>
                  <td>{h.name}</td>
                  <td className={`rar-${h.rarity}`}>{RARITY_INFO[h.rarity].label}</td>
                  <td className="small">
                    {h.is_duplicate ? `重複 → ${POINT_LABEL[h.point_type]} +${h.points}` : 'NEW'}
                    {h.guarantee !== 'none' && `・${GUARANTEE_LABEL[h.guarantee]}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
