import { useEffect, useState } from 'react';
import { adminApi } from './api';
import { BarList, ColumnChart, HeatCell, StatTile, fmtDuration, fmtInt } from './charts';

/** Japan date of a time (all analytics use Japan days) */
export const jstDay = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export interface Period {
  from: string;
  to: string;
}

const PRESETS = [7, 14, 30, 90];

/** date range first, presets before a custom range (one row above the content) */
export function PeriodFilter({ value, onChange, children }: { value: Period; onChange: (p: Period) => void; children?: React.ReactNode }) {
  const today = jstDay(Date.now());
  const days = Math.round((Date.parse(value.to) - Date.parse(value.from)) / 86400000) + 1;
  return (
    <div className="filter-row">
      <div className="seg">
        {PRESETS.map((n) => (
          <button key={n} type="button" className={value.to === today && days === n ? 'on' : ''} onClick={() => onChange({ from: addDays(today, -(n - 1)), to: today })}>
            {n}日
          </button>
        ))}
      </div>
      <label className="tiny muted">
        開始
        <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
      </label>
      <label className="tiny muted">
        終了
        <input type="date" value={value.to} min={value.from} max={today} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
      </label>
      {children}
      <span className="tiny muted">日付は日本時間</span>
    </div>
  );
}

/** Developer accounts (Staging check, the team) are left out unless shown (decision 60) */
export function DevToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="tiny muted check-inline">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      Developer を除く
    </label>
  );
}

export function useDev(): [boolean, (v: boolean) => void, string] {
  const [exclude, setExclude] = useState(true);
  return [exclude, setExclude, exclude ? '' : '&dev=include'];
}

export function usePeriod(days = 14): [Period, (p: Period) => void] {
  const today = jstDay(Date.now());
  return useState<Period>({ from: addDays(today, -(days - 1)), to: today });
}

export function useLoad<T>(path: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    adminApi<T>(path)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(String(e.message)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path]);
  return { data, error, loading };
}

interface Summary {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  matches: number;
  avgPlaytimeMs: number | null;
  avgMatches: number | null;
  avgSessionMs: number | null;
  draftCompletion: number | null;
  matchCompletion: number | null;
  dau: number;
  wau: number;
  mau: number;
  gemsSpent: number;
  errors: number;
}

interface Overview {
  period: Period & { days: number };
  previous: Period;
  today: string;
  totals: { users: number; suspended: number; open_feedback: number; new_feedback: number; gems_free: number; gems_paid: number };
  current: Summary;
  before: Summary;
  series: { day: string; active: number; sessions: number; playtimeMs: number; matches: number; newUsers: number }[];
  retention: Record<string, number | null>;
  revenue: {
    implemented: boolean;
    storesConnected: boolean;
    cumulativeNet: number;
    net: number;
    mockGross: number;
    payers: number;
    payerRate: number | null;
    arpu: number | null;
    arppu: number | null;
  };
}

const dec = (n: number) => n.toLocaleString('ja-JP', { maximumFractionDigits: 1 });

export function OverviewPage({ onOpen }: { onOpen?: (page: string) => void }) {
  const [period, setPeriod] = usePeriod(14);
  const [noDev, setNoDev, devQs] = useDev();
  const { data: d, error, loading } = useLoad<Overview>(`/overview?from=${period.from}&to=${period.to}${devQs}`);
  return (
    <div>
      <h1>Overview</h1>
      <PeriodFilter value={period} onChange={setPeriod}>
        <DevToggle value={noDev} onChange={setNoDev} />
      </PeriodFilter>
      {error && <div className="error">{error}</div>}
      {d && (
        <div style={{ opacity: loading ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="tiles">
            <StatTile label="総登録者数" value={d.totals.users} sub={`停止中 ${d.totals.suspended}人`} />
            <StatTile label="新規登録" value={d.current.newUsers} prev={d.before.newUsers} />
            <StatTile label={`DAU（${d.period.to}）`} value={d.current.dau} prev={d.before.dau} />
            <StatTile label="WAU（7日）" value={d.current.wau} prev={d.before.wau} />
            <StatTile label="MAU（30日）" value={d.current.mau} prev={d.before.mau} />
            <StatTile label="期間中のアクティブ" value={d.current.activeUsers} prev={d.before.activeUsers} />
            <StatTile label="平均プレイ時間（1人1日）" value={d.current.avgPlaytimeMs} prev={d.before.avgPlaytimeMs} format={fmtDuration} />
            <StatTile label="平均対戦数（1人1日）" value={d.current.avgMatches} prev={d.before.avgMatches} format={dec} />
            <StatTile label="D1 継続率" value={d.retention['1'] === null ? null : d.retention['1'] * 100} format={(n) => `${n.toFixed(1)}%`} sub="直近60日の登録者" />
            <StatTile label="D7 継続率" value={d.retention['7'] === null ? null : d.retention['7'] * 100} format={(n) => `${n.toFixed(1)}%`} sub="直近60日の登録者" />
            <StatTile label="消費GEMS" value={d.current.gemsSpent} prev={d.before.gemsSpent} />
            <StatTile label="未使用GEMS" value={d.totals.gems_free + d.totals.gems_paid} sub={`無償 ${fmtInt(d.totals.gems_free)}・有償 ${fmtInt(d.totals.gems_paid)}`} />
            <button type="button" className="stat-tile link" onClick={() => onOpen?.('feedback')}>
              <div className="label">未対応フィードバック</div>
              <div className="value">{fmtInt(d.totals.open_feedback)}</div>
              <div className="tiny muted">うち新着 {d.totals.new_feedback}</div>
            </button>
            <StatTile label="エラー件数（API）" value={d.current.errors} prev={d.before.errors} upIsGood={false} />
            <button type="button" className="stat-tile link" onClick={() => onOpen?.('revenue')}>
              <div className="label">累計売上（返金後）</div>
              <div className="value">¥{fmtInt(d.revenue.cumulativeNet)}</div>
              <div className="tiny muted">
                期間 ¥{fmtInt(d.revenue.net)}・課金率 {d.revenue.payerRate === null ? '—' : `${(d.revenue.payerRate * 100).toFixed(1)}%`}・ARPU {d.revenue.arpu === null ? '—' : `¥${Math.round(d.revenue.arpu)}`}・ARPPU{' '}
                {d.revenue.arppu === null ? '—' : `¥${Math.round(d.revenue.arppu)}`}
              </div>
              {!d.revenue.storesConnected && <div className="tiny muted">ストア未接続（模擬ストアの購入はテスト）</div>}
            </button>
          </div>
          <div className="grid2">
            <div className="panel">
              <ColumnChart title="DAU（日別のアクティブ人数）" data={d.series.map((s) => ({ label: s.day, value: s.active }))} />
            </div>
            <div className="panel">
              <ColumnChart title="新規登録（日別）" data={d.series.map((s) => ({ label: s.day, value: s.newUsers }))} />
            </div>
            <div className="panel">
              <ColumnChart title="対戦数（日別・完了した試合）" data={d.series.map((s) => ({ label: s.day, value: s.matches }))} />
            </div>
            <div className="panel">
              <ColumnChart title="起動回数（日別）" data={d.series.map((s) => ({ label: s.day, value: s.sessions }))} />
            </div>
          </div>
          <div className="tiny muted">
            期間 {d.period.from}〜{d.period.to}（{d.period.days}日）と、その前の同じ長さの期間 {d.previous.from}〜{d.previous.to} を比べています。アクティブ＝その日にゲームを開いた・遊んだプレイヤー。
          </div>
        </div>
      )}
    </div>
  );
}

export const MODE_LABEL: Record<string, string> = { quick: 'クイック', private: 'プライベート', ranked: 'ランク戦', solo: 'ソロ課題', event: 'イベント', collection: 'Collection Draft' };
const TAG_LABEL: Record<string, string> = { founder: 'Founder', beta_tester: 'Beta Tester', friend_tester: 'Friend Tester', developer: 'Developer', normal: 'Normal' };
export const TAGS = Object.keys(TAG_LABEL);
export const tagLabel = (t: string) => TAG_LABEL[t] ?? t;

interface Analytics extends Summary {
  period: Period & { days: number };
  series: Overview['series'];
  modes: { mode: string; n: number }[];
  firstMatch: { registered: number; played: number; rate: number | null };
  churn: { previousActive: number; notReturned: number; rate: number | null };
  retention: Record<string, number | null>;
  options: { platforms: string[]; versions: string[] };
}

export function AnalyticsPage() {
  const [period, setPeriod] = usePeriod(30);
  const [platform, setPlatform] = useState('');
  const [version, setVersion] = useState('');
  const [tag, setTag] = useState('');
  const [noDev, setNoDev, devQs] = useDev();
  const qs = new URLSearchParams({ from: period.from, to: period.to, ...(platform ? { platform } : {}), ...(version ? { version } : {}), ...(tag ? { tag } : {}) });
  const { data: d, error, loading } = useLoad<Analytics>(`/analytics?${qs}${devQs}`);
  return (
    <div>
      <h1>Analytics</h1>
      <PeriodFilter value={period} onChange={setPeriod}>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="プラットフォーム">
          <option value="">全プラットフォーム</option>
          {d?.options.platforms.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={version} onChange={(e) => setVersion(e.target.value)} aria-label="バージョン">
          <option value="">全バージョン</option>
          {d?.options.versions.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
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
      {error && <div className="error">{error}</div>}
      {d && (
        <div style={{ opacity: loading ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="tiles">
            <StatTile label={`DAU（${d.period.to}）`} value={d.dau} />
            <StatTile label="WAU" value={d.wau} />
            <StatTile label="MAU" value={d.mau} />
            <StatTile label="起動回数" value={d.sessions} />
            <StatTile label="平均セッション時間" value={d.avgSessionMs} format={fmtDuration} />
            <StatTile label="対戦回数（完了した試合）" value={d.matches} />
            <StatTile label="初回対戦の完了率" value={d.firstMatch.rate === null ? null : d.firstMatch.rate * 100} format={(n) => `${n.toFixed(1)}%`} sub={`期間中の登録 ${d.firstMatch.registered}人中 ${d.firstMatch.played}人`} />
            <StatTile label="ドラフト完了率" value={d.draftCompletion === null ? null : d.draftCompletion * 100} format={(n) => `${n.toFixed(1)}%`} />
            <StatTile label="試合完了率" value={d.matchCompletion === null ? null : d.matchCompletion * 100} format={(n) => `${n.toFixed(1)}%`} />
            <StatTile label="離脱率" value={d.churn.rate === null ? null : d.churn.rate * 100} format={(n) => `${n.toFixed(1)}%`} sub={`前の期間のアクティブ ${d.churn.previousActive}人のうち、今期は来なかった ${d.churn.notReturned}人`} />
          </div>
          <div className="panel">
            <h3>継続率（期間中の登録者）</h3>
            <table className="tbl">
              <thead>
                <tr>
                  {['1', '3', '7', '14', '30'].map((n) => (
                    <th key={n}>D{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {['1', '3', '7', '14', '30'].map((n) => (
                    <HeatCell key={n} rate={d.retention[n]} />
                  ))}
                </tr>
              </tbody>
            </table>
            <div className="tiny muted">— は対象の日がまだ終わっていない（集計中）</div>
          </div>
          <div className="grid2">
            <div className="panel">
              <ColumnChart title="DAU（日別）" data={d.series.map((s) => ({ label: s.day, value: s.active }))} />
            </div>
            <div className="panel">
              <ColumnChart title="平均プレイ時間（1人1日・分）" data={d.series.map((s) => ({ label: s.day, value: s.active ? Math.round(s.playtimeMs / s.active / 60000) : 0 }))} format={(n) => `${n}分`} />
            </div>
            <div className="panel">
              <BarList title="モード利用率（ルームへの参加回数）" data={d.modes.map((m) => ({ label: MODE_LABEL[m.mode] ?? m.mode, value: m.n }))} />
            </div>
            <div className="panel">
              <ColumnChart title="対戦回数（日別）" data={d.series.map((s) => ({ label: s.day, value: s.matches }))} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface Retention {
  period: Period;
  days: number[];
  cohorts: { day: string; size: number; rates: Record<string, number | null>; counts: Record<string, number | null> }[];
  average: Record<string, number | null>;
  groups: Record<string, Record<string, number | null>> | null;
}

export function RetentionPage() {
  const [period, setPeriod] = usePeriod(45);
  const [tag, setTag] = useState('');
  const [noDev, setNoDev, devQs] = useDev();
  const { data: d, error, loading } = useLoad<Retention>(`/retention?from=${period.from}&to=${period.to}${tag ? `&tag=${tag}` : ''}${devQs}`);
  return (
    <div>
      <h1>Retention</h1>
      <PeriodFilter value={period} onChange={setPeriod}>
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
      {error && <div className="error">{error}</div>}
      {d && (
        <div style={{ opacity: loading ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {d.groups && (
            <div className="panel scroll-x">
              <h3>グループの比較（期間中の登録者の平均）</h3>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>グループ</th>
                    {d.days.map((n) => (
                      <th key={n}>D{n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{tag ? tagLabel(tag) : '全ユーザー'}</td>
                    {d.days.map((n) => (
                      <HeatCell key={n} rate={d.average[n]} />
                    ))}
                  </tr>
                  {Object.entries(d.groups).map(([g, r]) => (
                    <tr key={g}>
                      <td>{tagLabel(g)}</td>
                      {d.days.map((n) => (
                        <HeatCell key={n} rate={r[n]} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="panel scroll-x">
            <h3>登録日ごとのコホート</h3>
            <table className="tbl">
              <thead>
                <tr>
                  <th>登録日</th>
                  <th className="num">人数</th>
                  {d.days.map((n) => (
                    <th key={n}>D{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.cohorts.length === 0 && (
                  <tr>
                    <td colSpan={2 + d.days.length} className="muted">
                      この期間の登録者はいません
                    </td>
                  </tr>
                )}
                {d.cohorts.map((c) => (
                  <tr key={c.day}>
                    <td>{c.day}</td>
                    <td className="num">{c.size}</td>
                    {d.days.map((n) => (
                      <HeatCell key={n} rate={c.rates[n]} count={c.counts[n]} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tiny muted" style={{ marginTop: 6 }}>
              Dn＝登録日（日本時間）の n 日後にゲームを開いた・遊んだ人の割合。— はその日がまだ終わっていない。色が明るいほど高い。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface EconomyData {
  period: Period;
  totals: Record<string, { issued: number; spent: number }>;
  byReason: { currency: string; reason: string; issued: number; spent: number; n: number }[];
  points: { point_type: string; reason: string; issued: number; spent: number }[];
  outstanding: Record<string, number>;
  gacha: { banner_id: string; name: string; draws: number; cards: number; cost_currency: string; cost: number; players: number }[];
  topGemSpenders: { user_id: string; username: string; display_name: string; spent: number }[] | null;
}

const CUR_LABEL: Record<string, string> = { COINS: 'COINS', GEMS_FREE: '無償GEMS', GEMS_PAID_PURCHASED: '有償GEMS（購入）', GEMS_PAID_GRANTED: '有償GEMS（配布）' };
const REASON_LABEL: Record<string, string> = {
  match_reward: '対戦報酬',
  login_bonus: 'ログインボーナス',
  mission: 'ミッション',
  solo_clear: 'ソロ課題',
  event_bonus: 'イベント報酬',
  season_reward: 'シーズン報酬',
  gacha: 'ガシャ',
  test_grant: 'テスト付与',
  distribution: '運営からの配布',
  duplicate: '重複カード',
  redeem: '交換所',
};

/** aggregated economy (spec 12-7) */
export function EconomyInsights() {
  const [period, setPeriod] = usePeriod(30);
  const { data: d, error, loading } = useLoad<EconomyData>(`/economy?from=${period.from}&to=${period.to}`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PeriodFilter value={period} onChange={setPeriod} />
      {error && <div className="error">{error}</div>}
      {d && (
        <div style={{ opacity: loading ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="panel scroll-x">
            <h3>通貨ごとの発行・消費（期間中）と未使用残高（現在）</h3>
            <table className="tbl">
              <thead>
                <tr>
                  <th>通貨</th>
                  <th className="num">発行</th>
                  <th className="num">消費</th>
                  <th className="num">未使用残高</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(d.totals).map(([c, t]) => (
                  <tr key={c}>
                    <td>{CUR_LABEL[c] ?? c}</td>
                    <td className="num">{fmtInt(t.issued)}</td>
                    <td className="num">{fmtInt(t.spent)}</td>
                    <td className="num">{fmtInt(d.outstanding[c] ?? 0)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Standardポイント</td>
                  <td className="num">{fmtInt(d.points.filter((p) => p.point_type === 'standard').reduce((s, p) => s + p.issued, 0))}</td>
                  <td className="num">{fmtInt(d.points.filter((p) => p.point_type === 'standard').reduce((s, p) => s + p.spent, 0))}</td>
                  <td className="num">{fmtInt(d.outstanding.standard_points ?? 0)}</td>
                </tr>
                <tr>
                  <td>Premiumポイント</td>
                  <td className="num">{fmtInt(d.points.filter((p) => p.point_type === 'premium').reduce((s, p) => s + p.issued, 0))}</td>
                  <td className="num">{fmtInt(d.points.filter((p) => p.point_type === 'premium').reduce((s, p) => s + p.spent, 0))}</td>
                  <td className="num">{fmtInt(d.outstanding.premium_points ?? 0)}</td>
                </tr>
              </tbody>
            </table>
            <div className="tiny muted">有償GEMS（購入）の購入は未実装（Phase 6）。装飾・シーズンパスの消費は商品ができてから集計します。</div>
          </div>
          <div className="grid2">
            <div className="panel">
              <BarList title="COINS の発行（理由別）" data={d.byReason.filter((r) => r.currency === 'COINS' && r.issued > 0).map((r) => ({ label: REASON_LABEL[r.reason] ?? r.reason, value: r.issued }))} />
            </div>
            <div className="panel">
              <BarList title="GEMS の発行（理由別・全種類）" data={Object.entries(d.byReason.filter((r) => r.currency !== 'COINS' && r.issued > 0).reduce<Record<string, number>>((m, r) => ((m[r.reason] = (m[r.reason] ?? 0) + r.issued), m), {})).map(([k, v]) => ({ label: REASON_LABEL[k] ?? k, value: v }))} />
            </div>
          </div>
          <div className="panel scroll-x">
            <h3>ガシャ（期間中）</h3>
            <table className="tbl">
              <thead>
                <tr>
                  <th>ガシャ</th>
                  <th className="num">回数（単発・10連）</th>
                  <th className="num">枚数</th>
                  <th className="num">消費</th>
                  <th className="num">人数</th>
                </tr>
              </thead>
              <tbody>
                {d.gacha.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      期間中の抽選はありません
                    </td>
                  </tr>
                )}
                {d.gacha.map((g) => (
                  <tr key={g.banner_id}>
                    <td>{g.name}</td>
                    <td className="num">{fmtInt(g.draws)}</td>
                    <td className="num">{fmtInt(g.cards)}</td>
                    <td className="num">
                      {fmtInt(g.cost)} {g.cost_currency === 'COINS' ? 'COINS' : '有償GEMS'}
                    </td>
                    <td className="num">{fmtInt(g.players)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.topGemSpenders && (
            <div className="panel scroll-x">
              <h3>GEMS の消費が多いプレイヤー（期間中・上位20人）</h3>
              <table className="tbl">
                <tbody>
                  {d.topGemSpenders.length === 0 && (
                    <tr>
                      <td className="muted">期間中の消費はありません</td>
                    </tr>
                  )}
                  {d.topGemSpenders.map((u) => (
                    <tr key={u.user_id}>
                      <td>
                        {u.display_name}（{u.username}）
                      </td>
                      <td className="num">{fmtInt(u.spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="tiny muted">発行・消費は {d.period.from}〜{d.period.to}（日本時間）の合計、未使用残高は現在の値。</div>
        </div>
      )}
    </div>
  );
}
