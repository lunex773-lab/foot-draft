import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { WalletProvider, fmt, useWallet } from './lib/wallet';
import AuthPage from './pages/AuthPage';
import HomePage, { JoinByLink } from './pages/HomePage';

const RoomPage = lazy(() => import('./pages/RoomPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));
const MatchReplayPage = lazy(() => import('./pages/MatchReplayPage'));
const RankedPage = lazy(() => import('./pages/RankedPage'));
const SoloPage = lazy(() => import('./pages/SoloPage'));
const EventsPage = lazy(() => import('./pages/EventsPage'));
const EventDetailPage = lazy(() => import('./pages/EventsPage').then((m) => ({ default: m.EventDetailPage })));
const GachaPage = lazy(() => import('./pages/GachaPage'));
const GachaDetailPage = lazy(() => import('./pages/GachaPage').then((m) => ({ default: m.GachaDetailPage })));
const GachaHistoryPage = lazy(() => import('./pages/GachaPage').then((m) => ({ default: m.GachaHistoryPage })));
const CollectionPage = lazy(() => import('./pages/CollectionPage'));
const ExchangePage = lazy(() => import('./pages/ExchangePage'));
const MissionsPage = lazy(() => import('./pages/MissionsPage'));
const WalletPage = lazy(() => import('./pages/WalletPage'));

/** balances in the top bar (from the server) and the login bonus message */
function WalletBar() {
  const { wallet, notice, clearNotice } = useWallet();
  return (
    <>
      {wallet && (
        <Link to="/wallet" className="wallet-bar" title="残高と履歴">
          <span className="coin">COINS {fmt(wallet.coins)}</span>
          <span className="gem">GEMS {fmt(wallet.gems.total)}</span>
        </Link>
      )}
      {notice && (
        <div className="toast panel small" role="status" onClick={clearNotice}>
          {notice}　<button className="btn small ghost" onClick={clearNotice}>OK</button>
        </div>
      )}
    </>
  );
}

function Shell() {
  const { me, loading } = useAuth();
  if (loading) return <div className="app muted" style={{ padding: 40 }}>読み込み中…</div>;
  // the wallet (and today's login bonus) belongs to the logged-in player
  return me ? (
    <WalletProvider key={me.id}>
      <ShellInner />
    </WalletProvider>
  ) : (
    <ShellInner />
  );
}

function ShellInner() {
  const { me, logout } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          FOOTBALL <span>DRAFT</span>
        </Link>
        {me && (
          <div className="who">
            <WalletBar />
            <span className="uname">{me.displayName}</span>
            <button className="btn small ghost" onClick={logout}>
              ログアウト
            </button>
          </div>
        )}
      </header>
      {me && (
        <nav className="mainnav" aria-label="メニュー">
          <NavLink to="/" end>
            ホーム
          </NavLink>
          <NavLink to="/gacha">ガシャ</NavLink>
          <NavLink to="/collection">コレクション</NavLink>
          <NavLink to="/exchange">交換所</NavLink>
          <NavLink to="/missions">ミッション</NavLink>
          <NavLink to="/ranked">ランク</NavLink>
          <NavLink to="/events">イベント</NavLink>
          <NavLink to="/cards">図鑑</NavLink>
          <NavLink to="/history">履歴</NavLink>
        </nav>
      )}
      <Suspense fallback={<div className="muted">読み込み中…</div>}>
        {me ? (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/room/:roomId" element={<RoomPage />} />
            <Route path="/join/:code" element={<JoinByLink />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/match/:matchId" element={<MatchReplayPage />} />
            <Route path="/cards" element={<CatalogPage />} />
            <Route path="/ranked" element={<RankedPage />} />
            <Route path="/solo" element={<SoloPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:eventId" element={<EventDetailPage />} />
            <Route path="/gacha" element={<GachaPage />} />
            <Route path="/gacha/history" element={<GachaHistoryPage />} />
            <Route path="/gacha/:bannerId" element={<GachaDetailPage />} />
            <Route path="/collection" element={<CollectionPage />} />
            <Route path="/exchange" element={<ExchangePage />} />
            <Route path="/missions" element={<MissionsPage />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="*" element={<AuthPage />} />
          </Routes>
        )}
      </Suspense>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </AuthProvider>
  );
}
