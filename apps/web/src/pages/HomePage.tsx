import { type SoloChallenge } from '@fd/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DuelButton } from '../components/DuelButton';
import { TierBadge } from '../components/TierBadge';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/labels';
import { fmt, useWallet } from '../lib/wallet';
import { type EventItem } from './EventsPage';
import { ActiveRooms, type HistoryRow } from './PlayPage';

interface Board {
  season: { id: string; name: string };
  items: { position: number; userId: string; displayName: string; rating: number; member?: boolean }[];
  me: { position: number | null; players: number };
}

/**
 * Home (design from the user, 2026-11-17): hero, the DUEL button (opens the
 * mode select), the main modes, today's rewards, events and the top of the
 * ranked leaderboard. Every number comes from the server.
 */
export default function HomePage() {
  const { me } = useAuth();
  const nav = useNavigate();
  const { wallet, login, matchRewards } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<{ leaguesPlayed: number; leaguesWon: number } | null>(null);
  const [ranked, setRanked] = useState<{ rating: number; games: number; position: number | null; season: { name: string } } | null>(null);
  const [solo, setSolo] = useState<{ challenge: SoloChallenge; cleared: boolean } | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [missionsReady, setMissionsReady] = useState(0);
  const [pass, setPass] = useState<{ level: number; claimable: number } | null>(null);

  useEffect(() => {
    api<typeof ranked>('/api/ranked/me').then(setRanked).catch(() => undefined);
    api<typeof solo>('/api/solo/today').then(setSolo).catch(() => undefined);
    api<Board>('/api/ranked/leaderboard').then(setBoard).catch(() => undefined);
    api<{ items: EventItem[] }>('/api/events')
      .then((r) => setEvents(r.items.filter((e) => e.open)))
      .catch(() => undefined);
    api<{ items: HistoryRow[] }>('/api/users/me/history')
      .then((r) => setActive(r.items.filter((x) => x.status !== 'finished' && x.status !== 'closed')))
      .catch(() => undefined);
    api<{ items: { completed: boolean; claimed: boolean }[] }>('/api/missions')
      .then((r) => setMissionsReady(r.items.filter((m) => m.completed && !m.claimed).length))
      .catch(() => undefined);
    api<{ level: number; claimable: number }>('/api/pass')
      .then((r) => setPass({ level: r.level, claimable: r.claimable }))
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
    <div className="screen">
      <section className="hero">
        <div className="eyebrow">BUILD YOUR LEGACY</div>
        <h1>
          FOOTBALL <span>DRAFT</span>
        </h1>
        <p>
          ようこそ、{me?.displayName} さん。次の対決に挑戦しよう。
          {stats && stats.leaguesPlayed > 0 && (
            <>
              <br />
              リーグ {stats.leaguesPlayed}回・優勝 {stats.leaguesWon}回
            </>
          )}
        </p>
      </section>

      <ActiveRooms rooms={active} />

      <section className="duel-card">
        <div className="duel-kicker">ENTER THE ARENA</div>
        <DuelButton onClick={() => nav('/play')} />
        <div className="duel-caption">モードを選んで、次の対決へ。</div>
      </section>

      {error && <div className="error">{error}</div>}

      <div className="section-title">
        <h2>GAME MODES</h2>
        <span>{ranked?.season.name ?? ''}</span>
      </div>
      <section className="cards">
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>QUICK DRAFT</h3>
            <span className="badge">4 PLAYERS</span>
          </div>
          <p>空いているルームに参加します。4人そろうと自動で開始。空席はCPUが入ります。</p>
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/rooms/quick', { body: {} }))}>
              クイックドラフト
            </button>
            <Link className="btn" to="/play">
              ほかのモード
            </Link>
          </div>
        </article>
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>RANKED</h3>
            {ranked && <TierBadge rating={ranked.rating} />}
          </div>
          <p>
            ライバルとの対決に挑戦。ドラフトで最高のチームを目指そう。
            {ranked && ranked.games > 0 && `（${ranked.games}試合${ranked.position ? `・${ranked.position}位` : ''}）`}
          </p>
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/ranked/queue', { body: {} }))}>
              ランク戦を探す
            </button>
            <Link className="btn" to="/ranked">
              ランキング
            </Link>
          </div>
        </article>
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>SOLO CHALLENGE</h3>
            <span className={`badge ${solo?.cleared ? 'on' : ''}`}>{solo?.cleared ? '達成済み' : 'DAILY'}</span>
          </div>
          <p>{solo ? `今日の課題：${solo.challenge.titleJa}` : '今日の課題に挑戦。CPU 3チームと戦います。'}</p>
          <div className="button-row">
            <Link className="btn primary" to="/solo">
              チャレンジを始める
            </Link>
          </div>
        </article>
      </section>

      <div className="section-title">
        <h2>TODAY</h2>
        <Link to="/me">MY PAGE</Link>
      </div>
      <section className="cards">
        <article className="fd-card">
          <div className="list">
            <Link className="list-item" to="/missions">
              <span>ミッション</span>
              {missionsReady > 0 ? <strong>{missionsReady}件 受け取れます</strong> : <span className="muted">進行中</span>}
            </Link>
            <Link className="list-item" to="/pass">
              <span>Season Pass</span>
              {pass ? (
                <strong>
                  Lv {pass.level}
                  {pass.claimable > 0 ? `・報酬 ${pass.claimable}` : ''}
                </strong>
              ) : (
                <span className="muted">—</span>
              )}
            </Link>
            <div className="list-item">
              <span>対戦報酬</span>
              <span className="muted">{matchRewards ? `今日 ${matchRewards.leaguesToday}/${matchRewards.cap} リーグ` : '—'}</span>
            </div>
            <div className="list-item">
              <span>ログインボーナス</span>
              <span className="muted">{login?.claimedToday ? `受け取り済み（${login.streak}日連続）` : '—'}</span>
            </div>
            {wallet && (
              <Link className="list-item" to="/wallet">
                <span>残高</span>
                <strong>
                  {fmt(wallet.coins)} COINS・{fmt(wallet.gems.total)} GEMS
                </strong>
              </Link>
            )}
          </div>
        </article>
      </section>

      {events.length > 0 && (
        <>
          <div className="section-title">
            <h2>SPECIAL EVENTS</h2>
            <Link to="/events">VIEW ALL</Link>
          </div>
          <section className="cards">
            {events.slice(0, 2).map((e) => (
              <article key={e.id} className="fd-card">
                <div className="fd-card-header">
                  <h3>{e.name}</h3>
                  <span className="badge on">開催中</span>
                </div>
                <p>{e.conditions.join('・')}</p>
                <div className="button-row">
                  <button className="btn primary" disabled={busy} onClick={() => go(() => api(`/api/events/${e.id}/join`, { body: {} }))}>
                    参加する
                  </button>
                  <Link className="btn" to={`/events/${e.id}`}>
                    詳細
                  </Link>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      <div className="section-title">
        <h2>TOP RANKING</h2>
        <Link to="/ranked">VIEW ALL</Link>
      </div>
      <section className="cards">
        <article className="fd-card">
          {board && board.items.length === 0 && <p className="flush">今シーズンのランク戦はまだ行われていません。</p>}
          <div className="list">
            {board?.items.slice(0, 3).map((r) => (
              <div key={r.userId} className={`list-item rank ${r.userId === me?.id ? 'me' : ''}`}>
                <span>
                  {String(r.position).padStart(2, '0')} · {r.displayName}
                  {r.member && <span className="member-badge inline">★</span>}
                </span>
                <strong>{fmt(r.rating)} PTS</strong>
              </div>
            ))}
            {board && board.me.position !== null && board.me.position > 3 && ranked && (
              <div className="list-item rank me">
                <span>
                  {String(board.me.position).padStart(2, '0')} · {me?.displayName}
                </span>
                <strong>{fmt(ranked.rating)} PTS</strong>
              </div>
            )}
          </div>
        </article>
      </section>
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
