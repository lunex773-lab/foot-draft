import { computeChemistry, enhancePlayer, fitSquad, lineupStrength } from '@fd/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DuelButton } from '../components/DuelButton';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCatalog } from '../lib/catalog';
import { errorText } from '../lib/labels';
import { useTeam } from '../lib/team';
import { fmt, useWallet } from '../lib/wallet';
import { ActiveRooms, DraftMatchCard, type HistoryRow } from './PlayPage';

/**
 * Home: hero, the DUEL button (mode select), MATCH and DRAFT MATCH (official
 * spec v2.0), the team used in MATCH and today's rewards. Every number comes
 * from the server.
 */
export default function HomePage() {
  const { me } = useAuth();
  const nav = useNavigate();
  const { wallet, login, matchRewards } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<HistoryRow[]>([]);
  const [stats, setStats] = useState<{ leaguesPlayed: number; leaguesWon: number } | null>(null);
  const [missionsReady, setMissionsReady] = useState(0);
  const [pass, setPass] = useState<{ level: number; claimable: number } | null>(null);

  useEffect(() => {
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

  const go = async (fn: () => Promise<{ roomId: string; draft?: boolean }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      nav(`${r.draft ? '/draft' : '/room'}/${r.roomId}`);
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
      </div>
      <section className="cards">
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>MATCH</h3>
            <span className="badge">4 PLAYERS</span>
          </div>
          <p>持っているカードで作ったチームで、4人の総当たりリーグ（3試合）。空席はCPUチームが入ります。</p>
          <div className="button-row">
            <button className="btn primary" disabled={busy} onClick={() => go(() => api('/api/match/quick', { body: {} }))}>
              MATCH を探す
            </button>
            <Link className="btn" to="/team">
              チームを編集
            </Link>
          </div>
        </article>
        <DraftMatchCard busy={busy} go={go} />
      </section>

      <MyTeamCard />

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
    </div>
  );
}

/** the team used in MATCH: strength and chemistry (decision 73) */
export function MyTeamCard() {
  const catalog = useCatalog();
  const { data } = useTeam();
  const view = useMemo(() => {
    if (!data || !catalog) return null;
    const cards = data.cards.filter((c) => catalog.has(c.playerId)).map((c) => enhancePlayer(catalog.get(c.playerId)!, c.level));
    const squad = data.squads.find((s) => s.slot === data.active) ?? data.squads[0];
    const lineup = squad ? fitSquad(squad.lineup, cards) : null;
    if (!squad || !lineup) return null;
    const byId = new Map(cards.map((p) => [p.id, p]));
    return { name: squad.name, lineup, strength: lineupStrength(lineup, byId), chem: computeChemistry(lineup.starters.map((id) => byId.get(id)), lineup.formation, lineup.tactics).score, owned: cards.length };
  }, [data, catalog]);
  return (
    <>
      <div className="section-title">
        <h2>MY TEAM</h2>
        <Link to="/team">EDIT</Link>
      </div>
      <section className="cards">
        <article className="fd-card">
          {!view && <p className="flush muted">読み込み中…</p>}
          {view && (
            <>
              <div className="fd-card-header">
                <h3>{view.name}</h3>
                <span className="badge on">{view.lineup.formation}</span>
              </div>
              <div className="stat-row three">
                <div>
                  <div className="stat-label">総合力</div>
                  <div className="stat-value neon">{view.strength}</div>
                </div>
                <div>
                  <div className="stat-label">ケミストリー</div>
                  <div className="stat-value">{view.chem}</div>
                </div>
                <div>
                  <div className="stat-label">所持カード</div>
                  <div className="stat-value">{view.owned}</div>
                </div>
              </div>
              <div className="button-row">
                <Link className="btn" to="/team">
                  編成を変える
                </Link>
                <Link className="btn ghost" to="/gacha">
                  ガシャで強化
                </Link>
              </div>
            </>
          )}
        </article>
      </section>
    </>
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
