import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { BetaWelcome, VersionBanner } from './lib/beta';
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
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ShopPage = lazy(() => import('./pages/ShopPage'));
const PassPage = lazy(() => import('./pages/PassPage'));
const PlayPage = lazy(() => import('./pages/PlayPage'));
const MyPage = lazy(() => import('./pages/MyPage'));

/** Premium Membership badge (decision 55) */
function MemberBadge() {
  const { membership } = useWallet();
  return membership?.active ? (
    <span className="member-badge" title="Premium Membership 会員">
      ★
    </span>
  ) : null;
}

/** unread replies to the player's feedback (badge on マイページ) */
function useUnreadReplies(enabled: boolean) {
  const [n, setN] = useState(0);
  const loc = useLocation();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onRead = () => setTick((t) => t + 1);
    window.addEventListener('fd:feedback-read', onRead);
    return () => window.removeEventListener('fd:feedback-read', onRead);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    api<{ unread: number }>('/api/feedback')
      .then((r) => setN(r.unread))
      .catch(() => undefined);
  }, [enabled, loc.pathname, tick]);
  return n;
}

/** connection to the internet (shown in the top bar) */
function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** balances in the top bar (from the server) and the login bonus message */
function WalletBar() {
  const { wallet, notice, clearNotice } = useWallet();
  // the message closes by itself so that it never covers buttons for long
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearNotice, 6000);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);
  return (
    <>
      {wallet && (
        <Link to="/wallet" className="wallet-bar" title="残高と履歴">
          <span className="coin">
            <i aria-hidden="true">C</i>
            {fmt(wallet.coins)}
          </span>
          <span className="gem">
            <i aria-hidden="true">G</i>
            {fmt(wallet.gems.total)}
          </span>
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

// ---------------------------------------------------------------- bottom menu (user request, 2026-11-17)

type Tab = 'home' | 'collection' | 'gacha' | 'shop' | 'me';

/** which tab a page belongs to */
function tabOf(path: string): Tab {
  if (/^\/(collection|exchange|cards)/.test(path)) return 'collection';
  if (path.startsWith('/gacha')) return 'gacha';
  if (/^\/(shop|pass)/.test(path)) return 'shop';
  if (/^\/(me|missions|history|wallet|settings|match)/.test(path)) return 'me';
  return 'home';
}

const ICONS: Record<Tab, ReactNode> = {
  home: <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  collection: (
    <>
      <rect x="7" y="3.5" width="12" height="16" rx="2" />
      <path d="M4.5 7v11.5A2.5 2.5 0 0 0 7 21h9" />
    </>
  ),
  gacha: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4v0" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  shop: (
    <>
      <path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </>
  ),
};

const TABS: { tab: Tab; to: string; label: string }[] = [
  { tab: 'home', to: '/', label: 'ホーム' },
  { tab: 'collection', to: '/collection', label: 'コレクション' },
  { tab: 'gacha', to: '/gacha', label: 'ガシャ' },
  { tab: 'shop', to: '/shop', label: 'ショップ' },
  { tab: 'me', to: '/me', label: 'マイページ' },
];

function BottomNav({ unread }: { unread: number }) {
  const loc = useLocation();
  const current = tabOf(loc.pathname);
  return (
    <nav className="bottom-nav" aria-label="メインメニュー">
      {TABS.map((t) => (
        <Link key={t.tab} to={t.to} className={`nav-item ${current === t.tab ? 'active' : ''}`} aria-current={current === t.tab ? 'page' : undefined}>
          <span className="nav-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICONS[t.tab]}
            </svg>
            {t.tab === 'me' && unread > 0 && <span className="nav-dot" aria-label={`返信 ${unread}件`} />}
          </span>
          <span className="nav-label">{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** pages of one tab that sit side by side (collection / exchange / catalog, shop / pass) */
const SUB_TABS: Partial<Record<Tab, { to: string; label: string }[]>> = {
  collection: [
    { to: '/collection', label: 'コレクション' },
    { to: '/exchange', label: '交換所' },
    { to: '/cards', label: '選手図鑑' },
  ],
  shop: [
    { to: '/shop', label: 'ショップ' },
    { to: '/pass', label: 'Season Pass' },
  ],
};

function SubTabs() {
  const loc = useLocation();
  const items = SUB_TABS[tabOf(loc.pathname)];
  if (!items) return null;
  return (
    <div className="sub-tabs" role="tablist">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} role="tab" className={({ isActive }) => (isActive ? 'on' : '')}>
          {i.label}
        </NavLink>
      ))}
    </div>
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
  const { me } = useAuth();
  const unread = useUnreadReplies(!!me);
  const online = useOnline();
  const loc = useLocation();
  // the draft, lineup and match screens use the whole width on computers; the menu is hidden in a room
  const inRoom = loc.pathname.startsWith('/room/');
  const wide = inRoom || loc.pathname.startsWith('/match/');
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <div className={`app ${wide ? 'wide' : ''} ${me && !inRoom ? 'with-nav' : ''}`}>
      <header className="topbar">
        <Link to="/" className="brand">
          FOOTBALL <span>DRAFT</span>
          <span className="beta-tag" title="ベータテスト中">BETA</span>
        </Link>
        {me ? (
          <div className="who">
            <span className={`online-dot ${online ? '' : 'off'}`} role="status" aria-label={online ? 'オンライン' : 'オフライン'} title={online ? 'ONLINE' : 'OFFLINE'} />
            <MemberBadge />
            <WalletBar />
          </div>
        ) : (
          <div className="status">
            <span className={`online-dot ${online ? '' : 'off'}`} />
            {online ? 'ONLINE' : 'OFFLINE'}
          </div>
        )}
      </header>
      <VersionBanner />
      {me && <BetaWelcome />}
      <main className="page">
        {me && <SubTabs />}
        <Suspense fallback={<div className="muted">読み込み中…</div>}>
          {me ? (
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/play" element={<PlayPage />} />
              <Route path="/me" element={<MyPage />} />
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
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/pass" element={<PassPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="*" element={<AuthPage />} />
            </Routes>
          )}
        </Suspense>
      </main>
      {me && !inRoom && <BottomNav unread={unread} />}
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
