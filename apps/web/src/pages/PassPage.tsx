import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useCatalog } from '../lib/catalog';
import { errorText } from '../lib/labels';
import { fmt, newRequestId, useWallet, type Wallet } from '../lib/wallet';

type Reward =
  | { type: 'currency'; currency: 'COINS' | 'GEMS_FREE'; amount: number }
  | { type: 'points'; pointType: 'standard' | 'premium'; amount: number }
  | { type: 'card'; rarity: 'epic' | 'legendary'; fallbackPoints: number };

interface Cell {
  reward: Reward;
  claimed: boolean;
  claimable: boolean;
}

interface Pass {
  season: { id: string; name: string; startsAt: number; endsAt: number };
  xp: number;
  level: number;
  xpPerLevel: number;
  nextLevelXp: number | null;
  premium: boolean;
  premiumPriceGems: number;
  levels: { level: number; free: Cell[]; premium: Cell[] }[];
  claimable: number;
  wallet: Wallet;
}

function rewardText(r: Reward): string {
  if (r.type === 'currency') return r.currency === 'COINS' ? `${fmt(r.amount)} COINS` : `無償GEMS ${fmt(r.amount)}`;
  if (r.type === 'points') return `${r.pointType === 'standard' ? 'Standard' : 'Premium'} pt ${fmt(r.amount)}`;
  return r.rarity === 'epic' ? 'Epic カード' : 'Legendary カード';
}

/** Season Pass (decisions 54, 56) */
export default function PassPage() {
  const { setWallet } = useWallet();
  const catalog = useCatalog();
  const [pass, setPass] = useState<Pass | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (p: Pass) => {
    setPass(p);
    setWallet(p.wallet);
  };
  useEffect(() => {
    api<Pass>('/api/pass')
      .then(apply)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buyPremium = async () => {
    if (!pass) return;
    if (!window.confirm(`プレミアムコースを ${fmt(pass.premiumPriceGems)} GEMS で購入します。無償GEMSから先に使い、足りない分は有償GEMSを使います。`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ pass: Omit<Pass, 'wallet'>; wallet: Wallet }>('/api/pass/premium', { body: { requestId: newRequestId() } });
      apply({ ...r.pass, wallet: r.wallet });
      setMsg('プレミアムコースになりました。到達済みの段階の報酬も受け取れます。');
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ granted: { reward: Reward; playerId?: string | null }[]; pass: Omit<Pass, 'wallet'>; wallet: Wallet }>('/api/pass/claim', { body: { requestId: newRequestId() } });
      apply({ ...r.pass, wallet: r.wallet });
      const cards = r.granted.filter((g) => g.playerId).map((g) => catalog?.get(g.playerId!)?.name ?? g.playerId);
      setMsg(`${r.granted.length}個の報酬を受け取りました${cards.length ? `（カード：${cards.join('、')}）` : ''}`);
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (!pass) return <div className="muted">読み込み中…</div>;
  const into = pass.xp - pass.level * pass.xpPerLevel;
  const daysLeft = Math.max(0, Math.ceil((pass.season.endsAt - Date.now()) / 86_400_000));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="spread">
          <div>
            <div className="tiny muted">SEASON PASS</div>
            <h2 style={{ margin: '2px 0' }}>{pass.season.name}</h2>
            <div className="small muted">残り {daysLeft}日（日本時間の月末まで）</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="display" style={{ fontSize: 30 }}>
              Lv {pass.level}
              <span className="small muted"> / 30</span>
            </div>
            <div className="tiny muted">{pass.nextLevelXp ? `次の段階まで ${pass.nextLevelXp - pass.xp} XP` : '最後の段階に到達'}</div>
          </div>
        </div>
        <div className="meter" style={{ marginTop: 10 }}>
          <div style={{ width: `${pass.nextLevelXp ? (into / pass.xpPerLevel) * 100 : 100}%` }} />
        </div>
        <div className="tiny muted" style={{ marginTop: 4 }}>
          リーグを最後まで遊ぶと 100 XP（1位なら 150）。対戦報酬と同じく1日10リーグまで。1段階 {pass.xpPerLevel} XP。
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy || pass.claimable === 0} onClick={claim}>
            報酬を受け取る（{pass.claimable}）
          </button>
          {pass.premium ? (
            <span className="chip on">プレミアムコース</span>
          ) : (
            <button className="btn" disabled={busy || pass.wallet.gems.total < pass.premiumPriceGems} onClick={buyPremium}>
              プレミアムにする（{fmt(pass.premiumPriceGems)} GEMS）
            </button>
          )}
          <span className="tiny muted">所持 GEMS {fmt(pass.wallet.gems.total)}（無償 {fmt(pass.wallet.gems.free)}）</span>
        </div>
        {msg && <div className="small" style={{ color: 'var(--good)', marginTop: 8 }}>{msg}</div>}
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <div className="panel scroll-x">
        <table className="pass-track">
          <thead>
            <tr>
              <th>段階</th>
              <th>無料コース</th>
              <th>プレミアムコース{!pass.premium && <span className="tiny muted">（未購入）</span>}</th>
            </tr>
          </thead>
          <tbody>
            {pass.levels.map((l) => (
              <tr key={l.level} className={l.level <= pass.level ? 'reached' : ''}>
                <td className="lv">{l.level}</td>
                {(['free', 'premium'] as const).map((t) => (
                  <td key={t} className={t === 'premium' && !pass.premium ? 'locked' : ''}>
                    {l[t].length === 0 && <span className="muted">—</span>}
                    {l[t].map((c, i) => (
                      <span key={i} className={`pass-reward ${c.claimed ? 'claimed' : c.claimable ? 'ready' : ''}`}>
                        {c.claimed ? '✓ ' : ''}
                        {rewardText(c.reward)}
                      </span>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          カードはまだ持っていない選手から選ばれます（全員持っていたら交換ポイント）。手に入れたカードは <Link to="/team">チーム</Link> の編成（MATCH）で使えます。
        </div>
      </div>
    </div>
  );
}
