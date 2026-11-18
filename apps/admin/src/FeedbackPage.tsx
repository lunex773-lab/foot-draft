import { useEffect, useState } from 'react';
import { adminApi } from './api';
import { confirmDialog } from './dialog';
import { MODE_LABEL, tagLabel } from './InsightsPages';

const STATUS = ['new', 'reviewing', 'investigating', 'resolved', 'closed'] as const;
const PRIORITY = ['low', 'medium', 'high', 'critical'] as const;
const STATUS_LABEL: Record<string, string> = { new: 'New', reviewing: 'Reviewing', investigating: 'Investigating', resolved: 'Resolved', closed: 'Closed' };
const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const CATEGORY_LABEL: Record<string, string> = { bug: 'Bug Report', feature: 'Feature Suggestion', balance: 'Game Balance', payment: 'Payment', other: 'Other' };
const time = (ms: number) => new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

interface Row {
  id: string;
  category: string;
  subject: string;
  status: string;
  priority: string;
  wants_reply: number;
  created_at: number;
  username: string;
  display_name: string;
  replies: number;
}

/** Feedback (spec 13-4): list, status, priority, internal notes, replies */
export function FeedbackPage({ canWrite }: { canWrite: boolean }) {
  const [status, setStatus] = useState('open');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ items: Row[]; counts: Record<string, number> } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(priority ? { priority } : {}), ...(category ? { category } : {}), ...(q ? { q } : {}) });
    adminApi<{ items: Row[]; counts: Record<string, number> }>(`/feedback?${qs}`)
      .then((r) => (setData(r), setError(null)))
      .catch((e) => setError(String(e.message)));
  };
  useEffect(load, [status, priority, category]);
  if (selected) return <FeedbackDetail id={selected} canWrite={canWrite} onBack={() => (setSelected(null), load())} />;
  const open = (data?.counts.new ?? 0) + (data?.counts.reviewing ?? 0) + (data?.counts.investigating ?? 0);
  return (
    <div>
      <h1>Feedback</h1>
      <div className="filter-row">
        <div className="seg">
          <button className={status === 'open' ? 'on' : ''} onClick={() => setStatus('open')}>
            未対応 {open}
          </button>
          {STATUS.map((s) => (
            <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]} {data?.counts[s] ?? 0}
            </button>
          ))}
          <button className={status === '' ? 'on' : ''} onClick={() => setStatus('')}>
            すべて
          </button>
        </div>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="優先度">
          <option value="">全優先度</option>
          {PRIORITY.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="カテゴリ">
          <option value="">全カテゴリ</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input placeholder="件名・本文・ユーザー名" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn">検索</button>
        </form>
      </div>
      {error && <div className="error">{error}</div>}
      {data && (
        <div className="panel scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>受信日時</th>
                <th>優先度</th>
                <th>状態</th>
                <th>カテゴリ</th>
                <th>件名</th>
                <th>送信者</th>
                <th>返信</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    該当するフィードバックはありません
                  </td>
                </tr>
              )}
              {data.items.map((f) => (
                <tr key={f.id} className="clickable" tabIndex={0} onClick={() => setSelected(f.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(f.id)}>
                  <td>{time(f.created_at)}</td>
                  <td>
                    <span className={`prio ${f.priority}`}>{PRIORITY_LABEL[f.priority]}</span>
                  </td>
                  <td>{STATUS_LABEL[f.status]}</td>
                  <td>{CATEGORY_LABEL[f.category]}</td>
                  <td>{f.subject}</td>
                  <td>{f.display_name}</td>
                  <td>{f.replies ? `${f.replies}件` : f.wants_reply ? '返信希望' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Detail {
  feedback: Record<string, string | number | null>;
  notes: { id: string; body: string; created_at: number; admin: string | null }[];
  replies: { id: string; body: string; created_at: number; read_at: number | null; admin: string | null }[];
  history: { action: string; detail_json: string | null; created_at: number; admin: string | null }[];
  /** the sender's use of the game (spec 23-5) */
  activity?: {
    tags: string[];
    activeDays: number;
    lastActive: string | null;
    matches: number;
    playtimeMs: number;
    leaguesBefore: { id: string; mode: string; status: string; created_at: number; final_rank: number | null; pick_seconds: number | null }[];
    ratings: { n: number; draftFun: number | null; resultFair: number | null };
  };
}

function FeedbackDetail({ id, canWrite, onBack }: { id: string; canWrite: boolean; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminApi<Detail>(`/feedback/${id}`)
      .then(setD)
      .catch((e) => setError(String(e.message)));
  }, [id]);
  const act = async (fn: () => Promise<Detail>) => {
    setBusy(true);
    setError(null);
    try {
      setD(await fn());
      return true;
    } catch (e) {
      setError(String((e as Error).message));
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!d) return <div className="muted">{error ?? '読み込み中…'}</div>;
  const f = d.feedback;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <button className="link-btn small" onClick={onBack}>
          ← フィードバック一覧
        </button>
        <h1 style={{ marginTop: 6 }}>{String(f.subject)}</h1>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="grid2">
        <div className="panel">
          <h3>原文（変更できません）</h3>
          <div className="small muted">
            {CATEGORY_LABEL[String(f.category)]}・{time(Number(f.created_at))}・{String(f.display_name)}（{String(f.username)}）{f.wants_reply ? '・返信希望' : ''}
          </div>
          <div className="original">{String(f.body)}</div>
          <h3 style={{ marginTop: 12 }}>自動で記録した情報</h3>
          <dl className="kv small">
            <dt>アプリのバージョン</dt>
            <dd>{f.app_version ?? '—'}</dd>
            <dt>プラットフォーム</dt>
            <dd>{f.platform ?? '—'}</dd>
            <dt>OS・端末</dt>
            <dd>
              {f.os ?? '—'}・{f.device_type ?? '—'}
            </dd>
            <dt>直前のモード</dt>
            <dd>{f.game_mode ?? '—'}</dd>
            <dt>直前の試合ID</dt>
            <dd className="mono">{f.last_match_id ?? '—'}</dd>
            <dt>直前のエラーコード</dt>
            <dd>{f.error_code ?? '—'}</dd>
          </dl>
          {d.activity && (
            <>
              <h3 style={{ marginTop: 12 }}>送った人の利用状況</h3>
              <dl className="kv small">
                <dt>タグ</dt>
                <dd>{d.activity.tags.map(tagLabel).join('・') || '—'}</dd>
                <dt>遊んだ日数・最後に遊んだ日</dt>
                <dd>
                  {d.activity.activeDays}日・{d.activity.lastActive ?? '—'}
                </dd>
                <dt>対戦（完了した試合）</dt>
                <dd>{d.activity.matches}試合</dd>
                <dt>リーグ後の評価</dt>
                <dd>
                  {d.activity.ratings.n
                    ? `${d.activity.ratings.n}回（ドラフト ${Number(d.activity.ratings.draftFun).toFixed(1)}・納得感 ${Number(d.activity.ratings.resultFair).toFixed(1)}）`
                    : 'なし'}
                </dd>
              </dl>
              {d.activity.leaguesBefore.length > 0 && (
                <table className="tbl small" style={{ marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th>送信前のリーグ</th>
                      <th>モード</th>
                      <th>順位</th>
                      <th>制限時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.activity.leaguesBefore.map((l) => (
                      <tr key={l.id}>
                        <td>{time(l.created_at)}</td>
                        <td>{MODE_LABEL[l.mode] ?? l.mode}</td>
                        <td>{l.final_rank ? `${l.final_rank}位` : l.status === 'finished' ? '—' : '途中'}</td>
                        <td>{l.pick_seconds ? `${l.pick_seconds}秒` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
        <div className="panel">
          <h3>状態・優先度</h3>
          <div className="row">
            <select disabled={!canWrite || busy} value={String(f.status)} onChange={(e) => act(() => adminApi(`/feedback/${id}`, { status: e.target.value }, 'PATCH'))} aria-label="状態">
              {STATUS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select disabled={!canWrite || busy} value={String(f.priority)} onChange={(e) => act(() => adminApi(`/feedback/${id}`, { priority: e.target.value }, 'PATCH'))} aria-label="優先度">
              {PRIORITY.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <h3 style={{ marginTop: 14 }}>プレイヤーへの返信（ゲームに表示されます）</h3>
          {d.replies.map((r) => (
            <div key={r.id} className="bubble reply">
              <div className="tiny muted">
                {time(r.created_at)}・{r.admin}・{r.read_at ? '既読' : '未読'}
              </div>
              {r.body}
            </div>
          ))}
          {canWrite && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (reply.trim() && (await confirmDialog('この返信をプレイヤーに送ります。よろしいですか？')) && (await act(() => adminApi(`/feedback/${id}/replies`, { body: reply })))) setReply('');
              }}
            >
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} rows={3} placeholder="プレイヤーに見える返信" />
              <button className="btn primary" disabled={busy || !reply.trim()}>
                返信を送る
              </button>
            </form>
          )}
          <h3 style={{ marginTop: 14 }}>内部メモ（プレイヤーには見えません）</h3>
          {d.notes.map((n) => (
            <div key={n.id} className="bubble note">
              <div className="tiny muted">
                {time(n.created_at)}・{n.admin}
              </div>
              {n.body}
            </div>
          ))}
          {canWrite && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (note.trim() && (await act(() => adminApi(`/feedback/${id}/notes`, { body: note })))) setNote('');
              }}
            >
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} placeholder="内部メモ" />
              <button className="btn" disabled={busy || !note.trim()}>
                メモを追加
              </button>
            </form>
          )}
          <h3 style={{ marginTop: 14 }}>操作の履歴</h3>
          {d.history.map((h, i) => (
            <div key={i} className="tiny muted">
              {time(h.created_at)}　{h.admin}　{h.action}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
