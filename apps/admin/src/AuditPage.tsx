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

export function AuditPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminApi<{ items: Row[] }>('/audit-logs')
      .then((r) => setRows(r.items))
      .catch((e) => setError(String(e.message)));
  }, []);
  return (
    <div>
      <h1>管理者操作ログ</h1>
      {error && <div className="error">{error}</div>}
      {rows && (
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
                  <td>{new Date(r.created_at).toLocaleString('ja-JP')}</td>
                  <td>{r.admin_username ?? '-'}</td>
                  <td>{r.action}</td>
                  <td>{r.target_id ?? '-'}</td>
                  <td className="muted">{r.detail_json ?? ''}</td>
                  <td className="muted">{r.ip ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
