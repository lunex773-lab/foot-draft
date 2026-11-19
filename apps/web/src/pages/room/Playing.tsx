import type { LiveMatch, Player, RoomSnapshot } from '@fd/shared';
import { EventLog, MatchBoard, scoreAt } from '../../components/MatchBoard';
import { MatchStats } from '../../components/MatchStats';
import { seatColor } from '../../lib/labels';
import { useNow } from '../../lib/useNow';
import { useMatchMusic } from '../../sound/player';

export function minuteOf(m: LiveMatch, now: number): number {
  return Math.max(0, Math.min(90, ((now - m.startAt) / m.durationMs) * 90));
}

export function Playing({ snap, players, serverNow }: { snap: RoomSnapshot; players: Map<string, Player>; serverNow: () => number }) {
  useNow(100);
  // the match music (one of three at random) while the match is on screen
  useMatchMusic();
  const now = serverNow();
  const live = snap.live;
  if (live.length === 0) return <div className="muted">試合を準備しています…</div>;
  const mine = live.find((m) => m.homeSeat === snap.you || m.awaySeat === snap.you) ?? live[0];
  const others = live.filter((m) => m !== mine);
  const minute = minuteOf(mine, now);
  const started = now >= mine.startAt;
  const ended = now >= mine.startAt + mine.durationMs;
  const teams = {
    home: { name: snap.seats[mine.homeSeat]?.displayName ?? 'Home', color: seatColor(mine.homeSeat) },
    away: { name: snap.seats[mine.awaySeat]?.displayName ?? 'Away', color: seatColor(mine.awaySeat) },
  };
  const [h, a] = ended ? [mine.result.score.home, mine.result.score.away] : scoreAt(mine.result.events, minute);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="scoreboard">
        <div className="team" style={{ color: teams.home.color }}>
          {teams.home.name}
        </div>
        <div>
          <div className="score">
            {h} - {a}
          </div>
          <div className="clock">{!started ? `キックオフまで ${Math.ceil((mine.startAt - now) / 1000)}秒` : ended ? '試合終了' : `${Math.floor(minute)}'${minute < 45 ? '' : minute < 46 ? ' HT' : ''}`}</div>
        </div>
        <div className="team away" style={{ color: teams.away.color }}>
          {teams.away.name}
        </div>
      </div>
      <div className="match-layout">
        <div>
          <MatchBoard result={mine.result} minute={minute} home={teams.home} away={teams.away} />
          <div className="row tiny muted" style={{ marginTop: 6 }}>
            <span>
              {mine.result.formations.home}（{teams.home.name}）
            </span>
            <span>vs</span>
            <span>
              {mine.result.formations.away}（{teams.away.name}）
            </span>
            <span>・第{mine.matchday}節</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {others.map((o) => {
            const [oh, oa] = now >= o.startAt + o.durationMs ? [o.result.score.home, o.result.score.away] : scoreAt(o.result.events, minuteOf(o, now));
            return (
              <div key={o.matchId} className="panel small spread">
                <span className="muted">同時刻の試合</span>
                <span>
                  <span style={{ color: seatColor(o.homeSeat) }}>{snap.seats[o.homeSeat]?.displayName}</span> <b className="display">{oh} - {oa}</b>{' '}
                  <span style={{ color: seatColor(o.awaySeat) }}>{snap.seats[o.awaySeat]?.displayName}</span>
                </span>
              </div>
            );
          })}
          <div className="panel">
            <h3>実況</h3>
            <EventLog events={mine.result.events} minute={minute} players={players} teams={teams} />
          </div>
        </div>
      </div>
      {ended && (
        <div className="panel">
          <h2>試合データ</h2>
          <MatchStats result={mine.result} players={players} home={teams.home} away={teams.away} />
        </div>
      )}
    </div>
  );
}
