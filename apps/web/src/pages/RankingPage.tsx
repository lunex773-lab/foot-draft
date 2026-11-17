import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TierBadge } from '../components/TierBadge';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmt } from '../lib/wallet';

interface Board {
  season: { id: string; name: string; endsAt: number };
  items: { position: number; userId: string; displayName: string; rating: number; games: number; wins: number; member?: boolean }[];
  me: { position: number | null; players: number };
}

export interface DraftMatchMe {
  season: { id: string; name: string };
  rating: number;
  games: number;
  wins: number;
  peak: number;
  position: number | null;
  players: number;
  activeRoomId: string | null;
}

/** DRAFT MATCH ranking (decision 77): rating per monthly season, DRAFT MATCH only */
export default function RankingPage() {
  const { me } = useAuth();
  const [board, setBoard] = useState<Board | null>(null);
  const [mine, setMine] = useState<DraftMatchMe | null>(null);
  useEffect(() => {
    api<Board>('/api/draft-match/ranking').then(setBoard).catch(() => undefined);
    api<DraftMatchMe>('/api/draft-match/me').then(setMine).catch(() => undefined);
  }, []);
  return (
    <div className="screen">
      <section className="page-head">
        <div className="eyebrow">DRAFT MATCH</div>
        <h1>RANKING</h1>
        <p>{board ? `${board.season.name}（毎月リセット・日本時間）` : '読み込み中…'}</p>
      </section>
      {mine && (
        <article className="fd-card">
          <div className="stat-row three">
            <div>
              <div className="stat-label">RATING</div>
              <div className="stat-value">
                <TierBadge rating={mine.rating} />
              </div>
            </div>
            <div>
              <div className="stat-label">順位</div>
              <div className="stat-value neon">{mine.position ? `${mine.position}位` : '—'}</div>
              <div className="stat-sub">{mine.players}人中</div>
            </div>
            <div>
              <div className="stat-label">試合</div>
              <div className="stat-value">{fmt(mine.games)}</div>
              <div className="stat-sub">1位 {fmt(mine.wins)}回</div>
            </div>
          </div>
          <p className="tiny muted flush" style={{ marginTop: 8 }}>
            順位と相手の強さでレートが上下します（2〜4人のどの人数でも公平）。月末の順位でシーズン報酬（無償GEMS）がもらえます。MATCH ではレートは変わりません。
          </p>
        </article>
      )}
      <article className="fd-card">
        {board && board.items.length === 0 && <p className="flush muted">今シーズンの DRAFT MATCH はまだ行われていません。</p>}
        <div className="list">
          {board?.items.map((r) => (
            <div key={r.userId} className={`list-item rank ${r.userId === me?.id ? 'me' : ''}`}>
              <span>
                <b className={`rank-${r.position}`}>{String(r.position).padStart(2, '0')}</b> · {r.displayName}
                {r.member && <span className="member-badge inline">★</span>}
                <span className="tiny muted"> {r.games}試合</span>
              </span>
              <TierBadge rating={r.rating} />
            </div>
          ))}
        </div>
      </article>
      <div className="button-row center">
        <Link className="btn ghost" to="/play">
          モード選択へ
        </Link>
      </div>
    </div>
  );
}
