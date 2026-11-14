import type { PoolAnalysis } from '@fd/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { errorText, formatDateTime } from '../lib/labels';

export interface EventItem {
  id: string;
  name: string;
  description: string;
  startsAt: number;
  endsAt: number;
  open: boolean;
  conditions: string[];
  pool: PoolAnalysis;
  my?: { played: number; bestRank: number | null; wins: number };
}

export function eventPeriod(e: { startsAt: number; endsAt: number }) {
  return `${formatDateTime(e.startsAt)} 〜 ${formatDateTime(e.endsAt)}`;
}

export function poolNote(p: PoolAnalysis) {
  return p.pure ? `候補${p.poolSize}人はすべて対象選手` : `対象選手${p.included}人が全員候補に入り、残り${p.poolSize - p.included}人は通常の選手`;
}

function useJoin() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ roomId: string }>(`/api/events/${id}/join`, { body: {} });
      nav(`/room/${r.roomId}`);
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return { join, busy, error };
}

/** Special Events list (spec 2-5). */
export default function EventsPage() {
  const [items, setItems] = useState<EventItem[] | null>(null);
  const { join, busy, error } = useJoin();
  useEffect(() => {
    api<{ items: EventItem[] }>('/api/events').then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <h2>SPECIAL EVENTS</h2>
        <div className="small muted">期間限定でドラフトの候補が変わる対戦です。4人まで（空席はCPU）、総当たりリーグで順位を決めます。報酬は通貨の実装後に配布予定（現在は記録のみ）。</div>
      </div>
      {error && <div className="error">{error}</div>}
      {items && items.length === 0 && <div className="panel muted">開催中・開催予定のイベントはありません。</div>}
      <div className="grid2">
        {items?.map((e) => (
          <div key={e.id} className="panel event-card">
            <div className="spread">
              <span className="name">{e.name}</span>
              <span className={`chip ${e.open ? 'on' : ''}`}>{e.open ? '開催中' : '開催予定'}</span>
            </div>
            <div className="small muted">{eventPeriod(e)}</div>
            <div className="small">{e.description}</div>
            <div className="row">
              {e.conditions.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </div>
            <div className="tiny muted">{poolNote(e.pool)}</div>
            {e.my && e.my.played > 0 && (
              <div className="tiny">
                参加 {e.my.played}回・最高 {e.my.bestRank}位・優勝 {e.my.wins}回
              </div>
            )}
            <div className="row">
              <button className="btn primary" disabled={busy || !e.open} onClick={() => join(e.id)}>
                参加する
              </button>
              <Link className="btn ghost" to={`/events/${e.id}`}>
                詳細
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const [data, setData] = useState<{ event: EventItem; my: { played: number; bestRank: number | null; wins: number }; recent: { room_id: string; status: string; created_at: number; final_rank: number | null; points: number | null }[] } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { join, busy, error } = useJoin();
  useEffect(() => {
    api<typeof data>(`/api/events/${eventId}`)
      .then(setData)
      .catch(() => setNotFound(true));
  }, [eventId]);
  if (notFound) return <div className="panel muted">イベントが見つかりません。</div>;
  if (!data) return <div className="muted">読み込み中…</div>;
  const e = data.event;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel event-card">
        <div className="spread">
          <span className="name">{e.name}</span>
          <span className={`chip ${e.open ? 'on' : ''}`}>{e.open ? '開催中' : '開催期間外'}</span>
        </div>
        <div className="small muted">{eventPeriod(e)}</div>
        <div>{e.description}</div>
        <div className="row">
          {e.conditions.map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
        <div className="small muted">{poolNote(e.pool)}</div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <button className="btn primary" disabled={busy || !e.open} onClick={() => join(e.id)}>
            参加する
          </button>
          <Link className="btn ghost" to="/events">
            イベント一覧
          </Link>
        </div>
      </div>
      <div className="panel">
        <h3>あなたの成績</h3>
        <div className="small">
          参加 {data.my.played}回・最高 {data.my.bestRank ?? '-'}位・優勝 {data.my.wins}回
        </div>
        {data.recent.map((r) => (
          <div key={r.room_id} className="spread small" style={{ padding: '4px 0' }}>
            <span>
              {formatDateTime(r.created_at)}　{r.final_rank ? `${r.final_rank}位（${r.points}点）` : '進行中'}
            </span>
            <Link className="btn small ghost" to={`/room/${r.room_id}`}>
              {r.final_rank ? '結果' : '戻る'}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
