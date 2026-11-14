import { useEffect, useState, type FormEvent } from 'react';
import { api, getLastErrorCode } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorText, formatDateTime } from '../lib/labels';

const CATEGORIES = [
  ['bug', '不具合の報告（Bug Report）'],
  ['feature', '機能の提案（Feature Suggestion）'],
  ['balance', 'ゲームバランス（Game Balance）'],
  ['payment', '支払い（Payment）'],
  ['other', 'その他（Other）'],
] as const;
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
const STATUS_LABEL: Record<string, string> = { new: '受付済み', reviewing: '確認中', investigating: '調査中', resolved: '対応済み', closed: '完了' };

interface Item {
  id: string;
  category: string;
  subject: string;
  status: string;
  created_at: number;
  replies: number;
  unread: number;
}

/** Settings (spec 13-1): display name and "フィードバックを送信" */
export default function SettingsPage() {
  const { me } = useAuth();
  const [name, setName] = useState(me?.displayName ?? '');
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [category, setCategory] = useState('bug');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [wantsReply, setWantsReply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const load = () =>
    api<{ items: Item[] }>('/api/feedback')
      .then((r) => setItems(r.items))
      .catch(() => undefined);
  useEffect(() => {
    load();
  }, []);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setNameMsg(null);
    try {
      await api('/api/users/me', { method: 'PATCH', body: { displayName: name } });
      setNameMsg('表示名を変更しました（次に開いた画面から反映されます）');
    } catch (err) {
      setNameMsg(errorText((err as { code?: string }).code ?? '', (err as Error).message));
    }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      // the version, OS / device and the latest match are added automatically
      await api('/api/feedback', { body: { category, subject, body, wantsReply, context: { errorCode: getLastErrorCode() } } });
      setMsg('送信しました。ありがとうございます。');
      setSubject('');
      setBody('');
      load();
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setError(code === 'RATE_LIMITED' ? '1日に送れるのは10件までです。明日もう一度お試しください。' : errorText(code, (err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760, margin: '0 auto' }}>
      <h2 style={{ margin: 0 }}>設定</h2>
      <form className="panel" onSubmit={saveName}>
        <h3>表示名</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} required aria-label="表示名" />
          <button className="btn">保存</button>
        </div>
        {nameMsg && <div className="small muted" style={{ marginTop: 6 }}>{nameMsg}</div>}
      </form>

      <form className="panel" onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0 }}>フィードバックを送信</h3>
        <div className="small muted">不具合・ご意見・ご要望をお送りください。アプリのバージョン・端末の種類・直前の試合が自動で添えられます（メールアドレスなどは送られません）。</div>
        <label className="field">
          カテゴリ
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          件名
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} required />
        </label>
        <label className="field">
          内容
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={6} required />
          <span className="tiny muted">{body.length} / 2000</span>
        </label>
        <label className="row small">
          <input type="checkbox" checked={wantsReply} onChange={(e) => setWantsReply(e.target.checked)} style={{ minHeight: 0 }} /> 返信を希望する（返信はこの画面に表示されます）
        </label>
        {error && <div className="error">{error}</div>}
        {msg && <div className="small" style={{ color: 'var(--good)' }}>{msg}</div>}
        <button className="btn primary" disabled={busy || !subject.trim() || !body.trim()}>
          送信する
        </button>
      </form>

      <div className="panel">
        <h3>送ったフィードバック</h3>
        {items.length === 0 && <div className="small muted">まだ送っていません。</div>}
        {items.map((f) => (
          <div key={f.id} className="fb-item">
            <button type="button" className="fb-head" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
              <span>
                <b>{f.subject}</b>
                <span className="tiny muted">　{CATEGORY_LABEL[f.category as keyof typeof CATEGORY_LABEL]}・{formatDateTime(f.created_at)}</span>
              </span>
              <span className="row tiny">
                <span className="chip">{STATUS_LABEL[f.status] ?? f.status}</span>
                {f.unread > 0 ? <span className="chip on">返信 {f.unread}件（未読）</span> : f.replies > 0 ? <span className="chip">返信 {f.replies}件</span> : null}
              </span>
            </button>
            {open === f.id && <FeedbackThread id={f.id} onRead={load} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedbackThread({ id, onRead }: { id: string; onRead: () => void }) {
  const [d, setD] = useState<{ feedback: { body: string }; replies: { id: string; body: string; created_at: number }[] } | null>(null);
  useEffect(() => {
    api<typeof d>(`/api/feedback/${id}`)
      .then((r) => {
        setD(r);
        onRead();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!d) return <div className="small muted">読み込み中…</div>;
  return (
    <div className="fb-thread">
      <div className="fb-msg mine">{d.feedback.body}</div>
      {d.replies.map((r) => (
        <div key={r.id} className="fb-msg reply">
          <div className="tiny muted">運営より・{formatDateTime(r.created_at)}</div>
          {r.body}
        </div>
      ))}
      {d.replies.length === 0 && <div className="tiny muted">まだ返信はありません。</div>}
    </div>
  );
}
