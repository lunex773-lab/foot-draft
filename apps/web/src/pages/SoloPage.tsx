import type { PoolAnalysis, SoloChallenge, TeamLeagueRecord } from '@fd/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { errorText, formatDateTime } from '../lib/labels';
import { useNow } from '../lib/useNow';

interface Today {
  challenge: SoloChallenge;
  poolConditions: string[];
  pool: PoolAnalysis;
  endsAt: number;
  cleared: boolean;
  attempts: { id: string; room_id: string; status: 'playing' | 'cleared' | 'failed'; result: TeamLeagueRecord | null; created_at: number }[];
}

interface HistoryItem {
  challengeId: string;
  dateKey: string;
  title: string;
  difficulty: number;
  attempts: number;
  cleared: boolean;
}

const STATUS_LABEL = { playing: 'プレイ中', cleared: '達成', failed: '未達成' } as const;

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`難易度 ${n}`}>
      {'★'.repeat(n)}
      <span style={{ opacity: 0.25 }}>{'★'.repeat(3 - n)}</span>
    </span>
  );
}

/** Solo Challenge: today's challenge (spec 2-6). */
export default function SoloPage() {
  const nav = useNavigate();
  const now = useNow(1000);
  const [today, setToday] = useState<Today | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Today>('/api/solo/today').then(setToday).catch(() => undefined);
    api<{ items: HistoryItem[] }>('/api/solo/history').then((r) => setHistory(r.items)).catch(() => undefined);
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ roomId: string }>('/api/solo/start', { body: {} });
      nav(`/room/${r.roomId}`);
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (!today) return <div className="muted">読み込み中…</div>;
  const c = today.challenge;
  const playing = today.attempts.find((a) => a.status === 'playing');
  const hoursLeft = Math.max(0, Math.floor((today.endsAt - now) / 3600000));
  const minutesLeft = Math.max(0, Math.floor(((today.endsAt - now) % 3600000) / 60000));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="spread">
          <div>
            <div className="small muted">
              SOLO CHALLENGE　{c.dateKey}（日本時間）・残り {hoursLeft}時間{minutesLeft}分
            </div>
            <h2 style={{ margin: '4px 0' }}>{c.titleJa}</h2>
            <div className="small">
              難易度 <Stars n={c.difficulty} />
              {today.cleared && <span className="chip on" style={{ marginLeft: 8 }}>達成済み</span>}
            </div>
          </div>
          {playing ? (
            <Link className="btn primary" to={`/room/${playing.room_id}`}>
              続きをプレイ
            </Link>
          ) : (
            <button className="btn primary" disabled={busy} onClick={start}>
              挑戦する
            </button>
          )}
        </div>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        <div className="grid3" style={{ marginTop: 14 }}>
          <div className="stat">
            <div className="label">目標</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{c.goalJa}</div>
          </div>
          <div className="stat">
            <div className="label">ドラフト候補</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{c.pool.labelJa}</div>
            <div className="tiny muted">{today.poolConditions.join('・')}</div>
          </div>
          <div className="stat">
            <div className="label">特別ルール</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{c.ruleJa}</div>
          </div>
        </div>
        <ul className="small muted" style={{ lineHeight: 1.8, paddingLeft: 18, marginBottom: 0 }}>
          <li>あなた＋CPU 3チームでドラフトし、総当たりリーグ（3試合）を戦います。CPUも同じ候補から指名します</li>
          <li>課題は毎日（日本時間0時）変わります。何度でも挑戦できます</li>
          <li>達成状況は記録されます。報酬は通貨の実装後に配布予定（現在は記録のみ）</li>
        </ul>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>今日の挑戦</h3>
          {today.attempts.length === 0 && <div className="muted small">まだ挑戦していません。</div>}
          {today.attempts.map((a) => (
            <div key={a.id} className="spread small" style={{ padding: '4px 0' }}>
              <span>
                {formatDateTime(a.created_at)}
                <b className={a.status === 'cleared' ? 'delta-up' : a.status === 'failed' ? 'delta-down' : ''}>{STATUS_LABEL[a.status]}</b>
                {a.result && (
                  <span className="muted">
                    　{a.result.rank}位・{a.result.won}勝{a.result.drawn}分{a.result.lost}敗・{a.result.goalsFor}得点{a.result.goalsAgainst}失点
                  </span>
                )}
              </span>
              <Link className="btn small ghost" to={`/room/${a.room_id}`}>
                {a.status === 'playing' ? '戻る' : '結果'}
              </Link>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>これまでの課題</h3>
          {history.length === 0 && <div className="muted small">記録はまだありません。</div>}
          {history.map((h) => (
            <div key={h.challengeId} className="spread small" style={{ padding: '4px 0' }}>
              <span>
                {h.dateKey}　<Stars n={h.difficulty} />　{h.title}
              </span>
              <span className={h.cleared ? 'delta-up' : 'muted'}>{h.cleared ? '達成' : `未達成（${h.attempts}回）`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
