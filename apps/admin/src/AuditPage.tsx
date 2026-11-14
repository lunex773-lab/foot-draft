import { useEffect, useState } from 'react';
import { adminApi } from './api';

interface Row {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail_json: string | null;
  ip: string | null;
  created_at: number;
  admin_username: string | null;
}

const time = (ms: number) => new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

/** admin operation log with filters and paging (spec 12-2 Admin Logs) */
export function AuditPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [admin, setAdmin] = useState('');
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (before?: number) => {
    const qs = new URLSearchParams({ ...(action ? { action } : {}), ...(admin ? { admin } : {}), ...(before ? { before: String(before) } : {}) });
    adminApi<{ items: Row[]; actions: string[]; next: number | null }>(`/audit-logs?${qs}`)
      .then((r) => {
        setRows((x) => (before ? [...x, ...r.items] : r.items));
        setActions(r.actions);
        setNext(r.next);
        setError(null);
      })
      .catch((e) => setError(String(e.message)));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);
  return (
    <div>
      <h1>管理者操作ログ</h1>
      <form
        className="filter-row"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="操作">
          <option value="">すべての操作</option>
          {actions.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <input placeholder="管理者のユーザー名" value={admin} onChange={(e) => setAdmin(e.target.value)} />
        <button className="btn">絞り込む</button>
      </form>
      {error && <div className="error">{error}</div>}
      <div className="panel scroll-x">
        <table>
          <thead>
            <tr>
              <th>日時</th>
              <th>管理者</th>
              <th>操作</th>
              <th>対象</th>
              <th>詳細</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{time(r.created_at)}</td>
                <td>{r.admin_username ?? '-'}</td>
                <td>{r.action}</td>
                <td>
                  {r.target_type ?? ''} {r.target_id ?? '-'}
                </td>
                <td className="muted detail">{r.detail_json ?? ''}</td>
                <td className="muted">{r.ip ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {next && (
          <button className="btn" style={{ marginTop: 10 }} onClick={() => load(next)}>
            さらに表示
          </button>
        )}
      </div>
    </div>
  );
}
