import type { Player } from '@fd/shared';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EventLog, MatchBoard, scoreAt } from '../components/MatchBoard';
import { toResult, useMatchDetail } from '../components/MatchDetailModal';
import { MatchStats } from '../components/MatchStats';
import { seatColor } from '../lib/labels';

/** Replays a stored match (same 2D board as the live view). */
export default function MatchReplayPage() {
  const { matchId = '' } = useParams();
  const { data, error } = useMatchDetail(matchId);
  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(true);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!playing || !data) return;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      setMinute((m) => {
        const next = Math.min(90, m + (dt / 60000) * 90);
        if (next >= 90) setPlaying(false);
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, data]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="muted">読み込み中…</div>;
  const result = toResult(data);
  const players = new Map<string, Player>([...data.home.players, ...data.away.players].map((p) => [p.id, p]));
  const teams = { home: { name: data.home.name, color: seatColor(data.home.seat) }, away: { name: data.away.name, color: seatColor(data.away.seat) } };
  const [h, a] = scoreAt(result.events, minute);
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
          <div className="clock">{minute >= 90 ? '試合終了' : `${Math.floor(minute)}'`}</div>
        </div>
        <div className="team away" style={{ color: teams.away.color }}>
          {teams.away.name}
        </div>
      </div>
      <div className="row">
        <button className="btn small" onClick={() => setPlaying((p) => !p)}>
          {playing ? '一時停止' : '再生'}
        </button>
        <input type="range" min={0} max={90} step={0.5} value={minute} onChange={(e) => setMinute(Number(e.target.value))} style={{ flex: 1, minWidth: 160 }} aria-label="試合時間" />
        <button className="btn small ghost" onClick={() => setMinute(90)}>
          最後まで
        </button>
      </div>
      <div className="match-layout">
        <MatchBoard result={result} minute={minute} home={teams.home} away={teams.away} />
        <div className="panel">
          <h3>実況</h3>
          <EventLog events={result.events} minute={minute} players={players} teams={teams} />
        </div>
      </div>
      {minute >= 90 && (
        <div className="panel">
          <h2>試合データ</h2>
          <MatchStats result={result} players={players} home={teams.home} away={teams.away} />
        </div>
      )}
    </div>
  );
}
