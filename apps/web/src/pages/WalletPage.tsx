import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/labels';
import { CURRENCY_SHORT, REASON_LABEL, fmt, useWallet } from '../lib/wallet';
import { POINT_LABEL } from './GachaPage';

interface LedgerRow {
  id: string;
  currency: string;
  amount: number;
  balance_after: number;
  reason: string;
  created_at: number;
}

interface PointRow {
  id: string;
  point_type: 'standard' | 'premium';
  amount: number;
  balance_after: number;
  reason: string;
  created_at: number;
}

/** balances with the GEMS breakdown (spec 8) and the ledger */
export default function WalletPage() {
  const { wallet, login, matchRewards, refresh } = useWallet();
  const [items, setItems] = useState<LedgerRow[] | null>(null);
  const [points, setPoints] = useState<PointRow[]>([]);
  useEffect(() => {
    refresh().catch(() => undefined);
    api<{ items: LedgerRow[]; points: PointRow[] }>('/api/currency/history?limit=100')
      .then((r) => {
        setItems(r.items);
        setPoints(r.points);
      })
      .catch(() => setItems([]));
  }, [refresh]);

  if (!wallet) return <div className="muted">読み込み中…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid3">
        <div className="panel stat-card">
          <div className="tiny muted">COINS</div>
          <div className="display big">{fmt(wallet.coins)}</div>
          <div className="tiny muted">対戦・ログイン・ミッションで獲得。Standardガシャに使えます</div>
        </div>
        <div className="panel stat-card">
          <div className="tiny muted">GEMS（合計）</div>
          <div className="display big">{fmt(wallet.gems.total)}</div>
          <table className="tbl tiny" style={{ marginTop: 6 }}>
            <tbody>
              <tr>
                <td>無償GEMS</td>
                <td className="num">{fmt(wallet.gems.free)}</td>
              </tr>
              <tr>
                <td>有償GEMS（購入）</td>
                <td className="num">{fmt(wallet.gems.paidPurchased)}</td>
              </tr>
              <tr>
                <td>有償GEMS（配布）</td>
                <td className="num">{fmt(wallet.gems.paidGranted)}</td>
              </tr>
            </tbody>
          </table>
          <div className="tiny muted">Premiumガシャには有償GEMSだけが使えます。GEMSの購入は今後対応予定です</div>
        </div>
        <div className="panel stat-card">
          <div className="tiny muted">交換ポイント</div>
          <div className="small" style={{ marginTop: 6 }}>
            {POINT_LABEL.standard} <b>{fmt(wallet.points.standard)}</b>
            <br />
            {POINT_LABEL.premium} <b>{fmt(wallet.points.premium)}</b>
          </div>
          <Link className="small" to="/exchange">
            交換所へ
          </Link>
        </div>
      </div>
      <div className="panel small">
        {login && (
          <div>
            ログインボーナス：{login.claimedToday ? `受け取り済み（${login.streak}日連続）` : '未受け取り'}　<span className="muted">7日連続ごとに 300 COINS</span>
          </div>
        )}
        {matchRewards && (
          <div>
            今日の対戦報酬：{matchRewards.leaguesToday} / {matchRewards.cap} リーグ　<span className="muted">（日本時間で1日{matchRewards.cap}リーグまで。それ以降も遊べますが報酬はありません）</span>
          </div>
        )}
      </div>
      <div className="panel">
        <h3>通貨の履歴（最新100件）</h3>
        {!items ? (
          <div className="muted">読み込み中…</div>
        ) : items.length === 0 ? (
          <div className="small muted">まだ履歴はありません。</div>
        ) : (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>内容</th>
                  <th>通貨</th>
                  <th className="num">増減</th>
                  <th className="num">残高</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTime(r.created_at)}</td>
                    <td>{REASON_LABEL[r.reason] ?? r.reason}</td>
                    <td>{CURRENCY_SHORT[r.currency] ?? r.currency}</td>
                    <td className={`num ${r.amount > 0 ? 'delta-up' : 'delta-down'}`}>{r.amount > 0 ? `+${fmt(r.amount)}` : fmt(r.amount)}</td>
                    <td className="num">{fmt(r.balance_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {points.length > 0 && (
        <div className="panel">
          <h3>交換ポイントの履歴</h3>
          <div className="scroll-x">
            <table className="tbl">
              <tbody>
                {points.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTime(r.created_at)}</td>
                    <td>{REASON_LABEL[r.reason] ?? r.reason}</td>
                    <td>{POINT_LABEL[r.point_type]}</td>
                    <td className={`num ${r.amount > 0 ? 'delta-up' : 'delta-down'}`}>{r.amount > 0 ? `+${fmt(r.amount)}` : fmt(r.amount)}</td>
                    <td className="num">{fmt(r.balance_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
