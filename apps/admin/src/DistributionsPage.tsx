import { useEffect, useState } from 'react';
import { adminApi } from './api';
import { fmtInt } from './charts';
import { TAGS, jstDay, tagLabel } from './InsightsPages';

const REASONS: Record<string, string> = {
  test_play: '友人テストプレイ',
  beta_reward: 'ベータテスト報酬',
  apology: '不具合のお詫び',
  campaign: 'キャンペーン',
  season: 'シーズン報酬',
  event: 'イベント報酬',
  other: 'その他',
};
const STATUS_LABEL: Record<string, string> = { ready: '実行前', running: '実行中', completed: '完了', cancelled: '中止' };
const time = (ms: number | null) => (ms ? new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—');
const newId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

type Kind = 'all' | 'users' | 'tags' | 'registered' | 'active';

interface Preview {
  count: number;
  amount: number;
  total: number;
  sample: string[];
  notFound: string[];
  limits: { perUser: number; total: number };
  problems: string[];
}

interface BatchRow {
  id: string;
  reason: string;
  title: string;
  amount_per_user: number;
  target_count: number;
  total_amount: number;
  status: string;
  granted_count: number;
  skipped_count: number;
  failed_count: number;
  created_at: number;
  completed_at: number | null;
  created_by_name: string;
  executed_by_name: string | null;
}

/** FREE GEMS distribution (spec 14, decisions 46-47) */
export function DistributionsPage({ canWrite }: { canWrite: boolean }) {
  const [list, setList] = useState<BatchRow[] | null>(null);
  const [limits, setLimits] = useState<{ perUser: number; total: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = () =>
    adminApi<{ items: BatchRow[]; limits: { perUser: number; total: number } }>('/distributions').then((r) => {
      setList(r.items);
      setLimits(r.limits);
    });
  useEffect(() => {
    load();
  }, []);
  if (selected) return <DistributionDetail id={selected} canWrite={canWrite} onBack={() => (setSelected(null), load())} />;
  if (creating) return <NewDistribution onDone={(id) => (setCreating(false), id ? setSelected(id) : load())} />;
  return (
    <div>
      <div className="spread">
        <h1>GEMS 配布</h1>
        {canWrite && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            新しい配布
          </button>
        )}
      </div>
      <div className="small muted" style={{ marginBottom: 12 }}>
        配布できるのは無償GEMSだけです。上限：1人あたり {fmtInt(limits?.perUser ?? 1000)}、1回の配布の合計 {fmtInt(limits?.total ?? 1000000)}。停止中のアカウントには配布しません。
      </div>
      {list && (
        <div className="panel scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>作成日時</th>
                <th>件名</th>
                <th>理由</th>
                <th className="num">1人あたり</th>
                <th className="num">対象</th>
                <th className="num">付与済み</th>
                <th className="num">合計</th>
                <th>状態</th>
                <th>作成・実行</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    まだ配布はありません
                  </td>
                </tr>
              )}
              {list.map((b) => (
                <tr key={b.id} className="clickable" tabIndex={0} onClick={() => setSelected(b.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(b.id)}>
                  <td>{time(b.created_at)}</td>
                  <td>{b.title}</td>
                  <td>{REASONS[b.reason] ?? b.reason}</td>
                  <td className="num">{fmtInt(b.amount_per_user)}</td>
                  <td className="num">{fmtInt(b.target_count)}人</td>
                  <td className="num">{fmtInt(b.granted_count)}人</td>
                  <td className="num">{fmtInt(b.total_amount)}</td>
                  <td>{STATUS_LABEL[b.status] ?? b.status}</td>
                  <td className="small">
                    {b.created_by_name}
                    {b.executed_by_name ? ` / ${b.executed_by_name}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewDistribution({ onDone }: { onDone: (id: string | null) => void }) {
  const [kind, setKind] = useState<Kind>('users');
  const [usernames, setUsernames] = useState('');
  const [tags, setTags] = useState<string[]>(['friend_tester']);
  const [regFrom, setRegFrom] = useState(jstDay(Date.now() - 7 * 86400000));
  const [regTo, setRegTo] = useState(jstDay(Date.now()));
  const [activeSince, setActiveSince] = useState(jstDay(Date.now() - 7 * 86400000));
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('beta_reward');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(newId);

  const jstStart = (d: string) => Date.parse(`${d}T00:00:00Z`) - 9 * 3600_000;
  const target = () => {
    switch (kind) {
      case 'all':
        return { kind };
      case 'users':
        return { kind, usernames: usernames.split(/[\s,、]+/).filter(Boolean) };
      case 'tags':
        return { kind, tags };
      case 'registered':
        return { kind, from: jstStart(regFrom), to: jstStart(regTo) + 86400000 };
      case 'active':
        return { kind, sinceDay: activeSince };
    }
  };
  const doPreview = async () => {
    setError(null);
    setBusy(true);
    try {
      setPreview(await adminApi<Preview>('/distributions/preview', { target: target(), amount: Number(amount) }));
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!preview || !title.trim()) return;
    if (!window.confirm(`${fmtInt(preview.count)}人に無償GEMSを ${fmtInt(preview.amount)} ずつ、合計 ${fmtInt(preview.total)} 配布する準備をします。\n（このあと詳細画面で「配布を実行」を押すと付与されます）`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi<{ batch: { id: string } }>('/distributions', { target: target(), amount: Number(amount), reason, title, note, requestId });
      onDone(r.batch.id);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  };
  // any change of the conditions invalidates the preview
  const changed = <T,>(fn: (v: T) => void) => (v: T) => {
    setPreview(null);
    fn(v);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
      <div>
        <button className="link-btn small" onClick={() => onDone(null)}>
          ← 配布の一覧
        </button>
        <h1 style={{ marginTop: 6 }}>新しい配布（無償GEMS）</h1>
      </div>
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3>1. 対象</h3>
        <div className="seg">
          {(
            [
              ['users', '指定ユーザー'],
              ['tags', 'タグ（テスター等）'],
              ['registered', '登録日'],
              ['active', '最近遊んだ人'],
              ['all', '全ユーザー'],
            ] as [Kind, string][]
          ).map(([k, l]) => (
            <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => changed(setKind)(k)}>
              {l}
            </button>
          ))}
        </div>
        {kind === 'users' && <textarea rows={3} placeholder="ユーザー名をスペース・カンマ・改行で区切って入力" value={usernames} onChange={(e) => changed(setUsernames)(e.target.value)} />}
        {kind === 'tags' && (
          <div className="row">
            {TAGS.map((t) => (
              <label key={t} className="toggle">
                <input type="checkbox" checked={tags.includes(t)} onChange={(e) => changed(setTags)(e.target.checked ? [...tags, t] : tags.filter((x) => x !== t))} />
                {tagLabel(t)}
              </label>
            ))}
          </div>
        )}
        {kind === 'registered' && (
          <div className="row small">
            <input type="date" value={regFrom} onChange={(e) => changed(setRegFrom)(e.target.value)} /> 〜 <input type="date" value={regTo} onChange={(e) => changed(setRegTo)(e.target.value)} /> に登録した人（日本時間）
          </div>
        )}
        {kind === 'active' && (
          <div className="row small">
            <input type="date" value={activeSince} onChange={(e) => changed(setActiveSince)(e.target.value)} /> 以降にゲームを開いた・遊んだ人
          </div>
        )}
        <h3>2. 数量</h3>
        <label className="row small">
          1人あたり
          <input type="number" min={1} max={1000} value={amount} onChange={(e) => changed(setAmount)(e.target.value)} style={{ width: 120 }} /> 無償GEMS（最大 1,000）
        </label>
        <button className="btn" disabled={busy} onClick={doPreview}>
          対象人数と合計を確認
        </button>
        {preview && (
          <div className={`preview ${preview.problems.length ? 'bad' : ''}`}>
            <div>
              対象 <b>{fmtInt(preview.count)}人</b> × {fmtInt(preview.amount)} ＝ 合計 <b>{fmtInt(preview.total)}</b> 無償GEMS
            </div>
            {preview.sample.length > 0 && <div className="tiny muted">例：{preview.sample.join('、')}{preview.count > preview.sample.length ? ' …' : ''}</div>}
            {preview.notFound.length > 0 && <div className="tiny">見つからない・停止中のため対象外：{preview.notFound.join('、')}</div>}
            {preview.problems.map((p) => (
              <div key={p} className="error tiny">
                {p}
              </div>
            ))}
          </div>
        )}
        <h3>3. 理由と件名</h3>
        <div className="row">
          <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="理由">
            {Object.entries(REASONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input placeholder="件名（例：11月の不具合のお詫び）" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        </div>
        <textarea rows={2} placeholder="メモ（任意・管理者だけが見る）" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy || !preview || preview.problems.length > 0 || !title.trim()} onClick={create}>
          この内容で配布を準備
        </button>
        <div className="tiny muted">準備した時点の対象者で固定されます。実行は次の画面で行います。</div>
      </div>
    </div>
  );
}

interface DetailData {
  batch: BatchRow & { note: string | null; target: Record<string, unknown>; started_at: number | null; cancelled_at: number | null };
  progress: { pending: number; granted: number; skipped: number; failed: number };
  items: { user_id: string; username: string; status: string; error: string | null; processed_at: number | null }[];
  reconciliation: { granted: number; claims: number; claimed_total: number; ledger_rows: number; ledger_total: number; expectedTotal: number; ok: boolean };
}

const ITEM_LABEL: Record<string, string> = { pending: '未付与', granted: '付与済み', skipped: '対象外', failed: '失敗' };
const TARGET_LABEL = (t: Record<string, unknown>) =>
  t.kind === 'all'
    ? '全ユーザー'
    : t.kind === 'users'
      ? `指定ユーザー（${(t.usernames as string[]).length}人の名前を指定）`
      : t.kind === 'tags'
        ? `タグ：${(t.tags as string[]).map(tagLabel).join('・')}`
        : t.kind === 'registered'
          ? `登録日 ${jstDay(Number(t.from))}〜${jstDay(Number(t.to) - 1)}`
          : `${String(t.sinceDay)} 以降に遊んだ人`;

function DistributionDetail({ id, canWrite, onBack }: { id: string; canWrite: boolean; onBack: () => void }) {
  const [d, setD] = useState<DetailData | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    adminApi<DetailData>(`/distributions/${id}`)
      .then(setD)
      .catch((e) => setError(String(e.message)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const run = async () => {
    if (!d) return;
    if (!window.confirm(`${fmtInt(d.batch.target_count)}人に無償GEMSを ${fmtInt(d.batch.amount_per_user)} ずつ配布します。実行しますか？`)) return;
    setRunning(true);
    setError(null);
    try {
      // the server pays up to 50 players per call; repeat until done
      for (let i = 0; i < 1000; i++) {
        const r = await adminApi<{ progress: DetailData['progress']; done: boolean }>(`/distributions/${id}/run`, {});
        setD((x) => (x ? { ...x, progress: r.progress } : x));
        if (r.done) break;
      }
    } catch (e) {
      setError(`${(e as Error).message}（もう一度「配布を実行」を押すと、未付与の人だけ続きから配布します）`);
    } finally {
      setRunning(false);
      load();
    }
  };
  const cancel = async () => {
    if (!window.confirm('配布を中止します。まだ付与していない人には配布されません。')) return;
    try {
      await adminApi(`/distributions/${id}/cancel`, {});
      load();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  if (!d) return <div className="muted">{error ?? '読み込み中…'}</div>;
  const b = d.batch;
  const p = d.progress;
  const doneShare = b.target_count ? (p.granted + p.skipped + p.failed) / b.target_count : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <button className="link-btn small" onClick={onBack}>
          ← 配布の一覧
        </button>
        <h1 style={{ marginTop: 6 }}>{b.title}</h1>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="grid2">
        <div className="panel">
          <dl className="kv small">
            <dt>状態</dt>
            <dd>{STATUS_LABEL[b.status] ?? b.status}</dd>
            <dt>理由</dt>
            <dd>{REASONS[b.reason] ?? b.reason}</dd>
            <dt>対象</dt>
            <dd>{TARGET_LABEL(b.target)}</dd>
            <dt>1人あたり</dt>
            <dd>無償GEMS {fmtInt(b.amount_per_user)}</dd>
            <dt>対象人数・合計</dt>
            <dd>
              {fmtInt(b.target_count)}人・{fmtInt(b.total_amount)}
            </dd>
            <dt>作成</dt>
            <dd>
              {time(b.created_at)}（{b.created_by_name}）
            </dd>
            <dt>実行</dt>
            <dd>
              {time(b.started_at)}
              {b.executed_by_name ? `（${b.executed_by_name}）` : ''}
            </dd>
            <dt>完了</dt>
            <dd>{time(b.completed_at)}</dd>
            {b.note && (
              <>
                <dt>メモ</dt>
                <dd>{b.note}</dd>
              </>
            )}
          </dl>
          {canWrite && (b.status === 'ready' || b.status === 'running') && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={running} onClick={run}>
                {running ? '配布中…' : b.status === 'running' ? '続きを配布' : '配布を実行'}
              </button>
              <button className="btn" disabled={running} onClick={cancel}>
                中止
              </button>
            </div>
          )}
        </div>
        <div className="panel">
          <h3>進み具合</h3>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(doneShare * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${doneShare * 100}%` }} />
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            付与済み {fmtInt(p.granted)}・未付与 {fmtInt(p.pending)}・対象外 {fmtInt(p.skipped)}・失敗 {fmtInt(p.failed)}
          </div>
          <h3 style={{ marginTop: 14 }}>照合</h3>
          <div className={`preview ${d.reconciliation.ok ? '' : 'bad'}`}>
            <div className="small">
              {d.reconciliation.ok ? '✓ 一致' : '✗ 不一致'}：付与済み {fmtInt(d.reconciliation.granted)}人／付与の記録 {fmtInt(d.reconciliation.claims)}件／通貨台帳 {fmtInt(d.reconciliation.ledger_rows)}行・合計 {fmtInt(d.reconciliation.ledger_total)}（期待値 {fmtInt(d.reconciliation.expectedTotal)}）
            </div>
          </div>
        </div>
      </div>
      <div className="panel scroll-x">
        <h3>対象者（最大500人）</h3>
        <table className="tbl tiny">
          <tbody>
            {d.items.map((i) => (
              <tr key={i.user_id}>
                <td>{i.username}</td>
                <td>{ITEM_LABEL[i.status] ?? i.status}</td>
                <td className="muted">{i.error ?? ''}</td>
                <td>{time(i.processed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
