import { useEffect, useState } from 'react';
import { adminApi } from './api';
import { confirmDialog } from './dialog';
import { BarList, ColumnChart, HeatCell, StatTile, fmtDuration, fmtInt, fmtPct } from './charts';
import { TimerTable, type TimerRow } from './GameStatsPages';
import { DevToggle, MODE_LABEL, PeriodFilter, TAGS, jstDay, tagLabel, useDev, useLoad, type Period } from './InsightsPages';

/**
 * Beta Testing (spec 12-2, 15; decisions 60-67): report, testers and the test tools.
 */

const newId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const dec = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d }));
const time = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—');
const names = (text: string) => [...new Set(text.split(/[\s,、]+/).map((s) => s.trim()).filter(Boolean))];
const BETA_TAGS = ['friend_tester', 'beta_tester', 'founder', 'developer'];
const CATEGORY: Record<string, string> = { bug: '不具合', feature: '機能の提案', balance: 'ゲームバランス', payment: '支払い', other: 'その他' };

interface Props {
  canUsers: boolean;
  canManage: boolean;
  canGrant: boolean;
  /** staging / local: test grants and resets are possible (decisions 42, 67) */
  testTools: boolean;
}

export function BetaPage(p: Props) {
  const [tab, setTab] = useState<'report' | 'testers' | 'tools'>('report');
  return (
    <div>
      <h1>Beta Testing</h1>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>
          レポート
        </button>
        {p.canUsers && (
          <button className={tab === 'testers' ? 'on' : ''} onClick={() => setTab('testers')}>
            テスター
          </button>
        )}
        <button className={tab === 'tools' ? 'on' : ''} onClick={() => setTab('tools')}>
          制限時間・テスト用ツール
        </button>
      </div>
      {tab === 'report' && <Report />}
      {tab === 'testers' && p.canUsers && <Testers canManage={p.canManage} />}
      {tab === 'tools' && <Tools {...p} />}
    </div>
  );
}

// ---------------------------------------------------------------- report

interface ReportData {
  period: Period & { days: number };
  generatedAt: number;
  testers: { total: number; registeredInPeriod: number; active: number; byTag: { tag: string; n: number }[]; developersExcluded: number };
  retention: { average: Record<string, number | null>; cohorts: number; players: number };
  activity: { activeUsers: number; sessions: number; matches: number; avgPlaytimeMs: number | null; avgMatches: number | null; avgSessionMs: number | null; draftCompletion: number | null; matchCompletion: number | null };
  series: { day: string; active: number }[];
  revisit: { players: number; returned: number; rate: number | null };
  abandon: { leagues: number; abandoned: number; rate: number | null };
  features: { key: string; label: string; players: number; rate: number | null }[];
  feedback: { total: number; open: number; byCategory: { category: string; n: number }[] };
  ratings: {
    count: number;
    draftFun: number | null;
    resultFair: number | null;
    histogram: { draftFun: number[]; resultFair: number[] };
    byMode: { key: string | null; n: number; draftFun: number; resultFair: number }[];
    byFormation: { key: string | null; n: number; draftFun: number; resultFair: number }[];
  };
  timer: TimerRow[];
}

const DAYS = ['1', '3', '7', '14', '30'];

/** the report as Markdown (to save or paste; numbers only from the records) */
function toMarkdown(d: ReportData, tag: string): string {
  const pct = (r: number | null) => fmtPct(r);
  const lines = [
    `# FOOTBALL DRAFT ベータテスト レポート`,
    '',
    `- 期間：${d.period.from} 〜 ${d.period.to}（日本時間、${d.period.days}日）`,
    `- 対象：${tag ? tagLabel(tag) : '全ユーザー'}${d.testers.developersExcluded ? `（Developer ${d.testers.developersExcluded}人を除く）` : ''}`,
    `- 作成：${time(d.generatedAt)}`,
    '',
    '## テスター',
    `- 登録者 ${d.testers.total}人（期間中の登録 ${d.testers.registeredInPeriod}人）、期間中に遊んだ人 ${d.testers.active}人`,
    `- タグ：${d.testers.byTag.map((t) => `${tagLabel(t.tag)} ${t.n}人`).join('、') || '—'}`,
    '',
    '## 継続率（期間中に登録した人）',
    `| ${DAYS.map((n) => `D${n}`).join(' | ')} |`,
    `| ${DAYS.map(() => '---').join(' | ')} |`,
    `| ${DAYS.map((n) => pct(d.retention.average[n] ?? null)).join(' | ')} |`,
    '',
    `（— はまだ測れない日。登録 ${d.retention.players}人・${d.retention.cohorts}日分）`,
    '',
    '## 遊び方',
    `- 平均プレイ時間（1人1日）：${fmtDuration(d.activity.avgPlaytimeMs)}`,
    `- 平均対戦回数（1人1日・完了した試合）：${dec(d.activity.avgMatches)}`,
    `- ドラフト完了率：${pct(d.activity.draftCompletion)}、試合完了率：${pct(d.activity.matchCompletion)}`,
    `- 途中退出率（リーグの終了時にゲームを開いていなかった）：${pct(d.abandon.rate)}（${d.abandon.abandoned} / ${d.abandon.leagues}リーグ）`,
    `- 再訪率（期間中に2日以上遊んだ人）：${pct(d.revisit.rate)}（${d.revisit.returned} / ${d.revisit.players}人）`,
    '',
    '## 機能別利用率（期間中に遊んだ人のうち）',
    ...d.features.map((f) => `- ${f.label}：${pct(f.rate)}（${f.players}人）`),
    '',
    '## リーグ後の評価（5段階）',
    `- 回答 ${d.ratings.count}件：ドラフトの楽しさ ${dec(d.ratings.draftFun)}、試合結果の納得感 ${dec(d.ratings.resultFair)}`,
    ...d.ratings.byMode.map((m) => `- ${MODE_LABEL[String(m.key)] ?? m.key}：${m.n}件、楽しさ ${dec(m.draftFun)}、納得感 ${dec(m.resultFair)}`),
    '',
    '## ドラフトの制限時間の比較（クイックドラフト・ランク戦・Collection Draft）',
    '| 秒数 | ドラフト | 完了率 | 時間切れ | 途中で離れた | 評価（楽しさ） |',
    '| --- | --- | --- | --- | --- | --- |',
    ...d.timer.map((t) => `| ${t.seconds}秒 | ${t.drafts} | ${pct(t.completionRate)} | ${pct(t.autoRate)} | ${pct(t.abandonRate)} | ${dec(t.draftFun)}（${t.ratings}件） |`),
    '',
    '## フィードバック',
    `- ${d.feedback.total}件（未対応 ${d.feedback.open}件）：${d.feedback.byCategory.map((c) => `${CATEGORY[c.category] ?? c.category} ${c.n}`).join('、') || '—'}`,
    '',
    '※ 数字はすべてゲームの記録から集計したものです。少人数のテストのため、市場全体の継続率や売上を示すものではありません（設計書 15-3）。',
  ];
  return lines.join('\n');
}

function Report() {
  const [period, setPeriod] = useState<Period | null>(null);
  const [tag, setTag] = useState('');
  const [noDev, setNoDev, devQs] = useDev();
  const qs = `${period ? `from=${period.from}&to=${period.to}` : ''}${tag ? `&tag=${tag}` : ''}${devQs}`;
  const { data: d, error, loading } = useLoad<ReportData>(`/beta/report?${qs}`);
  const [copied, setCopied] = useState(false);
  const shown = period ?? (d ? { from: d.period.from, to: d.period.to } : { from: jstDay(Date.now()), to: jstDay(Date.now()) });
  const save = () => {
    if (!d) return;
    const blob = new Blob([toMarkdown(d, tag)], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `beta-report-${d.period.from}_${d.period.to}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <PeriodFilter value={shown} onChange={setPeriod}>
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="ユーザーグループ">
          <option value="">全ユーザー</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {tagLabel(t)}
            </option>
          ))}
        </select>
        <DevToggle value={noDev} onChange={setNoDev} />
      </PeriodFilter>
      {!period && <div className="tiny muted" style={{ marginTop: -6, marginBottom: 10 }}>最初の登録日（最大90日前）から今日までを表示しています。</div>}
      {error && <div className="error">{error}</div>}
      {d && (
        <div style={{ opacity: loading ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row">
            <button className="btn" onClick={save}>
              Markdown で保存
            </button>
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(toMarkdown(d, tag));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'コピーしました' : 'Markdown をコピー'}
            </button>
            <span className="tiny muted">作成 {time(d.generatedAt)}・数字はすべて記録から集計（少人数のテストのため、市場全体の数字ではありません）</span>
          </div>
          <div className="tiles">
            <StatTile label="登録者" value={d.testers.total} sub={`期間中の登録 ${d.testers.registeredInPeriod}人${d.testers.developersExcluded ? `・Developer ${d.testers.developersExcluded}人を除く` : ''}`} />
            <StatTile label="期間中に遊んだ人" value={d.testers.active} />
            <StatTile label="再訪率" value={d.revisit.rate} format={(n) => fmtPct(n)} sub={`2日以上遊んだ ${d.revisit.returned} / ${d.revisit.players}人`} />
            <StatTile label="平均プレイ時間（1人1日）" value={d.activity.avgPlaytimeMs} format={fmtDuration} />
            <StatTile label="平均対戦回数（1人1日）" value={d.activity.avgMatches} format={(n) => dec(n)} />
            <StatTile label="ドラフト完了率" value={d.activity.draftCompletion} format={(n) => fmtPct(n)} />
            <StatTile label="試合完了率" value={d.activity.matchCompletion} format={(n) => fmtPct(n)} />
            <StatTile label="途中退出率" value={d.abandon.rate} format={(n) => fmtPct(n)} upIsGood={false} sub={`リーグの終了時にいなかった ${d.abandon.abandoned} / ${d.abandon.leagues}リーグ`} />
            <StatTile label="フィードバック" value={d.feedback.total} sub={`未対応 ${d.feedback.open}件`} />
          </div>
          <div className="panel">
            <h3>継続率（期間中に登録した {d.retention.players}人）</h3>
            <table className="tbl">
              <thead>
                <tr>
                  {DAYS.map((n) => (
                    <th key={n}>D{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {DAYS.map((n) => (
                    <HeatCell key={n} rate={d.retention.average[n] ?? null} />
                  ))}
                </tr>
              </tbody>
            </table>
            <div className="tiny muted">— は対象の日がまだ終わっていない（D7 は登録から8日、D30 は31日たつと出ます）</div>
          </div>
          <div className="grid2">
            <div className="panel">
              <BarList title="機能別利用率（期間中に遊んだ人のうち）" data={d.features.map((f) => ({ label: f.label, value: Math.round((f.rate ?? 0) * 1000) / 10 }))} format={(n) => `${n}%`} />
            </div>
            <div className="panel">
              <ColumnChart title="遊んだ人（日別）" data={d.series.map((s) => ({ label: s.day, value: s.active }))} />
            </div>
          </div>
          <div className="panel">
            <h3>リーグ後の評価（{d.ratings.count}件）</h3>
            <div className="tiles">
              <StatTile label="ドラフトは楽しかった？" value={d.ratings.draftFun} format={(n) => `${dec(n)} / 5`} />
              <StatTile label="試合結果は納得できた？" value={d.ratings.resultFair} format={(n) => `${dec(n)} / 5`} />
            </div>
            <div className="grid2" style={{ marginTop: 10 }}>
              <ColumnChart title="ドラフトの楽しさ（回答数）" data={d.ratings.histogram.draftFun.map((n, i) => ({ label: `${i + 1}`, value: n }))} height={140} />
              <ColumnChart title="試合結果の納得感（回答数）" data={d.ratings.histogram.resultFair.map((n, i) => ({ label: `${i + 1}`, value: n }))} height={140} />
            </div>
            {d.ratings.byMode.length > 0 && (
              <div className="scroll-x">
                <table className="tbl" style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>モード</th>
                      <th className="num">回答</th>
                      <th className="num">楽しさ</th>
                      <th className="num">納得感</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ratings.byMode.map((m) => (
                      <tr key={String(m.key)}>
                        <td>{MODE_LABEL[String(m.key)] ?? m.key}</td>
                        <td className="num">{m.n}</td>
                        <td className="num">{dec(m.draftFun)}</td>
                        <td className="num">{dec(m.resultFair)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="panel">
            <h3>ドラフトの制限時間の比較（決定 66）</h3>
            <TimerTable rows={d.timer} />
          </div>
          <div className="panel">
            <h3>フィードバック（{d.feedback.total}件）</h3>
            <div className="row small">
              {d.feedback.byCategory.length === 0 && <span className="muted">まだありません</span>}
              {d.feedback.byCategory.map((c) => (
                <span key={c.category} className="chip">
                  {CATEGORY[c.category] ?? c.category} {c.n}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- testers

interface TesterRow {
  id: string;
  username: string;
  displayName: string;
  status: string;
  createdAt: number;
  tags: string[];
  lastActive: string | null;
  activeDays: number;
  matches: number;
  feedback: number;
  lastReset: number | null;
}

function Testers({ canManage }: { canManage: boolean }) {
  const [filter, setFilter] = useState('');
  const [tick, setTick] = useState(0);
  const { data: d, error } = useLoad<{ total: number; counts: Record<string, number>; items: TesterRow[] }>(`/beta/testers?${filter ? `tag=${filter}&` : ''}t=${tick}`);
  const [text, setText] = useState('');
  const [tag, setTag] = useState('friend_tester');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const change = async (action: 'add' | 'remove') => {
    setMsg(null);
    setErr(null);
    const list = names(text);
    if (list.length === 0) return setErr('ユーザー名を入力してください');
    try {
      const r = await adminApi<{ changed: number; notFound: string[] }>('/beta/tags', { usernames: list, tag, action });
      setMsg(`${r.changed}人に「${tagLabel(tag)}」を${action === 'add' ? '付けました' : '外しました'}${r.notFound.length ? `。見つからない名前：${r.notFound.join('、')}` : ''}`);
      setTick((t) => t + 1);
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {d && (
        <div className="tiles">
          <StatTile label="登録者（全体）" value={d.total} />
          {TAGS.map((t) => (
            <StatTile key={t} label={tagLabel(t)} value={d.counts[t] ?? 0} />
          ))}
        </div>
      )}
      {canManage && (
        <div className="panel">
          <h3>タグをまとめて付ける・外す</h3>
          <div className="small muted">ベータは誰でも登録できます（決定 61）。参加した友人のユーザー名を入力してタグを付けると、レポートや配布でグループごとに扱えます。</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="ユーザー名（改行・空白・カンマ区切り、最大500人）" style={{ width: '100%', marginTop: 8 }} />
          <div className="row" style={{ marginTop: 8 }}>
            <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="タグ">
              {BETA_TAGS.map((t) => (
                <option key={t} value={t}>
                  {tagLabel(t)}
                </option>
              ))}
            </select>
            <button className="btn primary" onClick={() => change('add')}>
              付ける
            </button>
            <button className="btn" onClick={() => change('remove')}>
              外す
            </button>
          </div>
          {msg && <div className="small good" style={{ marginTop: 6 }}>{msg}</div>}
          {err && <div className="error">{err}</div>}
        </div>
      )}
      <div className="panel">
        <div className="spread">
          <h3 style={{ margin: 0 }}>テスター（Normal 以外のタグの人）</h3>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="タグで絞り込み">
            <option value="">Normal 以外すべて</option>
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {tagLabel(t)}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="error">{error}</div>}
        {d && d.items.length === 0 && <div className="small muted" style={{ marginTop: 8 }}>該当する人はいません</div>}
        {d && d.items.length > 0 && (
          <div className="scroll-x">
            <table className="tbl" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>ユーザー</th>
                  <th>タグ</th>
                  <th>登録</th>
                  <th>最後に遊んだ日</th>
                  <th className="num">遊んだ日数</th>
                  <th className="num">試合</th>
                  <th className="num">フィードバック</th>
                  <th>リセット</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.displayName} <span className="tiny muted">{u.username}</span>
                      {u.status !== 'active' && <span className="tiny bad"> 停止中</span>}
                    </td>
                    <td>{u.tags.map(tagLabel).join('・')}</td>
                    <td className="tiny">{jstDay(u.createdAt)}</td>
                    <td className="tiny">{u.lastActive ?? '—'}</td>
                    <td className="num">{u.activeDays}</td>
                    <td className="num">{fmtInt(u.matches)}</td>
                    <td className="num">{u.feedback}</td>
                    <td className="tiny">{u.lastReset ? time(u.lastReset) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tools

type TimerSetting = { mode: 'compare'; variants: number[] } | { mode: 'fixed'; seconds: number };
const CHOICES = [5, 8, 10, 12, 15];

function DraftTimer({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<{ setting: TimerSetting; updatedAt: number | null } | null>(null);
  const [mode, setMode] = useState<'compare' | 'fixed'>('compare');
  const [variants, setVariants] = useState<number[]>([8, 12]);
  const [seconds, setSeconds] = useState(8);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () =>
    adminApi<{ setting: TimerSetting; updatedAt: number | null }>('/beta/draft-timer').then((r) => {
      setData(r);
      setMode(r.setting.mode);
      if (r.setting.mode === 'compare') setVariants(r.setting.variants);
      else setSeconds(r.setting.seconds);
    });
  useEffect(() => {
    load().catch((e) => setErr(String(e.message)));
  }, []);
  const save = async () => {
    setMsg(null);
    setErr(null);
    const body = mode === 'compare' ? { mode, variants } : { mode, seconds };
    if (!(await confirmDialog(mode === 'compare' ? `新しいルームを ${variants.join('秒・')}秒 に分けて比べます。よろしいですか？` : `新しいルームをすべて ${seconds}秒 にします。よろしいですか？`))) return;
    try {
      await adminApi('/beta/draft-timer', body, 'PUT');
      await load();
      setMsg('保存しました（これから作られるルームに反映されます）');
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };
  return (
    <div className="panel">
      <h3>ドラフトの制限時間（決定 66）</h3>
      <div className="small muted">
        クイックドラフト・ランク戦・Collection Draft のルームに使います。比べる時はルームの ID で秒数が決まり、同じルームの全員が同じ秒数です。プライベートルームはホストが選びます。
      </div>
      {data && (
        <div className="small" style={{ margin: '8px 0' }}>
          現在：<b>{data.setting.mode === 'compare' ? `${data.setting.variants.join('秒と')}秒を比べる` : `${data.setting.seconds}秒に固定`}</b>
          {data.updatedAt && <span className="muted">（{time(data.updatedAt)} に変更）</span>}
        </div>
      )}
      {canManage && (
        <>
          <div className="row">
            <label className="check-inline small">
              <input type="radio" checked={mode === 'compare'} onChange={() => setMode('compare')} /> 比べる
            </label>
            {mode === 'compare' &&
              CHOICES.map((c) => (
                <label key={c} className="check-inline small">
                  <input
                    type="checkbox"
                    checked={variants.includes(c)}
                    onChange={(e) => setVariants((v) => (e.target.checked ? [...v, c].sort((a, b) => a - b) : v.filter((x) => x !== c)))}
                  />
                  {c}秒
                </label>
              ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="check-inline small">
              <input type="radio" checked={mode === 'fixed'} onChange={() => setMode('fixed')} /> 固定する
            </label>
            {mode === 'fixed' && (
              <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="秒数">
                {CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}秒
                  </option>
                ))}
              </select>
            )}
            <button className="btn primary" disabled={mode === 'compare' && (variants.length < 2 || variants.length > 3)} onClick={save}>
              保存
            </button>
            {mode === 'compare' && (variants.length < 2 || variants.length > 3) && <span className="tiny muted">2〜3個選んでください</span>}
          </div>
        </>
      )}
      {msg && <div className="small good">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function TargetInput({ value, onChange }: { value: { kind: 'users' | 'tag'; text: string; tag: string }; onChange: (v: { kind: 'users' | 'tag'; text: string; tag: string }) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row">
        <label className="check-inline small">
          <input type="radio" checked={value.kind === 'users'} onChange={() => onChange({ ...value, kind: 'users' })} /> ユーザー名で指定
        </label>
        <label className="check-inline small">
          <input type="radio" checked={value.kind === 'tag'} onChange={() => onChange({ ...value, kind: 'tag' })} /> タグで指定
        </label>
        {value.kind === 'tag' && (
          <select value={value.tag} onChange={(e) => onChange({ ...value, tag: e.target.value })} aria-label="タグ">
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {tagLabel(t)}
              </option>
            ))}
          </select>
        )}
      </div>
      {value.kind === 'users' && <textarea rows={2} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder="ユーザー名（改行・空白・カンマ区切り）" />}
    </div>
  );
}

const targetBody = (t: { kind: 'users' | 'tag'; text: string; tag: string }) => (t.kind === 'tag' ? { tag: t.tag } : { usernames: names(t.text) });
const targetText = (t: { kind: 'users' | 'tag'; text: string; tag: string }) => (t.kind === 'tag' ? `タグ「${tagLabel(t.tag)}」の全員` : `${names(t.text).length}人`);

const KINDS: [string, string][] = [
  ['COINS', 'COINS'],
  ['GEMS_FREE', '無償GEMS'],
  ['GEMS_PAID_GRANTED', '有償GEMS（配布）'],
  ['GEMS_PAID_PURCHASED', '有償GEMS（購入扱い）'],
  ['POINTS_STANDARD', 'Standard 交換ポイント'],
  ['POINTS_PREMIUM', 'Premium 交換ポイント'],
];

function BulkGrant() {
  const [target, setTarget] = useState({ kind: 'tag' as 'users' | 'tag', text: '', tag: 'friend_tester' });
  const [kind, setKind] = useState('COINS');
  const [amount, setAmount] = useState('1000');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setMsg(null);
    setErr(null);
    const label = KINDS.find((k) => k[0] === kind)?.[1];
    if (!(await confirmDialog(`${targetText(target)}に ${label} を1人 ${Number(amount).toLocaleString('ja-JP')} 付与します（テスト用・staging とローカルのみ）。よろしいですか？`))) return;
    setBusy(true);
    try {
      const r = await adminApi<{ players: number; paid: number; notFound: string[] }>('/beta/test-grants', { target: targetBody(target), kind, amount: Number(amount), note, requestId: newId() });
      setMsg(`${r.paid}人に付与しました${r.notFound.length ? `。見つからない名前：${r.notFound.join('、')}` : ''}`);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <h3>テスト用の付与（まとめて）</h3>
      <div className="small muted">経済の数字が崩れないよう、必要な時だけ使います（決定 62）。無償GEMS は「GEMS 配布」からも配れます。操作ログに記録されます。</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        <TargetInput value={target} onChange={setTarget} />
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="種類">
            {KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="1人あたりの数" style={{ width: 120 }} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（任意）" maxLength={200} />
          <button className="btn primary" disabled={busy || !Number(amount)} onClick={run}>
            付与する
          </button>
        </div>
      </div>
      {msg && <div className="small good">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

interface ResetRun {
  id: string;
  target: { usernames?: string[]; tag?: string };
  note: string | null;
  total: number;
  done: number;
  status: string;
  createdAt: number;
  finishedAt: number | null;
  admin: string | null;
}

function Reset() {
  const [target, setTarget] = useState({ kind: 'users' as 'users' | 'tag', text: '', tag: 'friend_tester' });
  const [note, setNote] = useState('');
  const [runs, setRuns] = useState<ResetRun[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => adminApi<{ items: ResetRun[] }>('/beta/resets').then((r) => setRuns(r.items));
  useEffect(() => {
    load().catch(() => undefined);
  }, []);
  const run = async () => {
    setErr(null);
    setProgress(null);
    if (
      !(await confirmDialog(
        `${targetText(target)}の持ち物（COINS・GEMS・交換ポイント・カード・Collection Draft の登録・ガシャの天井・ミッション・Season Pass）を初期状態に戻します。アカウント・対戦記録・フィードバックは残ります。元に戻せません。よろしいですか？`,
        { okLabel: '初期化する', danger: true },
      ))
    )
      return;
    setBusy(true);
    try {
      const created = await adminApi<{ id: string; players: number; notFound: string[] }>('/beta/resets', { target: targetBody(target), note });
      for (let i = 0; i < 200; i++) {
        const r = await adminApi<{ progress: { total: number; done: number }; done: boolean }>(`/beta/resets/${created.id}/run`, {});
        setProgress(`${r.progress.done} / ${r.progress.total}人`);
        if (r.done) break;
      }
      setProgress((p) => `完了：${p}${created.notFound.length ? `。見つからない名前：${created.notFound.join('、')}` : ''}`);
      await load();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <h3>テストデータのリセット（決定 67）</h3>
      <div className="small muted">
        持ち物だけを初期状態に戻します（残高は台帳に「テストのリセット」として記録）。アカウント・タグ・対戦記録・レーティング・各種の履歴・フィードバック・分析データ・購入記録は残ります。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        <TargetInput value={target} onChange={setTarget} />
        <div className="row">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="理由（任意）" maxLength={200} style={{ flex: 1 }} />
          <button className="btn danger" disabled={busy || (target.kind === 'users' && names(target.text).length === 0)} onClick={run}>
            リセットする
          </button>
        </div>
      </div>
      {progress && <div className="small good">{progress}</div>}
      {err && <div className="error">{err}</div>}
      {runs.length > 0 && (
        <div className="scroll-x">
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>日時</th>
                <th>対象</th>
                <th className="num">人数</th>
                <th>状態</th>
                <th>管理者</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="tiny">{time(r.createdAt)}</td>
                  <td className="small">{r.target.tag ? `タグ：${tagLabel(r.target.tag)}` : (r.target.usernames ?? []).slice(0, 3).join('、') + ((r.target.usernames?.length ?? 0) > 3 ? ` ほか${(r.target.usernames?.length ?? 0) - 3}人` : '')}</td>
                  <td className="num">
                    {r.done} / {r.total}
                  </td>
                  <td>{r.status === 'completed' ? '完了' : '途中'}</td>
                  <td className="small">{r.admin ?? '—'}</td>
                  <td className="small">{r.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tools({ canManage, canGrant, testTools }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DraftTimer canManage={canManage} />
      {!testTools && (canGrant || canManage) && <div className="notice-admin small">テスト用の付与とリセットは staging とローカルだけで使えます（この環境では使えません）。</div>}
      {testTools && canGrant && <BulkGrant />}
      {testTools && canManage && <Reset />}
    </div>
  );
}
