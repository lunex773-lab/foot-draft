import { GAME_CONFIG } from '@fd/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/labels';

interface HistoryRow {
  room_id: string;
  code: string;
  mode: string;
  status: string;
  created_at: number;
  final_rank: number | null;
}

export default function HomePage() {
  const { me } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [pickSeconds, setPickSeconds] = useState<number>(GAME_CONFIG.pickSeconds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<{ leaguesPlayed: number; leaguesWon: number } | null>(null);

  useEffect(() => {
    api<{ items: HistoryRow[] }>('/api/users/me/history')
      .then((r) => setActive(r.items.filter((x) => x.status !== 'finished')))
      .catch(() => undefined);
    api<{ stats: { leaguesPlayed: number; leaguesWon: number } }>('/api/users/me')
      .then((r) => setStats(r.stats))
      .catch(() => undefined);
  }, []);

  const go = async (fn: () => Promise<{ roomId: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      nav(`/room/${r.roomId}`);
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="hero">
        <h1>
          FOOTBALL <span>DRAFT</span>
        </h1>
        <p>
          ようこそ、{me?.displayName} さん{stats && `　リーグ ${stats.leaguesPlayed}回・優勝 ${stats.leaguesWon}回`}
        </p>
      </div>
      {active.length > 0 && (
        <div className="panel">
          <h3>進行中のルーム</h3>
          {active.map((r) => (
            <div key={r.room_id} className="spread small" style={{ padding: '4px 0' }}>
              <span>
                {r.mode === 'quick' ? 'クイック' : 'プライベート'}・コード {r.code}・{r.status}
              </span>
              <Link className="btn small" to={`/room/${r.room_id}`}>
                戻る
              </Link>
            </div>
          ))}
        </div>
      )}
      <div className="grid3">
        <div className="panel mode-card">
          <div className="title">QUICK DRAFT</div>
          <div className="small muted">空いているルームに参加します。ホストはいつでも開始でき、空席はCPUが入ります。4人そろうと自動で開始。</div>
          <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/rooms/quick', { body: {} }))}>
            クイックドラフト
          </button>
        </div>
        <div className="panel mode-card">
          <div className="title">PRIVATE ROOM</div>
          <div className="small muted">友だちと対戦。招待コード・招待リンクで参加できます。</div>
          <label className="field">
            1ピックの制限時間
            <select value={pickSeconds} onChange={(e) => setPickSeconds(Number(e.target.value))}>
              {GAME_CONFIG.pickSecondsOptions.map((s) => (
                <option key={s} value={s}>
                  {s}秒
                </option>
              ))}
            </select>
          </label>
          <button className="btn" disabled={busy} onClick={() => go(() => api('/api/rooms', { body: { settings: { pickSeconds, fillWithCpu: true } } }))}>
            ルームを作成
          </button>
        </div>
        <div className="panel mode-card">
          <div className="title">JOIN</div>
          <div className="small muted">招待コード（6文字）を入力して参加します。</div>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="例：AB12CD" aria-label="招待コード" style={{ letterSpacing: '0.2em', fontFamily: 'var(--display)', fontSize: 18 }} />
          <button className="btn" disabled={busy || code.length !== 6} onClick={() => go(() => api('/api/rooms/join', { body: { code } }))}>
            参加する
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn ghost" to="/history">
          対戦履歴
        </Link>
        <Link className="btn ghost" to="/cards">
          選手図鑑
        </Link>
      </div>
    </div>
  );
}

export function JoinByLink() {
  const nav = useNavigate();
  const code = window.location.pathname.split('/').pop() ?? '';
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ roomId: string }>('/api/rooms/join', { body: { code } })
      .then((r) => nav(`/room/${r.roomId}`, { replace: true }))
      .catch((e) => setError(errorText((e as { code?: string }).code ?? '', (e as Error).message)));
  }, [code, nav]);
  return error ? <div className="error">{error}</div> : <div className="muted">ルームに参加しています…</div>;
}
