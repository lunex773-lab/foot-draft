import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MatchDetailModal } from '../components/MatchDetailModal';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface LeagueRow {
  room_id: string;
  code: string;
  mode: string;
  status: string;
  created_at: number;
  final_rank: number | null;
  points: number | null;
  goals_for: number | null;
  goals_against: number | null;
}
interface MatchRow {
  id: string;
  matchday: number;
  home_user_id: string | null;
  away_user_id: string | null;
  home_name: string;
  away_name: string;
  home_goals: number;
  away_goals: number;
  completed_at: number;
}

export default function HistoryPage() {
  const { me } = useAuth();
  const [leagues, setLeagues] = useState<LeagueRow[] | null>(null);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: LeagueRow[] }>('/api/users/me/history').then((r) => setLeagues(r.items));
    api<{ items: MatchRow[] }>('/api/matches/history').then((r) => setMatches(r.items));
  }, []);
  const result = (m: MatchRow) => {
    const home = m.home_user_id === me?.id;
    const gf = home ? m.home_goals : m.away_goals;
    const ga = home ? m.away_goals : m.home_goals;
    return gf > ga ? { t: '勝', c: 'var(--good)' } : gf < ga ? { t: '負', c: 'var(--bad)' } : { t: '分', c: 'var(--muted)' };
  };
  const total = matches ?? [];
  const wins = total.filter((m) => result(m).t === '勝').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <h2>リーグ履歴</h2>
        {leagues === null ? (
          <div className="muted">読み込み中…</div>
        ) : leagues.length === 0 ? (
          <div className="muted">まだ対戦していません。</div>
        ) : (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>モード</th>
                  <th>状態</th>
                  <th className="num">順位</th>
                  <th className="num">勝点</th>
                  <th className="num">得失</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {leagues.map((l) => (
                  <tr key={l.room_id}>
                    <td>{new Date(l.created_at).toLocaleString('ja-JP')}</td>
                    <td>{l.mode === 'quick' ? 'クイック' : 'プライベート'}</td>
                    <td>{l.status === 'finished' ? '終了' : '進行中'}</td>
                    <td className={`num rank-${l.final_rank}`}>{l.final_rank ?? '-'}</td>
                    <td className="num">{l.points ?? '-'}</td>
                    <td className="num">{l.goals_for !== null ? `${l.goals_for}-${l.goals_against}` : '-'}</td>
                    <td>
                      <Link to={`/room/${l.room_id}`}>{l.status === 'finished' ? '結果' : '戻る'}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="panel">
        <div className="spread">
          <h2>試合履歴</h2>
          {total.length > 0 && (
            <span className="chip">
              {total.length}試合・{wins}勝・勝率 {Math.round((wins / total.length) * 100)}%
            </span>
          )}
        </div>
        {matches === null ? (
          <div className="muted">読み込み中…</div>
        ) : (
          matches.map((m) => {
            const r = result(m);
            return (
              <div key={m.id} className="spread small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span>
                  <b style={{ color: r.c, marginRight: 8 }}>{r.t}</b>
                  {m.home_name} <b className="display">{m.home_goals} - {m.away_goals}</b> {m.away_name}
                  <span className="muted tiny">　第{m.matchday}節・{new Date(m.completed_at).toLocaleDateString('ja-JP')}</span>
                </span>
                <span className="row">
                  <button className="btn small ghost" onClick={() => setDetail(m.id)}>
                    詳細
                  </button>
                  <Link className="btn small" to={`/match/${m.id}`}>
                    リプレイ
                  </Link>
                </span>
              </div>
            );
          })
        )}
      </div>
      {detail && <MatchDetailModal matchId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
