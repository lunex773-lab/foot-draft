import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { errorText, formatDateTime } from '../lib/labels';
import { fmt, useWallet, type Wallet } from '../lib/wallet';

interface Product {
  id: string;
  kind: 'gems' | 'membership';
  name: string;
  priceJpy: number;
  gems: number;
  bonus: number;
  firstTimeBonus: number;
  periodDays: number | null;
}

interface Membership {
  active: boolean;
  autoRenew: boolean;
  periodEnd: number | null;
}

interface Shop {
  products: Product[];
  stores: Record<'mock' | 'apple' | 'google', { available: boolean; reason?: string }>;
  membership: Membership;
  wallet: Wallet;
}

interface Purchase {
  id: string;
  productId: string;
  store: string;
  status: string;
  priceJpy: number;
  gemsPurchased: number;
  gemsGranted: number;
  renewal: boolean;
  createdAt: number;
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const STATUS_LABEL: Record<string, string> = { completed: '完了', failed: '未完了', refunded: '返金済み' };

/**
 * Shop (spec 11, decisions 52-55). Purchases are verified by the server.
 * Only the test store exists for now; in production nothing can be bought yet.
 */
export default function ShopPage() {
  const { setWallet, refresh } = useWallet();
  const [shop, setShop] = useState<Shop | null>(null);
  const [history, setHistory] = useState<Purchase[]>([]);
  const [checkout, setCheckout] = useState<{ product: Product; purchaseId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api<Shop>('/api/purchases/shop')
      .then((s) => {
        setShop(s);
        setWallet(s.wallet);
      })
      .catch(() => undefined);
    api<{ items: Purchase[] }>('/api/purchases')
      .then((r) => setHistory(r.items))
      .catch(() => undefined);
  };
  useEffect(load, [setWallet]);

  const fail = (e: unknown) => setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));

  const start = async (product: Product) => {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await api<{ purchaseId: string }>('/api/purchases', { body: { productId: product.id, store: 'mock' } });
      setCheckout({ product, purchaseId: r.purchaseId });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!checkout) return;
    setBusy(true);
    try {
      // the test store "pays" and returns a receipt signed by the server; the server then verifies it
      const paid = await api<{ receipt: string }>(`/api/purchases/${checkout.purchaseId}/mock-checkout`, { body: {} });
      const r = await api<{ purchase: Purchase; wallet: Wallet }>(`/api/purchases/${checkout.purchaseId}/verify`, { body: { receipt: paid.receipt } });
      setWallet(r.wallet);
      setMsg(
        checkout.product.kind === 'membership'
          ? 'Premium Membership が始まりました（テスト用）'
          : `有償GEMS ${fmt(r.purchase.gemsPurchased + r.purchase.gemsGranted)} を受け取りました（テスト用）`,
      );
      setCheckout(null);
      load();
      refresh().catch(() => undefined);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!checkout) return;
    await api(`/api/purchases/${checkout.purchaseId}/cancel`, { body: { reason: 'cancelled' } }).catch(() => undefined);
    setCheckout(null);
  };

  const stopRenewal = async () => {
    if (!window.confirm('自動更新を止めます。今の期間の終わりまでは会員のままです。')) return;
    try {
      await api('/api/purchases/membership/cancel', { body: {} });
      load();
    } catch (e) {
      fail(e);
    }
  };

  if (!shop) return <div className="muted">読み込み中…</div>;
  const canBuy = shop.stores.mock.available;
  const gems = shop.products.filter((p) => p.kind === 'gems');
  const membership = shop.products.find((p) => p.kind === 'membership');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <h2 style={{ margin: 0 }}>ショップ</h2>
        {canBuy ? (
          <div className="notice test small">テスト環境です。購入は「模擬ストア」で行われ、実際の請求は発生しません。</div>
        ) : (
          <div className="notice small">現在は購入できません（アプリ版のストアでの購入に対応予定です）。</div>
        )}
        <div className="small muted" style={{ marginTop: 6 }}>
          有償GEMS：購入分 {fmt(shop.wallet.gems.paidPurchased)}・配布分 {fmt(shop.wallet.gems.paidGranted)}　無償GEMS {fmt(shop.wallet.gems.free)}
        </div>
      </div>

      {membership && (
        <div className="panel member-card">
          <div className="spread">
            <div>
              <div className="title">
                <span className="member-badge">★</span> {membership.name}
              </div>
              <div className="small">
                {yen(membership.priceJpy)} / {membership.periodDays}日（自動更新）　会員の間は毎日 <b>無償GEMS 20</b> と会員バッジ
              </div>
              <div className="tiny muted">能力の強化やランク戦での優遇はありません。</div>
            </div>
            {shop.membership.active ? (
              <div style={{ textAlign: 'right' }}>
                <span className="chip on">会員中</span>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {shop.membership.autoRenew ? '次回更新' : '終了'}：{shop.membership.periodEnd ? formatDateTime(shop.membership.periodEnd) : '—'}
                </div>
                {shop.membership.autoRenew && canBuy && (
                  <button className="btn small ghost" onClick={stopRenewal}>
                    自動更新を止める
                  </button>
                )}
              </div>
            ) : (
              <button className="btn primary" disabled={!canBuy || busy} onClick={() => start(membership)}>
                {yen(membership.priceJpy)}で入会
              </button>
            )}
          </div>
        </div>
      )}

      <div className="shop-grid">
        {gems.map((p) => (
          <div key={p.id} className="panel shop-item">
            <div className="tiny muted">{p.name}</div>
            <div className="display gems">{fmt(p.gems + p.bonus + p.firstTimeBonus)}</div>
            <div className="tiny muted">有償GEMS</div>
            <div className="row tiny" style={{ justifyContent: 'center', minHeight: 22 }}>
              {p.bonus > 0 && <span className="chip">おまけ +{fmt(p.bonus)}</span>}
              {p.firstTimeBonus > 0 && <span className="chip on">初回 +{fmt(p.firstTimeBonus)}</span>}
            </div>
            <button className="btn primary" disabled={!canBuy || busy} onClick={() => start(p)}>
              {yen(p.priceJpy)}
            </button>
          </div>
        ))}
      </div>
      <div className="tiny muted">
        有償GEMSは Premium ガシャなどに使えます。おまけ・初回分は「有償GEMS（配布）」として記録され、先に使われます。有効期限はありません。
      </div>

      {msg && <div className="small" style={{ color: 'var(--good)' }}>{msg}</div>}
      {error && <div className="error">{error}</div>}

      {history.length > 0 && (
        <div className="panel">
          <h3>購入履歴</h3>
          <div className="scroll-x">
            <table className="tbl">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDateTime(h.createdAt)}</td>
                    <td>
                      {shop.products.find((p) => p.id === h.productId)?.name ?? h.productId}
                      {h.renewal && <span className="tiny muted">（更新）</span>}
                    </td>
                    <td className="num">{yen(h.priceJpy)}</td>
                    <td className="num">{h.gemsPurchased + h.gemsGranted ? `${fmt(h.gemsPurchased + h.gemsGranted)} GEMS` : ''}</td>
                    <td>
                      {STATUS_LABEL[h.status] ?? h.status}
                      {h.store === 'mock' && <span className="tiny muted">（模擬）</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {checkout && (
        <div className="modal-bg">
          <div className="modal panel mock-store" style={{ maxWidth: 380 }} role="dialog" aria-label="模擬ストア">
            <div className="tiny muted">模擬ストア（テスト用）</div>
            <h3 style={{ margin: '6px 0' }}>{checkout.product.name}</h3>
            <div className="display" style={{ fontSize: 28 }}>
              {yen(checkout.product.priceJpy)}
            </div>
            <p className="small">これはテスト用の模擬ストアです。実際の請求は発生しません。本物のアプリでは、ここで App Store／Google Play の購入画面が表示されます。</p>
            {error && <div className="error">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" disabled={busy} onClick={cancel}>
                やめる
              </button>
              <button className="btn primary" disabled={busy} onClick={pay}>
                支払う（模擬）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
