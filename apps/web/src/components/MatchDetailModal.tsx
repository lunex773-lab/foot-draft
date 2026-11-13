import type { Lineup, MatchEvent, MatchResultData, Player, TrackPoint } from '@fd/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { seatColor } from '../lib/labels';
import { EventLog } from './MatchBoard';
import { MatchStats } from './MatchStats';

export interface MatchDetail {
  match: { id: string; seed: string; sim_version: string; matchday: number };
  result: { home_goals: number; away_goals: number; mvp_player_id: string };
  home: TeamDetail;
  away: TeamDetail;
  events: MatchEvent[];
  track: TrackPoint[];
}
interface TeamDetail {
  seat: number;
  name: string;
  lineup: Lineup;
  players: Player[];
  stats: MatchResultData['stats']['home'];
  playerStats: MatchResultData['players'];
  notes: MatchResultData['notes']['home'];
}

/** Turns the stored match into the same shape as a live result. */
export function toResult(d: MatchDetail): MatchResultData {
  return {
    seed: d.match.seed,
    simVersion: d.match.sim_version,
    score: { home: d.result.home_goals, away: d.result.away_goals },
    events: d.events,
    track: d.track,
    stats: { home: d.home.stats, away: d.away.stats },
    players: [...d.home.playerStats, ...d.away.playerStats],
    mvpId: d.result.mvp_player_id,
    chemistry: { home: { score: 0, modifier: 1 }, away: { score: 0, modifier: 1 } },
    tactics: { home: d.home.lineup.tactics, away: d.away.lineup.tactics },
    formations: { home: d.home.lineup.formation, away: d.away.lineup.formation },
    notes: { home: d.home.notes, away: d.away.notes },
  };
}

export function useMatchDetail(id: string | null) {
  const [data, setData] = useState<MatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    setData(null);
    api<MatchDetail>(`/api/matches/${id}`)
      .then(setData)
      .catch((e) => setError(String(e.message)));
  }, [id]);
  return { data, error };
}

export function MatchDetailModal({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const { data, error } = useMatchDetail(matchId);
  const players = new Map<string, Player>();
  if (data) for (const p of [...data.home.players, ...data.away.players]) players.set(p.id, p);
  const teams = data ? { home: { name: data.home.name, color: seatColor(data.home.seat) }, away: { name: data.away.name, color: seatColor(data.away.seat) } } : null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>試合詳細</h2>
          <button className="btn small" onClick={onClose}>
            閉じる
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {!data && !error && <div className="muted">読み込み中…</div>}
        {data && teams && (
          <>
            <div className="scoreboard" style={{ marginBottom: 14 }}>
              <div className="team" style={{ color: teams.home.color }}>
                {teams.home.name}
              </div>
              <div className="score">
                {data.result.home_goals} - {data.result.away_goals}
              </div>
              <div className="team away" style={{ color: teams.away.color }}>
                {teams.away.name}
              </div>
            </div>
            <MatchStats result={toResult(data)} players={players} home={teams.home} away={teams.away} />
            <h3 style={{ marginTop: 16 }}>イベント</h3>
            <EventLog events={data.events} minute={91} players={players} teams={teams} />
            <div className="tiny muted" style={{ marginTop: 10 }}>
              シード {data.match.seed}・SIM v{data.match.sim_version}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
