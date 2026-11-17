import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TierBadge } from '../components/TierBadge';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmt, useWallet } from '../lib/wallet';

function Row({ to, label, sub, value }: { to: string; label: string; sub?: string; value?: ReactNode }) {
  return (
    <Link className="menu-row" to={to}>
      <span className="menu-label">
        {label}
        {sub && <span className="menu-sub">{sub}</span>}
      </span>
      <span className="menu-value">{value}</span>
      <span className="chev" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

/** My Page: profile, balances and everything that is not in the bottom menu */
export default function MyPage() {
  const { me, logout } = useAuth();
  const { wallet, membership } = useWallet();
  const [ranked, setRanked] = useState<{ rating: number; games: number; position: number | null; season: { name: string } } | null>(null);
  const [stats, setStats] = useState<{ leaguesPlayed: number; leaguesWon: number } | null>(null);
  const [missionsReady, setMissionsReady] = useState(0);
  const [pass, setPass] = useState<{ level: number; claimable: number; premium: boolean } | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api<typeof ranked>('/api/ranked/me').then(setRanked).catch(() => undefined);
    api<{ stats: { leaguesPlayed: number; leaguesWon: number } }>('/api/users/me')
      .then((r) => setStats(r.stats))
      .catch(() => undefined);
    api<{ items: { completed: boolean; claimed: boolean }[] }>('/api/missions')
      .then((r) => setMissionsReady(r.items.filter((m) => m.completed && !m.claimed).length))
      .catch(() => undefined);
    api<{ level: number; claimable: number; premium: boolean }>('/api/pass')
      .then((r) => setPass({ level: r.level, claimable: r.claimable, premium: r.premium }))
      .catch(() => undefined);
    api<{ unread: number }>('/api/feedback')
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, []);

  return (
    <div className="screen">
      <section className="page-head">
        <div className="eyebrow">MY PAGE</div>
        <h1>
          {me?.displayName}
          {membership?.active && (
            <span className="member-badge big" title="Premium Membership 会員">
              ★
            </span>
          )}
        </h1>
        <p>@{me?.username}</p>
      </section>

      <section className="cards">
        <article className="fd-card">
          <div className="stat-row">
            <div>
              <div className="stat-label">RANK</div>
              <div className="stat-value">{ranked ? <TierBadge rating={ranked.rating} /> : '—'}</div>
              <div className="stat-sub">{ranked ? `${ranked.season.name}${ranked.position ? `・${ranked.position}位` : ''}` : ''}</div>
            </div>
            <div>
              <div className="stat-label">LEAGUES</div>
              <div className="stat-value">{stats ? fmt(stats.leaguesPlayed) : '—'}</div>
              <div className="stat-sub">優勝 {stats ? fmt(stats.leaguesWon) : '—'}回</div>
            </div>
          </div>
        </article>
        <article className="fd-card">
          <div className="fd-card-header">
            <h3>WALLET</h3>
            <Link to="/wallet" className="link-small">
              履歴
            </Link>
          </div>
          <div className="stat-row three">
            <div>
              <div className="stat-label">COINS</div>
              <div className="stat-value neon">{wallet ? fmt(wallet.coins) : '—'}</div>
            </div>
            <div>
              <div className="stat-label">無償GEMS</div>
              <div className="stat-value gem">{wallet ? fmt(wallet.gems.free) : '—'}</div>
            </div>
            <div>
              <div className="stat-label">有償GEMS</div>
              <div className="stat-value gem">{wallet ? fmt(wallet.gems.paid) : '—'}</div>
            </div>
          </div>
        </article>
      </section>

      <div className="section-title">
        <h2>MENU</h2>
      </div>
      <nav className="menu-list" aria-label="マイページのメニュー">
        <Row to="/missions" label="ミッション" value={missionsReady > 0 ? <span className="badge on">{missionsReady}</span> : null} />
        <Row to="/pass" label="Season Pass" value={pass ? `Lv ${pass.level}${pass.premium ? '・プレミアム' : ''}` : null} />
        <Row to="/ranked" label="ランク戦・ランキング" />
        <Row to="/play" label="モード選択" sub="クイック・ランク・ソロ・Collection・イベント・プライベート" />
        <Row to="/events" label="イベント" />
        <Row to="/history" label="対戦履歴" />
        <Row to="/wallet" label="残高と履歴" />
        <Row to="/settings" label="設定・フィードバック" value={unread > 0 ? <span className="badge on">返信 {unread}</span> : null} />
      </nav>

      <div className="button-row center" style={{ marginTop: 20 }}>
        <button className="btn ghost" onClick={logout}>
          ログアウト
        </button>
      </div>
    </div>
  );
}
