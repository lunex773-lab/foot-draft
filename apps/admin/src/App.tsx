import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { adminApi, hasToken, setAdminToken, AdminApiError } from './api';
import { CardsPage } from './CardsPage';
import { AuditPage } from './AuditPage';
import { AdminsPage, SettingsPage } from './AdminsPage';
import { DistributionsPage } from './DistributionsPage';
import { EconomyPage } from './EconomyPage';
import { FeedbackPage } from './FeedbackPage';
import { AnalyticsPage, OverviewPage, RetentionPage } from './InsightsPages';
import { UsersPage } from './UsersPage';
import { EventsPage } from './EventsPage';
import { SeasonsPage } from './SeasonsPage';

interface AdminMe {
  admin: { id: string; username: string; role: 'owner' | 'admin' | 'support' | 'viewer'; permissions: string[] };
  environment: string;
  /** test grants are only available in staging / local (decision 42) */
  testGrantsEnabled?: boolean;
}

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qrSvg = useMemo(() => {
    if (!setup) return '';
    const qr = qrcode(0, 'M');
    qr.addData(setup.otpauthUri);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [setup]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await adminApi<{ token: string }>('/auth/login', { username, password, totp: totp || undefined });
      setAdminToken(r.token);
      onDone();
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'TOTP_REQUIRED') {
        setNeedTotp(true);
        setError('認証アプリの6桁のコードを入力してください');
      } else if (err instanceof AdminApiError && err.code === 'TOTP_SETUP_REQUIRED' && err.data?.setup) {
        setSetup(err.data.setup as { secret: string; otpauthUri: string });
        setNeedTotp(true);
        setError(null);
      } else if (err instanceof AdminApiError && err.code === 'RATE_LIMITED') setError('試行回数が多すぎます。15分後に再試行してください');
      else if (err instanceof AdminApiError && err.status === 403) setError(err.message);
      else setError('ユーザー名・パスワード・認証コードのいずれかが違います');
    }
  };
  return (
    <form className="login panel" onSubmit={submit}>
      <div className="side" style={{ background: 'transparent', border: 0, padding: 0 }}>
        <div className="logo">
          FOOTBALL <b>DRAFT</b> ADMIN
        </div>
      </div>
      <div className="small muted">運営管理サイト（管理者専用）</div>
      <label>
        ユーザー名
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
      </label>
      <label>
        パスワード
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {setup && (
        <div className="preview" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <b>2段階認証の設定（初回のみ）</b>
          <div className="small muted">認証アプリ（Google Authenticator など）でこのQRコードを読み取るか、キーを手入力して登録し、表示された6桁のコードを入力してください。</div>
          <div style={{ width: 180, background: '#fff', padding: 6, borderRadius: 6 }} dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <code style={{ wordBreak: 'break-all', fontSize: 13 }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
        </div>
      )}
      {needTotp && (
        <label>
          2段階認証コード
          <input value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus />
        </label>
      )}
      {error && <div className="error">{error}</div>}
      <button className="btn primary">ログイン</button>
    </form>
  );
}

type Page = 'overview' | 'users' | 'analytics' | 'retention' | 'economy' | 'feedback' | 'distributions' | 'cards' | 'events' | 'seasons' | 'audit' | 'admins' | 'settings';

interface NavItem {
  page: Page;
  label: string;
  /** shown when the admin has any of these permissions */
  any: string[];
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: '分析',
    items: [
      { page: 'overview', label: 'Overview', any: ['analytics.read'] },
      { page: 'analytics', label: 'Analytics', any: ['analytics.read'] },
      { page: 'retention', label: 'Retention', any: ['analytics.read'] },
      { page: 'economy', label: 'Economy', any: ['economy.read', 'users.wallet', 'economy.test_grant'] },
    ],
  },
  {
    group: '運営',
    items: [
      { page: 'users', label: 'Users', any: ['users.read'] },
      { page: 'feedback', label: 'Feedback', any: ['feedback.read'] },
      { page: 'distributions', label: 'GEMS 配布', any: ['distribution.read'] },
      { page: 'events', label: 'イベント管理', any: ['events.read'] },
      { page: 'seasons', label: 'シーズン・ランキング', any: ['seasons.read'] },
      { page: 'cards', label: 'カード一覧', any: ['cards.read'] },
    ],
  },
  {
    group: '管理',
    items: [
      { page: 'audit', label: '管理者操作ログ', any: ['audit.read'] },
      { page: 'admins', label: '管理者', any: ['admins.manage'] },
      { page: 'settings', label: '設定', any: [] },
    ],
  },
];

export default function App() {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [checking, setChecking] = useState(hasToken());
  const [page, setPage] = useState<Page | null>(null);

  const loadMe = () =>
    adminApi<AdminMe>('/auth/me')
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setChecking(false));

  useEffect(() => {
    if (hasToken()) loadMe();
    const out = () => setMe(null);
    window.addEventListener('fd-admin:logout', out);
    return () => window.removeEventListener('fd-admin:logout', out);
  }, []);

  if (checking) return <div className="muted" style={{ padding: 40 }}>確認中…</div>;
  if (!me) return <Login onDone={loadMe} />;

  const can = (p: string) => me.admin.permissions?.includes(p) ?? false;
  const visible = (i: NavItem) => i.any.length === 0 || i.any.some(can);
  // the first page the role can open
  const current: Page = page ?? NAV.flatMap((g) => g.items).find((i) => visible(i) && i.page !== 'settings')?.page ?? 'settings';
  return (
    <div className="layout">
      <aside className="side">
        <div className="logo">
          FOOTBALL <b>DRAFT</b>
          <div className="tiny muted">ADMIN</div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <span className={`env ${me.environment}`}>{me.environment.toUpperCase()}</span>
        </div>
        {NAV.map((g) => {
          const items = g.items.filter(visible);
          if (items.length === 0) return null;
          return (
            <div key={g.group} className="nav-group">
              <div className="nav-head">{g.group}</div>
              {items.map((i) => (
                <button key={i.page} className={`nav ${current === i.page ? 'on' : ''}`} onClick={() => setPage(i.page)}>
                  {i.page === 'economy' && me.testGrantsEnabled && can('economy.test_grant') ? 'Economy・テスト付与' : i.label}
                </button>
              ))}
            </div>
          );
        })}
        <div style={{ flex: 1 }} />
        <div className="tiny muted">
          {me.admin.username}（{me.admin.role}）
        </div>
        <button
          className="btn"
          onClick={async () => {
            await adminApi('/auth/logout', {}).catch(() => undefined);
            setAdminToken(null);
            setMe(null);
          }}
        >
          ログアウト
        </button>
      </aside>
      <main className="main">
        {current === 'overview' && <OverviewPage onOpen={(p) => setPage(p as Page)} />}
        {current === 'analytics' && <AnalyticsPage />}
        {current === 'retention' && <RetentionPage />}
        {current === 'economy' && <EconomyPage canGrant={can('economy.test_grant')} canWallet={can('users.wallet')} canInsights={can('economy.read')} />}
        {current === 'users' && <UsersPage canWrite={can('users.write')} canWallet={can('users.wallet')} />}
        {current === 'feedback' && <FeedbackPage canWrite={can('feedback.write')} />}
        {current === 'distributions' && <DistributionsPage canWrite={can('distribution.write')} />}
        {current === 'cards' && <CardsPage />}
        {current === 'events' && <EventsPage canWrite={can('events.write')} />}
        {current === 'seasons' && <SeasonsPage />}
        {current === 'audit' && can('audit.read') && <AuditPage />}
        {current === 'admins' && can('admins.manage') && <AdminsPage meId={me.admin.id} />}
        {current === 'settings' && <SettingsPage me={me.admin} />}
      </main>
    </div>
  );
}
