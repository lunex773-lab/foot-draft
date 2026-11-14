import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { errorText } from '../lib/labels';
import { fmt, useWallet, type Wallet } from '../lib/wallet';

interface Mission {
  id: string;
  period: 'daily' | 'weekly' | 'beginner';
  periodKey: string;
  title: string;
  target: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  reward: { currency: 'COINS' | 'GEMS_FREE'; amount: number };
}

const PERIOD_LABEL = { daily: 'デイリー（毎日 日本時間0時に更新）', weekly: 'ウィークリー（毎週月曜 日本時間0時に更新）', beginner: '初心者ミッション' } as const;
const rewardText = (r: Mission['reward']) => `${fmt(r.amount)} ${r.currency === 'COINS' ? 'COINS' : '無償GEMS'}`;

/** Missions (spec 10). Progress is counted by the server. */
export default function MissionsPage() {
  const { setWallet } = useWallet();
  const [items, setItems] = useState<Mission[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ items: Mission[] }>('/api/missions')
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  const claim = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ wallet: Wallet; paid?: number; results?: { paid: number; reward: Mission['reward'] }[] }>(path, { body: {} });
      setWallet(r.wallet);
      const got = r.results ?? [{ paid: r.paid ?? 0, reward: items!.find((m) => path.includes(`/${m.id}/`))!.reward }];
      const coins = got.filter((g) => g.reward.currency === 'COINS').reduce((s, g) => s + g.paid, 0);
      const gems = got.filter((g) => g.reward.currency === 'GEMS_FREE').reduce((s, g) => s + g.paid, 0);
      setMsg(`受け取りました：${[coins && `${fmt(coins)} COINS`, gems && `${fmt(gems)} 無償GEMS`].filter(Boolean).join('・') || 'なし'}`);
      await load();
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (!items) return <div className="muted">読み込み中…</div>;
  const ready = items.filter((m) => m.completed && !m.claimed).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>ミッション</h2>
          <button className="btn primary small" disabled={busy || ready === 0} onClick={() => claim('/api/missions/claim-all')}>
            まとめて受け取る（{ready}）
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          リーグを最後まで遊ぶと進みます（対戦報酬の1日10リーグの上限を超えても進みます）。
        </div>
        {msg && <div className="small" style={{ color: 'var(--good)', marginTop: 8 }}>{msg}</div>}
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
      {(['daily', 'weekly', 'beginner'] as const).map((period) => {
        const list = items.filter((m) => m.period === period);
        if (period === 'beginner' && list.every((m) => m.claimed)) return null;
        return (
          <div key={period} className="panel">
            <h3>{PERIOD_LABEL[period]}</h3>
            {list.map((m) => (
              <div key={m.id} className="mission">
                <div style={{ flex: 1 }}>
                  <div className="small">{m.title}</div>
                  <div className="meter" style={{ marginTop: 4 }}>
                    <div style={{ width: `${(m.progress / m.target) * 100}%`, background: m.completed ? 'var(--good)' : 'var(--accent)' }} />
                  </div>
                  <div className="tiny muted">
                    {m.progress} / {m.target}　報酬 {rewardText(m.reward)}
                  </div>
                </div>
                {m.claimed ? (
                  <span className="chip">受け取り済み</span>
                ) : (
                  <button className="btn small primary" disabled={busy || !m.completed} onClick={() => claim(`/api/missions/${m.id}/claim`)}>
                    {m.completed ? '受け取る' : '未達成'}
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
