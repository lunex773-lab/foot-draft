import { useEffect, useState, type FormEvent } from 'react';
import { AdminApiError, adminApi } from './api';
import { confirmDialog } from './dialog';
import { EconomyInsights } from './InsightsPages';

interface Wallet {
  coins: number;
  gems: { free: number; paidPurchased: number; paidGranted: number; paid: number; total: number };
  points: { standard: number; premium: number };
}

interface Status {
  environment: string;
  testGrantsEnabled: boolean;
  totals: { wallets: number; coins: number; gems_free: number; gems_paid_purchased: number; gems_paid_granted: number };
}

interface Lookup {
  user: { id: string; username: string; displayName: string };
  wallet: Wallet;
  ledger: { currency: string; amount: number; balance_after: number; reason: string; created_at: number }[];
  collection: number;
}

const KINDS = [
  ['COINS', 'COINS'],
  ['GEMS_FREE', '無償GEMS'],
  ['GEMS_PAID_GRANTED', '有償GEMS（配布）'],
  ['GEMS_PAID_PURCHASED', '有償GEMS（購入扱い・テスト用）'],
  ['POINTS_STANDARD', 'Standardポイント'],
  ['POINTS_PREMIUM', 'Premiumポイント'],
] as const;

const n = (v: number) => v.toLocaleString('ja-JP');
const time = (ms: number) => new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

/**
 * Currencies (Phase 4): wallet lookup and test grants. Test grants exist only
 * in staging / local (decision 42); production refuses them on the server.
 */
export function EconomyPage({ canGrant, canWallet, canInsights }: { canGrant: boolean; canWallet: boolean; canInsights: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [username, setUsername] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('COINS');
  const [amount, setAmount] = useState('10000');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = () => adminApi<Status>('/economy/status').then(setStatus).catch(() => undefined);
  useEffect(() => {
    // totals and the test-grant switch need economy.read (support only looks up players)
    if (canInsights) loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const find = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setMsg(null);
    try {
      setLookup(await adminApi<Lookup>(`/economy/users/${encodeURIComponent(username.trim())}`));
    } catch (err) {
      setLookup(null);
      setError(err instanceof AdminApiError && err.status === 404 ? 'プレイヤーが見つかりません' : (err as Error).message);
    }
  };

  const grant = async (e: FormEvent) => {
    e.preventDefault();
    if (!lookup) return;
    const value = Number(amount);
    const label = KINDS.find((k) => k[0] === kind)![1];
    if (!(await confirmDialog(`${lookup.user.username} に ${label} を ${n(value)} 付与します（テスト用・操作ログに記録されます）`))) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi('/economy/test-grants', { username: lookup.user.username, kind, amount: value, note: note || undefined });
      await find();
      setMsg(`${label} を ${n(value)} 付与しました`);
      if (canInsights) loadStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1>Economy</h1>
      {canInsights && <EconomyInsights />}
      {canWallet && (
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>プレイヤーの残高</h2>
        {status && (
          <div className="small">
            残高のあるプレイヤー {n(status.totals.wallets)}人・COINS 合計 {n(status.totals.coins)}・無償GEMS {n(status.totals.gems_free)}・有償GEMS（購入）{n(status.totals.gems_paid_purchased)}・有償GEMS（配布）
            {n(status.totals.gems_paid_granted)}
          </div>
        )}
        <form className="row" style={{ marginTop: 12 }} onSubmit={find}>
          <input placeholder="プレイヤーのユーザー名" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <button className="btn">表示</button>
        </form>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
      )}

      {lookup && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            {lookup.user.displayName}（{lookup.user.username}）
          </h3>
          <div className="small">
            COINS {n(lookup.wallet.coins)}・無償GEMS {n(lookup.wallet.gems.free)}・有償GEMS（購入）{n(lookup.wallet.gems.paidPurchased)}・有償GEMS（配布）{n(lookup.wallet.gems.paidGranted)}
            <br />
            Standardポイント {n(lookup.wallet.points.standard)}・Premiumポイント {n(lookup.wallet.points.premium)}・所持カード {lookup.collection}枚
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>日時</th>
                <th>理由</th>
                <th>通貨</th>
                <th>増減</th>
                <th>残高</th>
              </tr>
            </thead>
            <tbody>
              {lookup.ledger.map((r, i) => (
                <tr key={i}>
                  <td>{time(r.created_at)}</td>
                  <td>{r.reason}</td>
                  <td>{r.currency}</td>
                  <td>{r.amount > 0 ? `+${n(r.amount)}` : n(r.amount)}</td>
                  <td>{n(r.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status && canGrant && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>テスト用の付与</h3>
          {!status.testGrantsEnabled ? (
            <div className="small muted">この環境（{status.environment}）ではテスト用の付与は使えません。本番環境では常に無効です。</div>
          ) : !lookup ? (
            <div className="small muted">上でプレイヤーを表示してから付与します。</div>
          ) : (
            <form style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }} onSubmit={grant}>
              <div className="small muted">
                {status.environment} 環境だけで使える機能です。付与は通貨の台帳（理由 test_grant）と管理者操作ログに記録されます。
              </div>
              <label>
                種類
                <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  {KINDS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                数量（1〜1,000,000）
                <input type="number" min={1} max={1000000} value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </label>
              <label>
                メモ（任意）
                <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button className="btn primary" disabled={busy}>
                {lookup.user.username} に付与
              </button>
              {msg && <div className="small" style={{ color: 'var(--good, #5ed39a)' }}>{msg}</div>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
