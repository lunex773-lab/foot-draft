import { tierOf } from '@fd/shared';
import { useEffect, useState } from 'react';
import { adminApi } from './api';

interface SeasonRow {
  id: string;
  name: string;
  starts_at: number;
  ends_at: number;
  status: 'active' | 'finished';
  finalized_at: number | null;
  players: number;
  leagues: number;
  rated_leagues: number;
}

interface BoardRow {
  position: number;
  userId: string;
  displayName: string;
  rating: number;
  games: number;
  wins: number;
}

/** seasons are defined in Japan time */
const fmt = (ms: number) => new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Ranked seasons (monthly, Japan time) and leaderboards — read only. */
export function SeasonsPage() {
  const [seasons, setSeasons] = useState<SeasonRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminApi<{ items: SeasonRow[] }>('/seasons')
      .then((r) => {
        setSeasons(r.items);
        setSelected(r.items[0]?.id ?? null);
      })
      .catch((e) => setError(String(e.message)));
  }, []);
  useEffect(() => {
    if (!selected) return;
    setBoard(null);
    adminApi<{ items: BoardRow[] }>(`/seasons/${selected}/leaderboard`)
      .then((r) => setBoard(r.items))
      .catch((e) => setError(String(e.message)));
  }, [selected]);

  return (
    <div>
      <h1>シーズン・ランキング</h1>
      <div className="small muted" style={{ marginBottom: 12 }}>
        Ranked のシーズンは日本時間の月初に自動で切り替わり、終了時の順位が記録されます（シーズン報酬は通貨の実装後）。この画面は閲覧のみです。
      </div>
      {error && <div className="error">{error}</div>}
      {seasons && (
        <div className="panel scroll-x" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>シーズン</th>
                <th>期間（日本時間）</th>
                <th>状態</th>
                <th>参加者</th>
                <th>リーグ（レート対象）</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                  </td>
                  <td className="small">
                    {fmt(s.starts_at)} 〜 {fmt(s.ends_at)}
                  </td>
                  <td>{s.status === 'active' ? <span className="status published">開催中</span> : <span className="status archived">終了（{s.finalized_at ? fmt(s.finalized_at) : '-'}）</span>}</td>
                  <td>{s.players}</td>
                  <td>
                    {s.leagues}（{s.rated_leagues}）
                  </td>
                  <td>
                    <button className={`btn ${selected === s.id ? 'on' : ''}`} onClick={() => setSelected(s.id)}>
                      ランキング
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <div className="panel scroll-x">
          <h3>{seasons?.find((s) => s.id === selected)?.name} ランキング（上位100人）</h3>
          {board && board.length === 0 && <div className="muted small">記録はまだありません。</div>}
          {board && board.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>順位</th>
                  <th>プレイヤー</th>
                  <th>ユーザーID</th>
                  <th>レート</th>
                  <th>ティア</th>
                  <th>試合</th>
                  <th>1位</th>
                </tr>
              </thead>
              <tbody>
                {board.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.position}</td>
                    <td>{r.displayName}</td>
                    <td className="tiny muted">{r.userId}</td>
                    <td>
                      <b>{r.rating}</b>
                    </td>
                    <td style={{ color: tierOf(r.rating).color }}>{tierOf(r.rating).labelJa}</td>
                    <td>{r.games}</td>
                    <td>{r.wins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
