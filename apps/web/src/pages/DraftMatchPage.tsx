import {
  DEFAULT_TACTICS,
  DRAFT_MATCH_CONFIG,
  FORMATIONS,
  FORMATION_IDS,
  TACTIC_FIELD_LABELS_JA,
  TACTIC_LABELS_JA,
  computeChemistry,
  groupNeeds,
  groupOf,
  lineupStrength,
  validateDraftMatchPick,
  type DmSeat,
  type DraftMatchClientMessage,
  type DraftMatchSnapshot,
  type FormationId,
  type Lineup,
  type Player,
  type PositionGroup,
  type RoomSnapshot,
  type Tactics,
} from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bowl, HAND_TONE } from '../components/Chinchiro';
import { Countdown } from '../components/Countdown';
import { MatchDetailModal } from '../components/MatchDetailModal';
import { PitchEditor } from '../components/PitchEditor';
import { PlayerRow } from '../components/PlayerRow';
import { Standings } from '../components/Standings';
import { TierBadge } from '../components/TierBadge';
import { api } from '../lib/api';
import { errorText, seatColor, signed } from '../lib/labels';
import { useDraftMatch } from '../lib/useDraftMatch';
import { useNow } from '../lib/useNow';
import { Playing } from './room/Playing';
import { Rewards } from './room/Final';
import { playResult, sound } from '../sound/player';

type Send = (m: DraftMatchClientMessage) => void;
const GROUPS: PositionGroup[] = ['GK', 'DF', 'MF', 'FW'];

/** the room shape the shared match / standings components read */
function asRoom(s: DraftMatchSnapshot): RoomSnapshot {
  return {
    roomId: s.roomId,
    code: '',
    mode: 'draft_match',
    variant: { kind: 'standard' },
    phase: s.status === 'SIMULATION' ? 'playing' : s.status === 'COMPLETED' || s.status === 'RESULT' ? 'finished' : 'lineup',
    settings: { pickSeconds: DRAFT_MATCH_CONFIG.pickSeconds, fillWithCpu: false },
    seats: s.seats.map((x) => ({ seat: x.seat, userId: x.userId, displayName: x.displayName, isCpu: false, connected: x.connected, isHost: false, member: x.member })),
    lobbyDeadline: null,
    serverNow: s.serverNow,
    you: s.you,
    draft: null,
    rosters: s.rosters,
    lineups: s.lineups,
    lineupReady: s.lineupReady,
    matchday: s.matchday,
    phaseDeadline: s.deadline,
    fixtures: s.fixtures,
    live: s.live,
    standings: s.standings,
    finalRanks: s.finalRanks,
    outcome: s.outcome ? { rewards: s.outcome.rewards } : null,
  };
}

const STEPS: { label: string; states: DraftMatchSnapshot['status'][] }[] = [
  { label: 'マッチ', states: ['WAITING', 'MATCHING'] },
  { label: '布陣', states: ['FORMATION_SELECTION', 'POOL_GENERATION'] },
  { label: 'チンチロ', states: ['CHINCHIRO', 'DRAFT_ORDER'] },
  { label: 'ドラフト', states: ['PLAYER_DRAFT'] },
  { label: '試合', states: ['TEAM_CONFIRMATION', 'SIMULATION'] },
  { label: '結果', states: ['RESULT', 'COMPLETED'] },
];

function Steps({ status }: { status: DraftMatchSnapshot['status'] }) {
  const at = STEPS.findIndex((s) => s.states.includes(status));
  return (
    <ol className="dm-steps" aria-label="進行">
      {STEPS.map((s, i) => (
        <li key={s.label} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/** DRAFT MATCH room (official spec v2.0): every step of the state machine */
export default function DraftMatchPage() {
  const { roomId = '' } = useParams();
  const nav = useNavigate();
  const { snap, players, conn, error, send, serverNow } = useDraftMatch(roomId);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    setToast(errorText(error.code, error.message));
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [error]);
  const leave = async () => {
    await api(`/api/draft-match/${roomId}/leave`, { body: {} }).catch(() => undefined);
    nav('/');
  };
  if (error?.code === 'NOT_MEMBER') return <div className="panel error">このルームには参加していません。</div>;
  if (!snap) return <div className="muted">ルームに接続しています…</div>;
  const st = snap.status;
  return (
    <div className="dm-room">
      {conn !== 'open' && <div className="error">{conn === 'reconnecting' ? '接続が切れました。再接続しています…（時間切れはサーバーが自動で進めます）' : '接続していません'}</div>}
      <div className="dm-head">
        <span className="chip on">DRAFT MATCH</span>
        <Steps status={st} />
      </div>
      {(st === 'WAITING' || st === 'MATCHING') && <Matching snap={snap} serverNow={serverNow} onLeave={leave} />}
      {(st === 'FORMATION_SELECTION' || st === 'POOL_GENERATION') && <FormationSelect snap={snap} send={send} serverNow={serverNow} />}
      {(st === 'CHINCHIRO' || st === 'DRAFT_ORDER') && <ChinchiroStage snap={snap} send={send} serverNow={serverNow} />}
      {st === 'PLAYER_DRAFT' && <DmDraft snap={snap} players={players} send={send} serverNow={serverNow} />}
      {st === 'TEAM_CONFIRMATION' && <TeamConfirm snap={snap} players={players} send={send} serverNow={serverNow} />}
      {st === 'SIMULATION' && <Playing snap={asRoom(snap)} players={players} serverNow={serverNow} />}
      {(st === 'RESULT' || st === 'COMPLETED') && <Result snap={snap} />}
      {st === 'CANCELLED' && (
        <div className="panel">
          このルームは閉じられました。<Link to="/">ホームへ</Link>
        </div>
      )}
      {toast && <div className="toast error">{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- matching

function Matching({ snap, serverNow, onLeave }: { snap: DraftMatchSnapshot; serverNow: () => number; onLeave: () => void }) {
  const n = snap.seats.length;
  return (
    <div className="grid2">
      <div className="panel">
        <h2>{snap.status === 'MATCHING' ? `${n}人そろいました` : '対戦相手を探しています…'}</h2>
        <div className="spread small muted">
          <span>{snap.status === 'MATCHING' ? 'まもなく開始します（4人そろうとすぐに開始）' : 'あと1人以上そろうと開始します（2〜4人）'}</span>
          {snap.status === 'MATCHING' && <Countdown deadline={snap.deadline} serverNow={serverNow} warnAt={5} />}
        </div>
        <div className="seats" style={{ marginTop: 14 }}>
          {Array.from({ length: DRAFT_MATCH_CONFIG.maxPlayers }, (_, i) => snap.seats[i]).map((s, i) =>
            s ? (
              <div key={i} className="seat" style={{ borderColor: seatColor(s.seat) }}>
                <div className="name">
                  {s.member && <span className="member-badge">★</span>}
                  {s.displayName}
                </div>
                <div className="tiny muted row">
                  <span className={`dot ${s.connected ? 'on' : ''}`} /> {s.connected ? '接続中' : '未接続'}
                  {s.seat === snap.you && <span className="chip on">あなた</span>}
                </div>
              </div>
            ) : (
              <div key={i} className="seat">
                <div className="muted small">待機中…</div>
              </div>
            ),
          )}
        </div>
      </div>
      <div className="panel">
        <h2>ルール</h2>
        <ul className="small muted rules">
          <li>2〜4人。全員に同じカードプールが表示されます（持っているカード・強化は使いません）</li>
          <li>フォーメーションを選ぶ → チンチロで指名順を決める → スネークドラフトで11人ずつ指名（1人{DRAFT_MATCH_CONFIG.pickSeconds}秒、時間切れは足りないポジションから自動指名）</li>
          <li>全員と1試合ずつの総当たり。順位で DRAFT MATCH のランキング（レート）と COINS が決まります</li>
          <li>開始後に抜けても、席はサーバーが自動で操作します</li>
        </ul>
        <button className="btn ghost danger small" onClick={onLeave}>
          探すのをやめる
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- formations

function MiniPitch({ formation }: { formation: FormationId }) {
  return (
    <svg viewBox="0 0 68 100" className="mini-pitch" aria-hidden="true">
      <rect x="1" y="1" width="66" height="98" rx="3" fill="#18432c" stroke="#3d7a52" />
      <line x1="1" y1="50" x2="67" y2="50" stroke="#3d7a52" />
      {FORMATIONS[formation].slots.map((s) => (
        <circle key={s.id} cx={2 + (s.x / 100) * 64} cy={96 - s.y * 0.9} r="3.6" fill="#e5ff00" />
      ))}
    </svg>
  );
}

function FormationSelect({ snap, send, serverNow }: { snap: DraftMatchSnapshot; send: Send; serverNow: () => number }) {
  const me = snap.seats.find((s) => s.seat === snap.you);
  const [chosen, setChosen] = useState<FormationId | null>(me?.formation ?? null);
  const choose = (f: FormationId) => {
    setChosen(f);
    send({ type: 'formation', formation: f });
  };
  return (
    <div className="screen">
      <div className={`turn-banner ${chosen ? '' : 'mine'}`}>
        <div className="spread">
          <div>
            <div className="display" style={{ fontSize: 18 }}>
              フォーメーションを選んでください
            </div>
            <div className="tiny muted">このフォーメーションに必要なポジションの選手を指名します（時間切れは 4-3-3）。ほかの人の選択は全員が決めた後に公開されます。</div>
          </div>
          <Countdown deadline={snap.deadline} serverNow={serverNow} warnAt={5} />
        </div>
        <div className="row tiny" style={{ marginTop: 8 }}>
          {snap.seats.map((s) => (
            <span key={s.seat} className={`chip ${s.formationChosen ? 'on' : ''}`} style={{ borderColor: seatColor(s.seat) }}>
              {s.displayName} {s.formationChosen ? '選択済み' : '選択中…'}
            </span>
          ))}
        </div>
      </div>
      <div className="formation-grid">
        {FORMATION_IDS.map((f) => {
          const n = groupNeeds(f);
          return (
            <button key={f} className={`formation-card ${chosen === f ? 'on' : ''}`} onClick={() => choose(f)} aria-pressed={chosen === f}>
              <MiniPitch formation={f} />
              <b>{f}</b>
              <span className="tiny muted">
                GK{n.GK}・DF{n.DF}・MF{n.MF}・FW{n.FW}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- チンチロ

function ChinchiroStage({ snap, send, serverNow }: { snap: DraftMatchSnapshot; send: Send; serverNow: () => number }) {
  useNow(250);
  const c = snap.chinchiro!;
  const cur = c.current;
  const you = snap.you;
  const [tapped, setTapped] = useState<string | null>(null);
  const stepKey = cur ? `${cur.round}:${cur.throwNo}` : null;
  const canThrow = !!cur && you !== null && cur.seats.includes(you) && !cur.thrown.includes(you) && tapped !== stepKey;
  const round = c.rounds[c.rounds.length - 1];
  const rematch = !!round?.rematch;
  // the newest throw of each seat (its own last round)
  const lastOf = (seat: number) => {
    for (let r = c.rounds.length - 1; r >= 0; r--) {
      const t = c.rounds[r].throws[seat];
      if (t?.length) return { t: t[t.length - 1], key: `${snap.roomId}:${c.rounds[r].no}:${t.length}:${seat}` };
    }
    return null;
  };
  const size = snap.seats.length <= 2 ? 170 : 150;
  const order = snap.draftPositions;
  const decided = c.groups.filter((g) => g.length === 1).length;
  return (
    <div className="screen">
      <div className={`turn-banner ${canThrow ? 'mine' : ''}`}>
        <div className="spread">
          <div>
            <div className="display" style={{ fontSize: 18 }}>
              {order ? '指名順が決まりました' : rematch ? `再勝負（${round.seats.map((s) => snap.seats[s]?.displayName).join('・')}）` : 'チンチロで指名順を決めます'}
            </div>
            <div className="tiny muted">
              {order
                ? 'まもなくドラフトが始まります'
                : cur
                  ? `${cur.throwNo}投目（最大3投・役が出たら確定）`
                  : 'サイコロの結果を表示しています…'}
            </div>
          </div>
          <Countdown deadline={order ? snap.deadline : cur?.deadline ?? null} serverNow={serverNow} warnAt={3} tick={canThrow} />
        </div>
      </div>

      {!order && (
        <div className="throw-bar">
          {canThrow ? (
            <button
              className="btn primary throw-btn"
              onClick={() => {
                setTapped(stepKey);
                send({ type: 'throw' });
              }}
            >
              サイコロを振る
            </button>
          ) : (
            <span className="small muted">{cur && you !== null && cur.seats.includes(you) ? '全員が振るのを待っています…' : cur ? 'ほかの人が振っています…' : ''}</span>
          )}
        </div>
      )}

      <div className={`bowls n${snap.seats.length}`}>
        {snap.seats.map((s) => {
          const last = lastOf(s.seat);
          // a player who throws now: the cup is down (shaking once tapped); otherwise the newest dice
          const inStep = !!cur && cur.seats.includes(s.seat);
          const shaking = inStep && (cur!.thrown.includes(s.seat) || (s.seat === you && tapped === stepKey));
          return <Bowl key={s.seat} name={s.displayName} color={seatColor(s.seat)} last={inStep ? null : last?.t ?? null} animateKey={!inStep && last ? last.key : null} shaking={shaking} size={size} you={s.seat === you} />;
        })}
      </div>

      <div className="panel">
        <h3>{order ? '指名順' : `結果（決定 ${decided}/${snap.seats.length}）`}</h3>
        <div className="list">
          {(order ? order.map((s) => [s]) : c.groups).map((g, i) => (
            <div key={i} className="list-item">
              <span>
                <b className="display">
                  {order
                    ? `${i + 1}番目`
                    : g.length === 1
                      ? `${c.groups.slice(0, i).reduce((n, x) => n + x.length, 0) + 1}位`
                      : round && round.seats.length === g.length && g.every((x) => round.seats.includes(x))
                        ? rematch
                          ? '再勝負中'
                          : '振っています'
                        : '同じ結果 → 再勝負'}
                </b>{' '}
                {g.map((seat) => (
                  <span key={seat} style={{ color: seatColor(seat), marginRight: 8 }}>
                    {snap.seats[seat]?.displayName}
                  </span>
                ))}
              </span>
              <span className="row tiny">
                {g.map((seat) => {
                  const l = lastOf(seat);
                  return l ? (
                    <span key={seat} className={`chip tone-${HAND_TONE[l.t.hand.kind]}`}>
                      {l.t.dice.join('-')} {l.t.hand.labelJa}
                      {l.t.auto ? '（自動）' : ''}
                    </span>
                  ) : null;
                })}
              </span>
            </div>
          ))}
        </div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          役の強さ：ピンゾロ ＞ シゴロ ＞ ゾロ目 ＞ 通常役（出目が大きいほど強い）＞ ヒフミ ＞ 役なし。完全に同じ結果は再勝負。出目と順位はサーバーが決めます。
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- draft

function DmDraft({ snap, players, send, serverNow }: { snap: DraftMatchSnapshot; players: Map<string, Player>; send: Send; serverNow: () => number }) {
  const d = snap.draft!;
  const pool = snap.pool ?? [];
  const you = snap.you;
  const me = snap.seats.find((s) => s.seat === you);
  const [filter, setFilter] = useState<'OK' | 'ALL' | PositionGroup>('OK');
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<number | null>(null);
  const myTurn = d.currentSeat === you;
  const takenBy = useMemo(() => new Map(d.picks.map((p) => [p.playerId, p.seat])), [d.picks]);
  const draftState = { order: d.order, picks: d.picks, pool };
  const formation = me?.formation as FormationId | undefined;
  const canPick = (id: string) => you !== null && !!formation && validateDraftMatchPick({ ...draftState, order: d.order.map((s, i) => (i === d.picks.length ? you : s)) }, you, id, formation, players) === null;
  const need = formation ? groupNeeds(formation) : null;
  const mine = d.picks.filter((p) => p.seat === you).map((p) => players.get(p.playerId)!).filter(Boolean);
  const have = Object.fromEntries(GROUPS.map((g) => [g, mine.filter((p) => groupOf(p) === g).length])) as Record<PositionGroup, number>;
  const n = snap.seats.length;
  const pickNo = d.picks.length + 1;
  const total = d.order.length;
  const myNext = d.order.findIndex((s, i) => i >= d.picks.length && s === you);
  const list = pool
    .map((id) => players.get(id)!)
    .filter(Boolean)
    .filter((p) => (filter === 'OK' ? !takenBy.has(p.id) && canPick(p.id) : filter === 'ALL' ? true : groupOf(p) === filter))
    .sort((a, b) => Number(takenBy.has(a.id)) - Number(takenBy.has(b.id)) || b.ovr - a.ovr || a.id.localeCompare(b.id));
  const sel = selected ? players.get(selected) : null;
  const pick = (id: string) => {
    if (!myTurn || takenBy.has(id) || !canPick(id)) return;
    send({ type: 'pick', playerId: id });
    sound.play('pick');
    setSelected(null);
  };
  const viewSeat = view ?? you ?? 0;
  const viewSeatInfo = snap.seats.find((s) => s.seat === viewSeat);
  const viewRoster = d.picks.filter((p) => p.seat === viewSeat).map((p) => players.get(p.playerId)!).filter(Boolean);
  return (
    <div>
      <div className={`turn-banner ${myTurn ? 'mine' : ''}`}>
        <div className="spread">
          <div>
            <div className="display" style={{ fontSize: 18 }}>
              {d.currentSeat === null ? 'ドラフト終了' : myTurn ? 'あなたの指名です' : `${snap.seats.find((s) => s.seat === d.currentSeat)?.displayName} が指名中…`}
            </div>
            <div className="tiny muted">
              {Math.min(pickNo, total)} / {total} ピック・ラウンド {Math.min(DRAFT_MATCH_CONFIG.picksPerPlayer, Math.ceil(pickNo / n))}
              {!myTurn && myNext >= 0 && `・あなたの番まであと ${myNext - d.picks.length} ピック`}
            </div>
            {need && (
              <div className="row tiny" style={{ marginTop: 4 }}>
                <span className="chip on">{formation}</span>
                {GROUPS.map((g) => (
                  <span key={g} className={`chip ${have[g] >= need[g] ? '' : 'need'}`}>
                    {g} {have[g]}/{need[g]}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Countdown deadline={d.deadline} serverNow={serverNow} warnAt={5} tick={myTurn} />
        </div>
        <div className="order-strip" style={{ marginTop: 8 }}>
          {d.order.map((seat, i) => (
            <div key={i} className={`o ${i < d.picks.length ? 'done' : ''} ${i === d.picks.length ? 'now' : ''}`} style={{ background: seatColor(seat) }} title={snap.seats.find((s) => s.seat === seat)?.displayName}>
              {i % n === 0 ? Math.floor(i / n) + 1 : ''}
            </div>
          ))}
        </div>
        {sel && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="small">
              選択中：<b>{sel.name}</b>（{sel.primaryPosition} {sel.ovr}）
            </span>
            <button className="btn primary small" data-sfx="none" disabled={!myTurn || takenBy.has(sel.id) || !canPick(sel.id)} onClick={() => pick(sel.id)}>
              指名する
            </button>
            <button className="btn small ghost" onClick={() => setSelected(null)}>
              取消
            </button>
          </div>
        )}
      </div>
      <div className="draft-layout">
        <div>
          <div className="tabs" style={{ marginBottom: 10 }}>
            {(['OK', 'ALL', ...GROUPS] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'OK' ? '指名できる選手' : f === 'ALL' ? 'すべて' : f}
              </button>
            ))}
          </div>
          <div className="pool">
            {list.map((p) => {
              const by = takenBy.get(p.id);
              const blocked = by === undefined && !canPick(p.id);
              return (
                <div className="slot" key={p.id} onDoubleClick={() => pick(p.id)}>
                  <PlayerCard player={p} width="100%" disabled={by !== undefined || blocked} selected={selected === p.id} onClick={() => by === undefined && !blocked && setSelected(p.id)} />
                  {by !== undefined && (
                    <span className="taken" style={{ color: seatColor(by) }}>
                      {snap.seats.find((s) => s.seat === by)?.displayName}
                    </span>
                  )}
                  {blocked && <span className="reserved-tag">{groupOf(p)} は埋まっています</span>}
                </div>
              );
            })}
            {list.length === 0 && <div className="muted small">該当する選手はいません</div>}
          </div>
        </div>
        <div className="panel" style={{ position: 'sticky', top: 12 }}>
          <div className="tabs" style={{ marginBottom: 10 }}>
            {snap.seats.map((s) => (
              <button key={s.seat} className={viewSeat === s.seat ? 'on' : ''} onClick={() => setView(s.seat)} style={{ borderColor: viewSeat === s.seat ? seatColor(s.seat) : undefined }}>
                {s.seat === you ? 'あなた' : s.displayName}
              </button>
            ))}
          </div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            {viewSeatInfo?.formation} ・ {viewRoster.length}/{DRAFT_MATCH_CONFIG.picksPerPlayer}人
          </div>
          <div className="plist">
            {viewRoster
              .slice()
              .sort((a, b) => GROUPS.indexOf(groupOf(a)) - GROUPS.indexOf(groupOf(b)) || b.ovr - a.ovr)
              .map((p) => (
                <PlayerRow key={p.id} player={p} />
              ))}
            {viewRoster.length === 0 && <div className="muted small">まだ指名がありません</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- team confirmation

function TeamConfirm({ snap, players, send, serverNow }: { snap: DraftMatchSnapshot; players: Map<string, Player>; send: Send; serverNow: () => number }) {
  const you = snap.you!;
  const roster = useMemo(() => (snap.rosters[you] ?? []).map((id) => players.get(id)!).filter(Boolean), [snap.rosters, you, players]);
  const server = snap.lineups[you];
  const [lineup, setLineup] = useState<Lineup | null>(server ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = !!snap.lineupReady[you];
  const md = snap.matchday;
  useEffect(() => {
    setLineup(server ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md, roster.length]);
  if (!lineup) return <div className="muted">読み込み中…</div>;
  const update = (l: Lineup) => {
    setLineup(l);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => send({ type: 'lineup', lineup: l, ready: false }), 350);
  };
  const byId = new Map(roster.map((p) => [p.id, p]));
  const chem = computeChemistry(lineup.starters.map((id) => byId.get(id)), lineup.formation, lineup.tactics);
  const fixture = snap.fixtures.find((f) => f.matchday === md && (f.homeSeat === you || f.awaySeat === you));
  const opp = fixture ? (fixture.homeSeat === you ? fixture.awaySeat : fixture.homeSeat) : null;
  const setTactic = <K extends keyof Tactics>(k: K, v: Tactics[K]) => update({ ...lineup, tactics: { ...lineup.tactics, [k]: v } });
  return (
    <div>
      <div className={`turn-banner ${ready ? '' : 'mine'}`}>
        <div className="spread">
          <div>
            <div className="display" style={{ fontSize: 18 }}>
              {md === 1 ? 'チーム確認' : `第${md}節の準備`} — 対戦相手：
              <span style={{ color: opp !== null ? seatColor(opp) : undefined }}>{opp !== null ? snap.seats.find((s) => s.seat === opp)?.displayName : 'この節はお休み'}</span>
            </div>
            <div className="tiny muted">配置と戦術を変えられます（フォーメーションは {lineup.formation} のまま・控えなし）</div>
          </div>
          <div className="row">
            <Countdown deadline={snap.deadline} serverNow={serverNow} warnAt={5} />
            <button
              className={`btn ${ready ? '' : 'primary'}`}
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                send({ type: 'lineup', lineup, ready: !ready });
              }}
            >
              {ready ? '準備完了を取り消す' : '準備完了'}
            </button>
          </div>
        </div>
      </div>
      <div className="lineup-layout">
        <div className="panel">
          <PitchEditor roster={roster} lineup={lineup} onChange={update} />
        </div>
        <div className="stack">
          <div className="panel">
            <div className="grid2">
              <div>
                <div className="small muted">チーム力</div>
                <div className="display" style={{ fontSize: 30 }}>
                  {lineupStrength(lineup, byId)}
                </div>
              </div>
              <div>
                <div className="small muted">ケミストリー</div>
                <div className="display" style={{ fontSize: 30 }}>
                  {chem.score}
                </div>
                <div className="meter">
                  <div style={{ width: `${chem.score}%` }} />
                </div>
              </div>
            </div>
          </div>
          <div className="panel">
            <h3>戦術</h3>
            <div className="tactics">
              {(Object.keys(TACTIC_LABELS_JA) as (keyof Tactics)[]).map((k) => (
                <label key={k} className="field">
                  {TACTIC_FIELD_LABELS_JA[k]}
                  <select value={lineup.tactics[k]} onChange={(e) => setTactic(k, e.target.value as never)}>
                    {Object.entries(TACTIC_LABELS_JA[k]).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button className="btn small ghost" style={{ marginTop: 10 }} onClick={() => update({ ...lineup, tactics: { ...DEFAULT_TACTICS } })}>
              戦術を初期値に戻す
            </button>
          </div>
          {snap.results.length > 0 && (
            <div className="panel">
              <h3>順位表</h3>
              <Standings rows={snap.standings} seats={asRoom(snap).seats} you={you} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- result

function Result({ snap }: { snap: DraftMatchSnapshot }) {
  const nav = useNavigate();
  const [detail, setDetail] = useState<string | null>(null);
  const you = snap.you;
  const myRank = you !== null ? snap.finalRanks?.[you] : undefined;
  const change = you !== null ? snap.outcome?.ranking?.changes[you] : undefined;
  useEffect(() => {
    if (myRank) playResult(myRank, snap.seats.length);
    // once when the final rank is known
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRank]);
  const again = async () => {
    const r = await api<{ roomId: string }>('/api/draft-match/queue', { body: {} }).catch(() => null);
    if (r) nav(`/draft/${r.roomId}`);
  };
  const room = asRoom(snap);
  const name = (seat: number) => snap.seats.find((s: DmSeat) => s.seat === seat)?.displayName;
  return (
    <div className="screen">
      <div className="panel" style={{ textAlign: 'center' }}>
        <div className="muted">最終順位（{snap.seats.length}人）</div>
        <div className={`display rank-${myRank}`} style={{ fontSize: 64, lineHeight: 1.1 }}>
          {myRank ? `${myRank}位` : '-'}
        </div>
        {snap.status === 'RESULT' && <div className="small muted">ランキングと報酬を集計しています…</div>}
        {change && (
          <div className="result-box">
            <div className="small muted">DRAFT MATCH ランキング</div>
            <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
              <span className="muted">{change.before}</span>→<TierBadge rating={change.after} size="large" />
              <b className={`display ${change.delta >= 0 ? 'delta-up' : 'delta-down'}`} style={{ fontSize: 26 }}>
                {signed(change.delta)}
              </b>
            </div>
          </div>
        )}
        <Rewards snap={room} />
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          {snap.standings.map((r) => (
            <span key={r.seat} className="chip" style={{ borderColor: seatColor(r.seat) }}>
              {r.rank}位 {name(r.seat)}（{r.points}点）
            </span>
          ))}
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>順位表</h3>
          <Standings rows={snap.standings} seats={room.seats} you={you} />
        </div>
        <div className="panel">
          <h3>全試合</h3>
          {snap.fixtures.map((f) => (
            <div key={f.matchId} className="spread small" style={{ padding: '4px 0' }}>
              <span>
                第{f.matchday}節　{name(f.homeSeat)} <b className="display">{f.homeGoals} - {f.awayGoals}</b> {name(f.awaySeat)}
              </span>
              <button className="btn small ghost" onClick={() => setDetail(f.matchId)}>
                詳細
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="button-row center">
        <button className="btn primary" onClick={again}>
          もう一度 DRAFT MATCH
        </button>
        <Link className="btn" to="/ranking">
          ランキング
        </Link>
        <Link className="btn ghost" to="/">
          ホームへ
        </Link>
      </div>
      {detail && <MatchDetailModal matchId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
