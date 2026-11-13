import { useEffect, useState, type FormEvent } from 'react';
import { adminApi, hasToken, setAdminToken, AdminApiError } from './api';
import { CardsPage } from './CardsPage';
import { AuditPage } from './AuditPage';

interface AdminMe {
  admin: { id: string; username: string; role: 'owner' | 'admin' | 'viewer' };
  environment: string;
}

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [page, setPage] = useState<'cards' | 'audit'>('cards');

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

  const canAudit = me.admin.role !== 'viewer';
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
      <main className="main">{page === 'cards' ? <CardsPage /> : <AuditPage />}</main>
    </div>
  );
}
