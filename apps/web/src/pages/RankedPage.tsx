import { TIERS, tierOf } from '@fd/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TierBadge } from '../components/TierBadge';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorText, formatDateTime, signed } from '../lib/labels';

interface RankedMe {
  season: { id: string; name: string; startsAt: number; endsAt: number };
  rating: number;
  peak: number;
  games: number;
  wins: number;
  position: number | null;
  players: number;
  queueSeconds: number;
  recent: { room_id: string; season_id: string; final_rank: number; humans: number; rated: number; rating_before: number; rating_after: number; delta: number; created_at: number }[];
}

interface Board {
  season: { id: string; name: string };
  items: { position: number; userId: string; displayName: string; rating: number; games: number; wins: number; member?: boolean }[];
  me: { position: number | null; players: number };
}

interface SeasonRow {
  id: string;
  name: string;
  status: string;
  final_rating: number | null;
  final_position: number | null;
  games: number | null;
}

/** Ranked: my rating, season, leaderboard (spec 2-2). */
export default function RankedPage() {
  const { me: user } = useAuth();
  const nav = useNavigate();
  const [me, setMe] = useState<RankedMe | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [season, setSeason] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<RankedMe>('/api/ranked/me').then(setMe).catch(() => undefined);
    api<{ items: SeasonRow[] }>('/api/ranked/seasons').then((r) => setSeasons(r.items)).catch(() => undefined);
  }, []);
  useEffect(() => {
    api<Board>(`/api/ranked/leaderboard${season ? `?season=${season}` : ''}`).then(setBoard).catch(() => undefined);
  }, [season]);

  const queue = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ roomId: string }>('/api/ranked/queue', { body: {} });
      nav(`/room/${r.roomId}`);
    } catch (e) {
      setError(errorText((e as { code?: string }).code ?? '', (e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const daysLeft = me ? Math.max(0, Math.ceil((me.season.endsAt - Date.now()) / 86400000)) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="spread">
          <div>
            <h2 style={{ marginBottom: 4 }}>RANKED</h2>
            <div className="small muted">{me ? `${me.season.name}（あと${daysLeft}日・日本時間の月初に切り替え）` : '読み込み中…'}</div>
          </div>
          <button className="btn primary" disabled={busy} onClick={queue}>
            ランク戦を探す
          </button>
        </div>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        {me && (
          <div className="stat-row" style={{ marginTop: 14 }}>
            <div className="stat">
              <div className="label">レート</div>
              <div style={{ marginTop: 4 }}>
                <TierBadge rating={me.rating} size="large" />
              </div>
            </div>
            <div className="stat">
              <div className="label">順位</div>
              <div className="value">{me.position ? `${me.position}位` : '-'}</div>
              <div className="tiny muted">{me.players}人中</div>
            </div>
            <div className="stat">
              <div className="label">試合（リーグ）</div>
              <div className="value">{me.games}</div>
            </div>
            <div className="stat">
              <div className="label">1位</div>
              <div className="value">{me.wins}</div>
            </div>
            <div className="stat">
              <div className="label">最高レート</div>
              <div className="value">{me.peak}</div>
            </div>
          </div>
        )}
        <ul className="small muted" style={{ lineHeight: 1.8, paddingLeft: 18, marginBottom: 0 }}>
          <li>4人の総当たりリーグの最終順位でレートが変わります（Elo方式。強い相手より上の順位になるほど大きく上がる）</li>
          <li>4人そろわない時は{me?.queueSeconds ?? 60}秒待ってCPUが入ります。レートは人間同士の順位だけで変わり、人間が1人の時は変わりません</li>
          <li>全員が同じ候補から指名します（所持カードの差はありません）</li>
          <li>新しいシーズンは前のシーズンのレートを1000に向けて半分戻して始まります。シーズン報酬は通貨の実装後に配布予定（現在は記録のみ）</li>
        </ul>
      </div>
      <div className="grid2">
        <div className="panel">
          <div className="spread" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>ランキング（上位100人）</h3>
            <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="シーズン">
              <option value="">今シーズン</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {board && board.items.length === 0 && <div className="muted small">まだ記録がありません。</div>}
          {board && board.items.length > 0 && (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>順位</th>
                    <th>プレイヤー</th>
                    <th>レート</th>
                    <th>試合</th>
                    <th>1位</th>
                  </tr>
                </thead>
                <tbody>
                  {board.items.map((r) => (
                    <tr key={r.userId} className={r.userId === user?.id ? 'me' : ''}>
                      <td className="display">{r.position}</td>
                      <td>
                        {r.member && <span className="member-badge" title="Premium Membership 会員">★</span>}
                        {r.displayName}
                      </td>
                      <td>
                        <TierBadge rating={r.rating} />
                      </td>
                      <td>{r.games}</td>
                      <td>{r.wins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <h3>最近のランク戦</h3>
            {me && me.recent.length === 0 && <div className="muted small">まだランク戦をしていません。</div>}
            {me?.recent.map((r) => (
              <div key={r.room_id} className="spread small" style={{ padding: '4px 0' }}>
                <span>
                  {formatDateTime(r.created_at)}　{r.final_rank}位
                  {r.rated ? (
                    <b className={r.delta >= 0 ? 'delta-up' : 'delta-down'} style={{ marginLeft: 8 }}>
                      {signed(r.delta)}（{r.rating_after}）
                    </b>
                  ) : (
                    <span className="muted" style={{ marginLeft: 8 }}>
                      レート変動なし（人間{r.humans}人）
                    </span>
                  )}
                </span>
                <Link className="btn small ghost" to={`/room/${r.room_id}`}>
                  結果
                </Link>
              </div>
            ))}
          </div>
          <div className="panel">
            <h3>ティア（暫定）</h3>
            <div className="row">
              {TIERS.map((t) => (
                <span key={t.id} className="chip" style={{ borderColor: t.color, color: t.color }}>
                  {t.labelJa} {Number.isFinite(t.min) ? `${t.min}〜` : `〜${TIERS[1].min - 1}`}
                </span>
              ))}
            </div>
            {me && <div className="tiny muted" style={{ marginTop: 8 }}>現在：{tierOf(me.rating).labelJa}</div>}
          </div>
          <div className="panel">
            <h3>過去のシーズン</h3>
            {seasons.filter((s) => s.status === 'finished').length === 0 && <div className="muted small">終了したシーズンはまだありません。</div>}
            {seasons
              .filter((s) => s.status === 'finished')
              .map((s) => (
                <div key={s.id} className="spread small" style={{ padding: '3px 0' }}>
                  <span>{s.name}</span>
                  <span className="muted">{s.final_position ? `${s.final_position}位・レート ${s.final_rating}` : '参加なし'}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
