import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { adminApi, hasToken, setAdminToken, AdminApiError } from './api';
import { CardsPage } from './CardsPage';
import { AuditPage } from './AuditPage';
import { EconomyPage } from './EconomyPage';
import { EventsPage } from './EventsPage';
import { SeasonsPage } from './SeasonsPage';

interface AdminMe {
  admin: { id: string; username: string; role: 'owner' | 'admin' | 'viewer'; permissions: string[] };
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

export default function App() {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [checking, setChecking] = useState(hasToken());
  const [page, setPage] = useState<'cards' | 'events' | 'seasons' | 'economy' | 'audit'>('cards');

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
  const canAudit = can('audit.read');
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
        <button className={`nav ${page === 'cards' ? 'on' : ''}`} onClick={() => setPage('cards')}>
          カード一覧
        </button>
        {can('events.read') && (
          <button className={`nav ${page === 'events' ? 'on' : ''}`} onClick={() => setPage('events')}>
            イベント管理
          </button>
        )}
        {can('seasons.read') && (
          <button className={`nav ${page === 'seasons' ? 'on' : ''}`} onClick={() => setPage('seasons')}>
            シーズン・ランキング
          </button>
        )}
        {can('economy.read') && (
          <button className={`nav ${page === 'economy' ? 'on' : ''}`} onClick={() => setPage('economy')}>
            通貨{me.testGrantsEnabled ? '・テスト付与' : ''}
          </button>
        )}
        {canAudit && (
          <button className={`nav ${page === 'audit' ? 'on' : ''}`} onClick={() => setPage('audit')}>
            管理者操作ログ
          </button>
        )}
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
        {page === 'cards' && <CardsPage />}
        {page === 'events' && <EventsPage canWrite={can('events.write')} />}
        {page === 'seasons' && <SeasonsPage />}
        {page === 'economy' && <EconomyPage canGrant={can('economy.test_grant')} />}
        {page === 'audit' && canAudit && <AuditPage />}
      </main>
    </div>
  );
}
