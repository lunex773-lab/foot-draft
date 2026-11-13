import type { SeatInfo, StandingRow } from '@fd/shared';
import { seatColor } from '../lib/labels';

export function Standings({ rows, seats, you }: { rows: StandingRow[]; seats: SeatInfo[]; you: number | null }) {
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>チーム</th>
            <th className="num">試合</th>
            <th className="num">勝</th>
            <th className="num">分</th>
            <th className="num">敗</th>
            <th className="num">得失</th>
            <th className="num">勝点</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seat} style={{ fontWeight: r.seat === you ? 700 : 400 }}>
              <td className={`rank-${r.rank}`}>{r.rank}</td>
              <td>
                <span className="dot" style={{ background: seatColor(r.seat), marginRight: 6 }} />
                {seats[r.seat]?.displayName || `Seat ${r.seat + 1}`}
                {r.seat === you && <span className="chip" style={{ marginLeft: 6 }}>あなた</span>}
              </td>
              <td className="num">{r.played}</td>
              <td className="num">{r.won}</td>
              <td className="num">{r.drawn}</td>
              <td className="num">{r.lost}</td>
              <td className="num">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
              <td className="num display" style={{ fontSize: 16 }}>
                {r.points}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
