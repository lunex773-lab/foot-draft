import type { RoomSnapshot } from '@fd/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MatchDetailModal } from '../../components/MatchDetailModal';
import { Standings } from '../../components/Standings';
import { seatColor } from '../../lib/labels';

export function Final({ snap }: { snap: RoomSnapshot }) {
  const [detail, setDetail] = useState<string | null>(null);
  const myRank = snap.you !== null ? snap.finalRanks?.[snap.you] : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel" style={{ textAlign: 'center' }}>
        <div className="muted">最終順位</div>
        <div className={`display rank-${myRank}`} style={{ fontSize: 64, lineHeight: 1.1 }}>
          {myRank ? `${myRank}位` : '-'}
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          {snap.standings.map((r) => (
            <span key={r.seat} className="chip" style={{ borderColor: seatColor(r.seat) }}>
              {r.rank}位 {snap.seats[r.seat]?.displayName}（{r.points}点）
            </span>
          ))}
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>順位表</h3>
          <Standings rows={snap.standings} seats={snap.seats} you={snap.you} />
        </div>
        <div className="panel">
          <h3>全試合</h3>
          {snap.fixtures.map((f) => (
            <div key={f.matchId} className="spread small" style={{ padding: '4px 0' }}>
              <span>
                第{f.matchday}節　{snap.seats[f.homeSeat]?.displayName} <b className="display">{f.homeGoals} - {f.awayGoals}</b> {snap.seats[f.awaySeat]?.displayName}
              </span>
              <button className="btn small ghost" onClick={() => setDetail(f.matchId)}>
                詳細
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn primary" to="/">
          ホームへ
        </Link>
        <Link className="btn" to="/history">
          対戦履歴
        </Link>
      </div>
      {detail && <MatchDetailModal matchId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
