import { FORMATIONS, type MatchEvent, type MatchResultData, type Player, type TrackPoint } from '@fd/shared';
import { useEffect, useMemo, useRef } from 'react';
import { CHANCE_LABEL, EVENT_LABEL } from '../lib/labels';
import { sound } from '../sound/player';

/**
 * 2D tactical board + event log (spec 6-6). The match is fully computed on
 * the server; this component replays it for a given match minute.
 */
export interface Team {
  name: string;
  color: string;
}

function ballAt(track: TrackPoint[], minute: number): { x: number; y: number; s: 0 | 1 } {
  if (track.length === 0) return { x: 50, y: 50, s: 0 };
  let lo = 0;
  let hi = track.length - 1;
  if (minute <= track[0].t) return track[0];
  if (minute >= track[hi].t) return track[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= minute) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  const f = b.t === a.t ? 1 : (minute - a.t) / (b.t - a.t);
  const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, s: f < 0.5 ? a.s : b.s };
}

export function scoreAt(events: MatchEvent[], minute: number): [number, number] {
  let h = 0;
  let a = 0;
  for (const e of events) {
    if (e.minute > minute) break;
    if (e.type === 'goal') {
      if (e.side === 'home') h++;
      else a++;
    }
  }
  return [h, a];
}

export function MatchBoard({ result, minute, home, away }: { result: MatchResultData; minute: number; home: Team; away: Team }) {
  const ball = ballAt(result.track, minute);
  // board: x axis = pitch length (home attacks right), y axis = width
  const bx = ball.y;
  const by = ball.x;
  const lastGoal = [...result.events].reverse().find((e) => e.type === 'goal' && e.minute <= minute && minute - e.minute < 2.2);
  const goalKey = lastGoal ? `${lastGoal.minute}-${lastGoal.playerId}` : null;
  // sounds: the kickoff when a match starts from the beginning, each goal as it is shown
  const kickedOff = useRef(false);
  useEffect(() => {
    if (!kickedOff.current && minute < 1) {
      kickedOff.current = true;
      sound.play('kickoff');
    }
  }, [minute]);
  useEffect(() => {
    if (goalKey) sound.play('goal');
  }, [goalKey]);
  const subsDone = result.events.filter((e) => e.type === 'sub' && e.minute <= minute);
  const reds = new Set(result.events.filter((e) => e.type === 'red' && e.minute <= minute).map((e) => e.playerId));

  const dots = (side: 'home' | 'away') => {
    const f = FORMATIONS[result.formations[side]];
    const inPoss = (side === 'home' ? 0 : 1) === ball.s;
    return f.slots.map((slot, i) => {
      // own-half coordinates for the team (length = slot.y)
      let len = slot.y * 0.62 + (inPoss ? 12 : 2);
      len += ((side === 'home' ? bx : 100 - bx) - 50) * 0.32;
      if (slot.pos === 'GK') len = 4 + ((side === 'home' ? bx : 100 - bx) > 70 ? 6 : 0);
      len = Math.max(2, Math.min(96, len));
      let wid = slot.x + ((side === 'home' ? by : 100 - by) - 50) * 0.18;
      wid = Math.max(4, Math.min(96, wid));
      const x = side === 'home' ? len : 100 - len;
      const y = side === 'home' ? wid : 100 - wid;
      return { key: `${side}-${i}`, x, y, gk: slot.pos === 'GK' };
    });
  };

  return (
    <div className="board">
      <svg viewBox="0 0 105 68" preserveAspectRatio="none">
        <defs>
          <pattern id="stripes" width="15" height="68" patternUnits="userSpaceOnUse">
            <rect width="7.5" height="68" fill="#1a4a30" />
            <rect x="7.5" width="7.5" height="68" fill="#17402a" />
          </pattern>
        </defs>
        <rect width="105" height="68" fill="url(#stripes)" />
        <g fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="0.35">
          <rect x="1" y="1" width="103" height="66" />
          <line x1="52.5" y1="1" x2="52.5" y2="67" />
          <circle cx="52.5" cy="34" r="9.15" />
          <rect x="1" y="13.85" width="16.5" height="40.3" />
          <rect x="87.5" y="13.85" width="16.5" height="40.3" />
          <rect x="1" y="24.85" width="5.5" height="18.3" />
          <rect x="98.5" y="24.85" width="5.5" height="18.3" />
        </g>
        {(['home', 'away'] as const).map((side) =>
          dots(side).map((d) => (
            <circle
              key={d.key}
              cx={(d.x / 100) * 103 + 1}
              cy={(d.y / 100) * 66 + 1}
              r={1.5}
              fill={side === 'home' ? home.color : away.color}
              stroke={d.gk ? '#fff' : '#000'}
              strokeWidth={0.35}
              style={{ transition: 'cx 0.35s linear, cy 0.35s linear' }}
            />
          )),
        )}
        <circle cx={(bx / 100) * 103 + 1} cy={(by / 100) * 66 + 1} r={0.95} fill="#fff" stroke="#000" strokeWidth={0.25} style={{ transition: 'cx 0.12s linear, cy 0.12s linear' }} />
      </svg>
      {lastGoal && (
        <div className="goal-flash" key={`${lastGoal.minute}-${lastGoal.playerId}`}>
          GOAL!
        </div>
      )}
      <div style={{ position: 'absolute', left: 8, bottom: 6, fontSize: 11 }} className="muted">
        {subsDone.length > 0 && `交代 ${subsDone.length}`} {reds.size > 0 && `退場 ${reds.size}`}
      </div>
    </div>
  );
}

function name(players: Map<string, Player>, id?: string) {
  return id ? players.get(id)?.name ?? '?' : '';
}

export function eventText(e: MatchEvent, players: Map<string, Player>, teams: { home: Team; away: Team }): string {
  const team = teams[e.side].name;
  switch (e.type) {
    case 'goal':
      return `⚽ ${name(players, e.playerId)}（${team}）${e.otherId ? ` アシスト：${name(players, e.otherId)}` : ''}${e.chance ? `・${CHANCE_LABEL[e.chance]}` : ''}`;
    case 'save':
      return `🧤 ${name(players, e.otherId)} がセーブ（${name(players, e.playerId)} のシュート・xG ${e.xg}）`;
    case 'miss':
      return `${name(players, e.playerId)} のシュートは枠外（xG ${e.xg}）`;
    case 'block':
      return `${name(players, e.playerId)} のシュートはブロック`;
    case 'yellow':
      return `🟨 ${name(players, e.playerId)}（${team}）`;
    case 'red':
      return `🟥 ${name(players, e.playerId)}（${team}）退場`;
    case 'sub':
      return `🔁 ${team}：${name(players, e.otherId)} → ${name(players, e.playerId)}`;
    case 'tactic':
      return `📋 ${team} が${e.detail === 'attack' ? '攻撃的' : '守備的'}な戦術に切り替え`;
    case 'penalty':
      return `PK獲得（${team}）`;
    case 'corner':
      return `コーナーキック（${team}）`;
    case 'counter':
      return `${team} のカウンター`;
    case 'press_win':
      return `${team} がプレスでボール奪取`;
    case 'foul':
      return `ファウル：${name(players, e.playerId)}`;
    default:
      return `${EVENT_LABEL[e.type]}${e.type === 'kickoff' ? `（${team}）` : ''}`;
  }
}

const SHOWN = new Set(['goal', 'save', 'miss', 'block', 'yellow', 'red', 'sub', 'tactic', 'penalty', 'half_time', 'full_time', 'kickoff', 'corner']);

export function EventLog({ events, minute, players, teams }: { events: MatchEvent[]; minute: number; players: Map<string, Player>; teams: { home: Team; away: Team } }) {
  const list = useMemo(() => events.filter((e) => SHOWN.has(e.type)), [events]);
  const visible = list.filter((e) => e.minute <= minute).reverse();
  return (
    <div className="events">
      {visible.map((e, i) => (
        <div key={i} className={`ev ${e.type === 'goal' ? 'goal' : ''}`} style={{ borderLeft: `3px solid ${e.type === 'kickoff' || e.type === 'half_time' || e.type === 'full_time' ? '#555' : teams[e.side].color}` }}>
          <span className="min">{Math.min(90, Math.floor(e.minute))}'</span>
          <span>{eventText(e, players, teams)}</span>
        </div>
      ))}
    </div>
  );
}
