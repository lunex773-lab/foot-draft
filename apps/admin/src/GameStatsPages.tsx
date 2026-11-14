import { TRAITS } from '@fd/shared';
import { useState } from 'react';
import { BarList, ColumnChart, StatTile, SERIES, fmtInt, fmtPct } from './charts';
import { MODE_LABEL, PeriodFilter, useLoad, usePeriod } from './InsightsPages';

/**
 * Matches and Draft Analytics (spec 12-2, Phase 7): what the SIM balance and
 * the draft look like in real play. Aggregated only.
 */

const dec = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '—' : n.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d }));
const OFFENSE: Record<string, string> = { possession: 'Possession', counter: 'Counter Attack', long_ball: 'Long Ball' };
const DEFENSE: Record<string, string> = { high_press: 'High Press', mid_block: 'Mid Block', low_block: 'Low Block' };
const TRAIT: Record<string, string> = Object.fromEntries(Object.values(TRAITS).map((t) => [t.id, `${t.nameJa}（${t.name}）`]));

/** a rate with a small bar (single hue: magnitude) */
export function RateCell({ rate, n }: { rate: number | null; n?: number }) {
  if (rate === null) return <td className="num muted">—</td>;
  return (
    <td className="num">
      <span className="ratebar" aria-hidden="true">
        <span style={{ width: `${Math.round(rate * 100)}%`, background: SERIES[0] }} />
      </span>
      {fmtPct(rate)}
      {n !== undefined && <span className="tiny muted">（{n}）</span>}
    </td>
  );
}

function ModeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="モード">
      <option value="">全モード</option>
      {Object.entries(MODE_LABEL).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

interface TeamGroup {
  key: string | number | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  xg: number;
  winRate: number | null;
  points: number | null;
}

function GroupTable({ title, rows, label }: { title: string; rows: TeamGroup[]; label?: (k: string) => string }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <div className="small muted">データがありません</div>
      ) : (
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th />
                <th className="num">試合</th>
                <th className="num">勝-分-負</th>
                <th className="num">勝率</th>
                <th className="num">勝点/試合</th>
                <th className="num">得点</th>
                <th className="num">失点</th>
                <th className="num">xG</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.key)}>
                  <td>{r.key === null ? '—' : label ? label(String(r.key)) : String(r.key)}</td>
                  <td className="num">{fmtInt(r.games)}</td>
                  <td className="num">
                    {r.wins}-{r.draws}-{r.losses}
                  </td>
                  <RateCell rate={r.winRate} />
                  <td className="num">{dec(r.points)}</td>
                  <td className="num">{dec(r.goalsFor)}</td>
                  <td className="num">{dec(r.goalsAgainst)}</td>
                  <td className="num">{dec(r.xg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Matches {
  summary: { matches: number; goals: number | null; draws: number | null; margin: number | null; goalless: number | null; homeWins: number | null; maxGoals: number | null };
  teamAverages: Record<string, number | null>;
  goalsDistribution: { goals: number; n: number }[];
  marginDistribution: { margin: number; n: number }[];
  byFormation: TeamGroup[];
  byOffense: TeamGroup[];
  byDefense: TeamGroup[];
  byChemistry: TeamGroup[];
  strengthGap: { gap: string; matches: number; strongerWon: number; draws: number; strongerWinRate: number | null }[];
  goalMinutes: { period: number; goals: number }[];
  traits: { trait: string; apps: number; minutes: number; goals: number; assists: number; rating: number; goalsPer90: number | null }[];
  daily: { day: string; matches: number; goals: number }[];
}

export function MatchesPage() {
  const [period, setPeriod] = usePeriod(14);
  const [mode, setMode] = useState('');
  const [humans, setHumans] = useState(false);
  const { data: d, error, loading } = useLoad<Matches>(`/matches?from=${period.from}&to=${period.to}${mode ? `&mode=${mode}` : ''}${humans ? '&humans=1' : ''}`);
  const t = d?.teamAverages ?? {};
  return (
    <div>
      <h1>Matches</h1>
      <p className="small muted" style={{ marginTop: -6 }}>
        試合の結果と内容（SIM のバランス確認用）。CPU 同士の試合も同じ SIM で計算されるため含めています。
      </p>
      <PeriodFilter value={period} onChange={setPeriod}>
        <ModeSelect value={mode} onChange={setMode} />
        <label className="tiny muted check-inline">
          <input type="checkbox" checked={humans} onChange={(e) => setHumans(e.target.checked)} />
          人が参加した試合だけ
        </label>
      </PeriodFilter>
      {error && <div className="error">{error}</div>}
      {d && (
        <div style={{ opacity: loading ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="tiles">
            <StatTile label="試合数" value={d.summary.matches} />
            <StatTile label="1試合の平均得点" value={d.summary.goals} format={(n) => dec(n)} />
            <StatTile label="引き分け" value={d.summary.draws} format={(n) => fmtPct(n)} />
            <StatTile label="0-0" value={d.summary.goalless} format={(n) => fmtPct(n)} />
            <StatTile label="平均の点差" value={d.summary.margin} format={(n) => dec(n)} sub={`最多得点の試合 ${d.summary.maxGoals ?? '—'}点`} />
            <StatTile label="ホームの勝率" value={d.summary.homeWins} format={(n) => fmtPct(n)} />
          </div>
          <div className="tiles">
            <StatTile label="シュート（1チーム）" value={t.shots} format={(n) => dec(n, 1)} />
            <StatTile label="枠内シュート" value={t.shotsOnTarget} format={(n) => dec(n, 1)} />
            <StatTile label="xG" value={t.xg} format={(n) => dec(n)} sub={`実際の得点 ${dec(t.goals)}`} />
            <StatTile label="パス成功率" value={t.passAccuracy} format={(n) => fmtPct(n)} />
            <StatTile label="支配率の偏り" value={t.possessionSpread} format={(n) => `±${dec(n, 1)}`} sub="50%からの平均の差" />
            <StatTile label="警告・退場" value={t.yellow} format={(n) => dec(n)} sub={`退場 ${dec(t.red)}・ファウル ${dec(t.fouls, 1)}`} />
          </div>
          <div className="grid2">
            <div className="panel">
              <ColumnChart title="1試合の合計得点（試合数）" data={d.goalsDistribution.map((g) => ({ label: g.goals >= 7 ? '7+' : String(g.goals), value: g.n }))} />
            </div>
            <div className="panel">
              <ColumnChart
                title="時間帯ごとの得点（15分ごと）"
                data={[0, 1, 2, 3, 4, 5].map((p) => ({ label: `${p * 15}〜${p * 15 + 15}分`, value: d.goalMinutes.find((g) => g.period === p)?.goals ?? 0 }))}
              />
            </div>
          </div>
          <div className="panel">
            <h3>強いチームの勝率（先発の平均OVRの差）</h3>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>OVR の差</th>
                    <th className="num">試合</th>
                    <th className="num">強い方の勝ち</th>
                    <th className="num">引き分け</th>
                  </tr>
                </thead>
                <tbody>
                  {d.strengthGap.map((g) => (
                    <tr key={g.gap}>
                      <td>{g.gap}</td>
                      <td className="num">{fmtInt(g.matches)}</td>
                      <RateCell rate={g.strongerWinRate} />
                      <td className="num">{fmtPct(g.matches ? g.draws / g.matches : null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tiny muted">差が大きいのに強い方が勝ちすぎる（または勝てない）場合は SIM の調整を検討します。</div>
          </div>
          <div className="grid2">
            <GroupTable title="フォーメーション別" rows={d.byFormation} />
            <GroupTable title="ケミストリー別" rows={d.byChemistry} />
            <GroupTable title="攻撃戦術別" rows={d.byOffense} label={(k) => OFFENSE[k] ?? k} />
            <GroupTable title="守備戦術別" rows={d.byDefense} label={(k) => DEFENSE[k] ?? k} />
          </div>
          <div className="panel">
            <h3>特殊能力別（出場した選手）</h3>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>特殊能力</th>
                    <th className="num">出場</th>
                    <th className="num">得点</th>
                    <th className="num">90分あたりの得点</th>
                    <th className="num">アシスト</th>
                    <th className="num">平均評価</th>
                  </tr>
                </thead>
                <tbody>
                  {d.traits.map((x) => (
                    <tr key={x.trait}>
                      <td>{TRAIT[x.trait] ?? x.trait}</td>
                      <td className="num">{fmtInt(x.apps)}</td>
                      <td className="num">{fmtInt(x.goals)}</td>
                      <td className="num">{dec(x.goalsPer90)}</td>
                      <td className="num">{fmtInt(x.assists)}</td>
                      <td className="num">{dec(x.rating)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tiny muted">1人が複数の特殊能力を持つ時は、それぞれに数えます。「(なし)」は特殊能力のない選手。</div>
          </div>
          <div className="panel">
            <ColumnChart title="試合数（日別）" data={d.daily.map((x) => ({ label: x.day, value: x.matches }))} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- drafts

export interface TimerRow {
  seconds: number;
  drafts: number;
  completed: number;
  completionRate: number | null;
  humanPicks: number;
  autoPicks: number;
  autoRate: number | null;
  players: number;
  avgPickMs: number | null;
  leaguesStarted: number;
  abandoned: number;
  abandonRate: number | null;
  ratings: number;
  draftFun: number | null;
  resultFair: number | null;
}

/** pick time comparison (decision 66) */
export function TimerTable({ rows }: { rows: TimerRow[] }) {
  if (rows.length === 0) return <div className="small muted">対象のドラフトはまだありません（クイックドラフト・ランク戦・Collection Draft）</div>;
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th>制限時間</th>
            <th className="num">ドラフト</th>
            <th className="num">完了率</th>
            <th className="num">人の指名</th>
            <th className="num">時間切れ（自動指名）</th>
            <th className="num">平均の指名時間</th>
            <th className="num">途中で離れた</th>
            <th className="num">評価（ドラフト）</th>
            <th className="num">評価（納得感）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seconds}>
              <td>{r.seconds}秒</td>
              <td className="num">{fmtInt(r.drafts)}</td>
              <RateCell rate={r.completionRate} />
              <td className="num">{fmtInt(r.humanPicks)}</td>
              <RateCell rate={r.autoRate} n={r.autoPicks} />
              <td className="num">{r.avgPickMs === null ? '—' : `${(r.avgPickMs / 1000).toFixed(1)}秒`}</td>
              <RateCell rate={r.abandonRate} n={r.abandoned} />
              <td className="num">{r.draftFun === null ? '—' : `${dec(r.draftFun, 1)}（${r.ratings}）`}</td>
              <td className="num">{r.resultFair === null ? '—' : dec(r.resultFair, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Drafts {
  summary: { drafts: number; completed: number; completionRate: number | null; picks: number; humanPicks: number; humanAutoPicks: number; humanAutoRate: number | null };
  rounds: Record<string, number>[];
  earliest: { id: string; name: string; rarity: string; position: string; ovr: number; picked: number; avgPick: number; offered: number; pickRate: number | null }[];
  ignored: { id: string; name: string; rarity: string; position: string; ovr: number; offered: number; picked: number; pickRate: number | null }[];
  ranks: { who: 'human' | 'cpu'; seats: number; avgRank: number; firstRate: number | null }[];
  timer: TimerRow[];
}

const RARITY: Record<string, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', icon: 'Icon' };

function CardTable({ rows, title, note }: { rows: Drafts['earliest'] | Drafts['ignored']; title: string; note: string }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <div className="small muted">データがありません</div>
      ) : (
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>選手</th>
                <th>ポジション</th>
                <th className="num">OVR</th>
                <th className="num">候補に出た</th>
                <th className="num">指名率</th>
                {'avgPick' in rows[0] && <th className="num">平均の指名順</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name} <span className="tiny muted">{RARITY[r.rarity]}</span>
                  </td>
                  <td>{r.position}</td>
                  <td className="num">{r.ovr}</td>
                  <td className="num">{fmtInt(r.offered)}</td>
                  <RateCell rate={r.pickRate} n={r.picked} />
                  {'avgPick' in r && <td className="num">{dec((r as Drafts['earliest'][number]).avgPick, 1)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="tiny muted">{note}</div>
    </div>
  );
}

export function DraftAnalyticsPage() {
  const [period, setPeriod] = usePeriod(14);
  const [mode, setMode] = useState('');
  const { data: d, error, loading } = useLoad<Drafts>(`/drafts?from=${period.from}&to=${period.to}${mode ? `&mode=${mode}` : ''}`);
  return (
    <div>
      <h1>Draft Analytics</h1>
      <PeriodFilter value={period} onChange={setPeriod}>
        <ModeSelect value={mode} onChange={setMode} />
      </PeriodFilter>
      {error && <div className="error">{error}</div>}
      {d && (
        <div style={{ opacity: loading ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="tiles">
            <StatTile label="ドラフト" value={d.summary.drafts} sub={`完了 ${fmtInt(d.summary.completed)}`} />
            <StatTile label="ドラフト完了率" value={d.summary.completionRate} format={(n) => fmtPct(n)} />
            <StatTile label="人の指名" value={d.summary.humanPicks} sub={`全体 ${fmtInt(d.summary.picks)}（CPU を含む）`} />
            <StatTile label="時間切れ（人の指名のうち）" value={d.summary.humanAutoRate} format={(n) => fmtPct(n)} upIsGood={false} sub={`${fmtInt(d.summary.humanAutoPicks)}回`} />
            {d.ranks.map((r) => (
              <StatTile key={r.who} label={r.who === 'human' ? '人の平均順位' : 'CPU の平均順位'} value={r.avgRank} format={(n) => `${dec(n)}位`} sub={`1位 ${fmtPct(r.firstRate)}・${fmtInt(r.seats)}席`} />
            ))}
          </div>
          <div className="panel">
            <h3>制限時間の比較（決定 66）</h3>
            <TimerTable rows={d.timer} />
          </div>
          <div className="grid2">
            <div className="panel">
              <ColumnChart title="指名順ごとの平均 OVR（1巡目〜14巡目）" data={d.rounds.map((r) => ({ label: `${r.round}巡`, value: Math.round((r.ovr ?? 0) * 10) / 10 }))} format={(n) => dec(n, 1)} />
            </div>
            <div className="panel">
              <BarList
                title="1〜3巡目に指名されたポジション"
                data={(['gk', 'df', 'mf', 'fw'] as const).map((k) => ({ label: k.toUpperCase(), value: d.rounds.filter((r) => r.round <= 3).reduce((s, r) => s + (r[k] ?? 0), 0) }))}
              />
            </div>
          </div>
          <div className="panel">
            <h3>巡ごとの内訳</h3>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>巡</th>
                    <th className="num">平均 OVR</th>
                    <th className="num">人</th>
                    <th className="num">CPU</th>
                    <th className="num">GK</th>
                    <th className="num">DF</th>
                    <th className="num">MF</th>
                    <th className="num">FW</th>
                    <th className="num">Rare 以上</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rounds.map((r) => (
                    <tr key={r.round}>
                      <td>{r.round}</td>
                      <td className="num">{dec(r.ovr, 1)}</td>
                      <td className="num">{dec(r.humanOvr, 1)}</td>
                      <td className="num">{dec(r.cpuOvr, 1)}</td>
                      <td className="num">{r.gk}</td>
                      <td className="num">{r.df}</td>
                      <td className="num">{r.mf}</td>
                      <td className="num">{r.fw}</td>
                      <td className="num">{fmtPct(r.picks ? (r.rare + r.epic + r.legendary + r.icon) / r.picks : null, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid2">
            <CardTable title="早く指名される選手" rows={d.earliest} note="3回以上指名された選手を、平均の指名順が早い順に。" />
            <CardTable title="候補に出ても指名されにくい選手" rows={d.ignored} note="完了したドラフトで5回以上候補に出た選手を、指名率が低い順に。" />
          </div>
        </div>
      )}
    </div>
  );
}
