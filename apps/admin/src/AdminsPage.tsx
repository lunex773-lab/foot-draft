import { useEffect, useState, type FormEvent } from 'react';
import { adminApi } from './api';

const ROLE_LABEL: Record<string, string> = { owner: 'owner', admin: 'admin', support: 'support', viewer: 'viewer' };
const ROLE_DESC: Record<string, string> = {
  owner: 'すべて＋管理者の追加・役割変更・無効化',
  admin: '運営操作（イベント・配布・ユーザーのタグと停止・フィードバック・テスト付与）',
  support: 'ユーザー検索・フィードバック対応（通貨は閲覧のみ）',
  viewer: '集計の閲覧だけ（個人の詳細は見えない）',
};
const time = (ms: number | null) => (ms ? new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—');

interface AdminRow {
  id: string;
  username: string;
  role: string;
  status: 'active' | 'disabled';
  totp_enabled: number;
  created_at: number;
  last_login_at: number | null;
  created_by_name: string | null;
}

/** admin accounts (owner only, decision 45) */
export function AdminsPage({ meId }: { meId: string }) {
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('support');
  const [password, setPassword] = useState('');
  const load = () =>
    adminApi<{ items: AdminRow[] }>('/admins')
      .then((r) => setRows(r.items))
      .catch((e) => setError(String(e.message)));
  useEffect(() => {
    load();
  }, []);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      load();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    act(async () => {
      await adminApi('/admins', { username, role, password });
      setUsername('');
      setPassword('');
    }, `管理者 ${username} を作成しました。初回ログイン時に2段階認証の登録が必要です（staging・本番）。パスワードは本人に安全な方法で伝えてください。`);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1>管理者</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="small" style={{ color: 'var(--accent)' }}>{msg}</div>}
      <div className="panel scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>ユーザー名</th>
              <th>役割</th>
              <th>状態</th>
              <th>2段階認証</th>
              <th>最終ログイン</th>
              <th>作成</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows?.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.username}
                  {a.id === meId && <span className="tiny muted">（あなた）</span>}
                </td>
                <td>
                  <select
                    value={a.role}
                    disabled={a.id === meId}
                    aria-label={`${a.username} の役割`}
                    onChange={(e) => window.confirm(`${a.username} の役割を ${e.target.value} に変更します（その管理者はログアウトされます）`) && act(() => adminApi(`/admins/${a.id}`, { role: e.target.value }, 'PATCH'), '役割を変更しました')}
                  >
                    {Object.keys(ROLE_LABEL).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{a.status === 'active' ? '有効' : '無効'}</td>
                <td>{a.totp_enabled ? '登録済み' : '未登録'}</td>
                <td>{time(a.last_login_at)}</td>
                <td className="small">
                  {time(a.created_at)}
                  {a.created_by_name ? `（${a.created_by_name}）` : ''}
                </td>
                <td className="row">
                  {a.id !== meId && (
                    <button
                      className="btn"
                      onClick={() =>
                        window.confirm(`${a.username} を${a.status === 'active' ? '無効にします（ログアウトされます）' : '有効に戻します'}`) &&
                        act(() => adminApi(`/admins/${a.id}`, { status: a.status === 'active' ? 'disabled' : 'active' }, 'PATCH'), a.status === 'active' ? '無効にしました' : '有効に戻しました')
                      }
                    >
                      {a.status === 'active' ? '無効にする' : '有効に戻す'}
                    </button>
                  )}
                  {a.totp_enabled === 1 && (
                    <button
                      className="btn"
                      onClick={() => window.confirm(`${a.username} の2段階認証をリセットします。次回ログイン時に登録し直します。`) && act(() => adminApi(`/admins/${a.id}`, { resetTotp: true }, 'PATCH'), '2段階認証をリセットしました')}
                    >
                      2段階認証をリセット
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h3>役割</h3>
        {Object.entries(ROLE_DESC).map(([r, d]) => (
          <div key={r} className="small">
            <b>{r}</b>：{d}
          </div>
        ))}
      </div>
      <form className="panel" onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
        <h3>管理者を追加</h3>
        <label className="form-field">
          ユーザー名
          <input value={username} onChange={(e) => setUsername(e.target.value)} pattern="[A-Za-z0-9_.\-]{3,40}" required autoComplete="off" />
        </label>
        <label className="form-field">
          役割
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.keys(ROLE_LABEL).map((r) => (
              <option key={r} value={r}>
                {r}：{ROLE_DESC[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          初期パスワード（12文字以上）
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required autoComplete="new-password" />
        </label>
        <button className="btn primary">追加</button>
      </form>
    </div>
  );
}

/** own password (every role) */
export function SettingsPage({ me }: { me: { username: string; role: string; permissions: string[] } }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setError(null);
    if (next !== again) return setError('新しいパスワードが一致しません');
    try {
      await adminApi('/auth/password', { currentPassword: current, newPassword: next });
      setMsg('パスワードを変更しました。ほかの端末のログインは終了しました。');
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      setError(String((err as Error).message));
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}>
      <h1>設定</h1>
      <div className="panel small">
        {me.username}（{me.role}）
        <div className="tiny muted" style={{ marginTop: 6 }}>
          権限：{me.permissions.join('、')}
        </div>
      </div>
      <form className="panel" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3>パスワードの変更</h3>
        <label className="form-field">
          今のパスワード
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </label>
        <label className="form-field">
          新しいパスワード（12文字以上）
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={12} required autoComplete="new-password" />
        </label>
        <label className="form-field">
          新しいパスワード（確認）
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} minLength={12} required autoComplete="new-password" />
        </label>
        {error && <div className="error">{error}</div>}
        {msg && <div className="small" style={{ color: 'var(--accent)' }}>{msg}</div>}
        <button className="btn primary">変更する</button>
      </form>
    </div>
  );
}
