import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { errorText, modeLabel } from '../lib/labels';
import { MyTeamCard } from './HomePage';

export interface HistoryRow {
  room_id: string;
  code: string;
  mode: string;
  status: string;
  created_at: number;
  final_rank: number | null;
}

const STATUS_LABEL: Record<string, string> = { lobby: '待機中', drafting: 'ドラフト中', lineup: '編成中', playing: '試合中' };

/** rooms the player has not finished (shown on the home screen and here) */
export function ActiveRooms({ rooms }: { rooms: HistoryRow[] }) {
  if (rooms.length === 0) return null;
  return (
    <article className="fd-card live">
      <div className="fd-card-header">
        <h3>進行中のルーム</h3>
        <span className="badge on">LIVE</span>
      </div>
      <div className="list">
        {rooms.map((r) => (
          <div key={r.room_id} className="list-item">
            <span>
              {modeLabel(r.mode)}
              {r.mode === 'quick' || r.mode === 'private' || r.mode === 'match' ? `・${r.code}` : ''}・{STATUS_LABEL[r.status] ?? r.status}
            </span>
            <Link className="btn small primary" to={`/room/${r.room_id}`}>
              戻る
            </Link>
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * Mode select (opened by the DUEL button): MATCH (official spec v2.0) and,
 * coming next, DRAFT MATCH. The draft modes before them are no longer offered.
 */
export default function PlayPage() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<HistoryRow[]>([]);

  useEffect(() => {
    api<{ items: HistoryRow[] }>('/api/users/me/history')
      .then((r) => setActive(r.items.filter((x) => x.status !== 'finished' && x.status !== 'closed')))
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
    <div className="screen">
      <section className="page-head">
        <div className="eyebrow">ENTER THE ARENA</div>
        <h1>MODE SELECT</h1>
        <p>遊ぶモードを選んでください。</p>
      </section>
      {error && <div className="error">{error}</div>}
      <ActiveRooms rooms={active} />
      <section className="cards">
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>MATCH</h3>
            <span className="badge">4 PLAYERS</span>
          </div>
          <p>
            「使用中」のチーム（持っているカード・強化込み）で出場。4人の総当たりリーグを3試合戦います。ホストはいつでも開始でき、空席はCPUチーム。4人そろうと自動で開始します。
          </p>
          <p className="tiny muted flush">報酬：COINS（1日10リーグまで）＋ 順位に応じた Standard 交換ポイント（1位30・2位20・3位10・4位5）</p>
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/match/quick', { body: {} }))}>
              MATCH を探す
            </button>
            <Link className="btn" to="/team">
              チームを編集
            </Link>
          </div>
        </article>
        <article className="fd-card soon">
          <div className="fd-card-header">
            <h3>DRAFT MATCH</h3>
            <span className="badge">準備中</span>
          </div>
          <p>2〜4人。全員共通のカードプールから、チンチロで決めた順番のスネークドラフトで11人を指名して戦います。持っているカードや強化は使いません。ランキングポイントはこのモード専用です。</p>
          <div className="button-row">
            <button className="btn" disabled>
              近日公開
            </button>
          </div>
        </article>
      </section>

      <MyTeamCard />

      <div className="section-title">
        <h2>PRIVATE MATCH</h2>
        <span>FRIENDS</span>
      </div>
      <section className="cards">
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>ルームを作る</h3>
          </div>
          <p>友だちと MATCH で対戦。作ったあと、招待コード・招待リンクを送ります。知らない人とはマッチしません。</p>
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/match/private', { body: {} }))}>
              ルームを作成
            </button>
          </div>
        </article>
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>コードで参加</h3>
          </div>
          <p>招待コード（6文字）を入力して参加します。</p>
          <div className="button-row">
            <input className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="AB12CD" aria-label="招待コード" autoCapitalize="characters" />
            <button className="btn primary" disabled={busy || code.length !== 6} onClick={() => go(() => api('/api/rooms/join', { body: { code } }))}>
              参加する
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
