import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
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

function Shell() {
  const { me, loading, logout } = useAuth();
  if (loading) return <div className="app muted" style={{ padding: 40 }}>読み込み中…</div>;
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          FOOTBALL <span>DRAFT</span>
        </Link>
        {me && (
          <div className="who">
            <Link to="/ranked" className="small">
              ランク
            </Link>
            <Link to="/cards" className="small">
              図鑑
            </Link>
            <Link to="/history" className="small">
              履歴
            </Link>
            <span className="uname">{me.displayName}</span>
            <button className="btn small ghost" onClick={logout}>
              ログアウト
            </button>
          </div>
        )}
      </header>
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
