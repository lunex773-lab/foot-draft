import { MISSION_BY_ID, type RoomSnapshot } from '@fd/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MatchDetailModal } from '../../components/MatchDetailModal';
import { Standings } from '../../components/Standings';
import { TierBadge } from '../../components/TierBadge';
import { LeagueRating } from '../../lib/beta';
import { seatColor, signed } from '../../lib/labels';
import { fmt, useWallet } from '../../lib/wallet';

/** COINS and missions earned by this league (decided by the server) */
export function Rewards({ snap }: { snap: RoomSnapshot }) {
  const { refresh } = useWallet();
  const r = snap.you !== null ? snap.outcome?.rewards?.[snap.you] : undefined;
  useEffect(() => {
    if (r) refresh().catch(() => undefined);
  }, [r, refresh]);
  if (snap.you === null || !snap.seats[snap.you]?.userId) return null;
  if (!r) return <div className="small muted" style={{ marginTop: 8 }}>報酬を集計しています…</div>;
  return (
    <div className="result-box" style={{ marginTop: 10 }}>
      <div className="small muted">獲得した報酬</div>
      <div className="display" style={{ fontSize: 28, color: 'var(--gold)' }}>
        +{fmt(r.coins)} COINS
      </div>
      <div className="reward-line small">
        {r.matchRewardGiven ? (
          <span className="chip">対戦報酬 {fmt(r.coins - r.bonus)}</span>
        ) : (
          <span className="chip">今日の対戦報酬は上限（{r.leaguesToday}リーグ）に達しています</span>
        )}
        {r.bonus > 0 && <span className="chip on">{snap.mode === 'event' ? 'イベント順位ボーナス' : 'ソロ課題の達成報酬'} +{fmt(r.bonus)}</span>}
        {r.matchRewardGiven && <span className="chip">今日 {r.leaguesToday}/10 リーグ</span>}
        {!!r.exchangePoints && <span className="chip on">Standard 交換ポイント +{fmt(r.exchangePoints)}</span>}
      </div>
      {!!r.passXp && (
        <div className="small" style={{ marginTop: 6 }}>
          Season Pass +{r.passXp} XP　<Link to="/pass">パスを見る</Link>
        </div>
      )}
      {r.missionsCompleted.length > 0 && (
        <div className="small" style={{ marginTop: 6 }}>
          ミッション達成：{r.missionsCompleted.map((id) => MISSION_BY_ID[id]?.titleJa ?? id).join('・')}　<Link to="/missions">受け取る</Link>
        </div>
      )}
    </div>
  );
}

function Outcome({ snap }: { snap: RoomSnapshot }) {
  const o = snap.outcome;
  const you = snap.you;
  if (snap.mode === 'ranked') {
    const mine = o?.ranked && you !== null ? o.ranked.changes[you] : undefined;
    if (!o?.ranked || !mine) return <div className="result-box small muted">レートを集計しています…</div>;
    return (
      <div className={`result-box ${mine.delta > 0 ? 'good' : mine.delta < 0 ? 'bad' : ''}`}>
        <div className="small muted">ランク戦の結果</div>
        {o.ranked.rated ? (
          <>
            <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
              <span className="muted">{mine.before}</span>→<TierBadge rating={mine.after} size="large" />
              <b className={`display ${mine.delta >= 0 ? 'delta-up' : 'delta-down'}`} style={{ fontSize: 26 }}>
                {signed(mine.delta)}
              </b>
            </div>
            <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
              {Object.entries(o.ranked.changes).map(([seat, c]) => (
                <span key={seat} className="chip" style={{ borderColor: seatColor(Number(seat)) }}>
                  {snap.seats[Number(seat)]?.displayName} {signed(c.delta)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div style={{ marginTop: 6 }}>人間のプレイヤーが1人だったため、レートは変わりません（{mine.before}）</div>
        )}
      </div>
    );
  }
  if (snap.variant.kind === 'solo') {
    const c = snap.variant.challenge;
    if (!o?.solo) return null;
    return (
      <div className={`result-box ${o.solo.cleared ? 'good' : 'bad'}`}>
        <div className="small muted">SOLO CHALLENGE：{c.goalJa}</div>
        <div className={`display ${o.solo.cleared ? 'delta-up' : 'delta-down'}`} style={{ fontSize: 34 }}>
          {o.solo.cleared ? '課題達成！' : '課題未達成'}
        </div>
        <div className="small muted">
          {o.solo.record.won}勝{o.solo.record.drawn}分{o.solo.record.lost}敗・{o.solo.record.goalsFor}得点・{o.solo.record.goalsAgainst}失点・無失点 {o.solo.record.cleanSheets}試合
        </div>
      </div>
    );
  }
  if (snap.variant.kind === 'event') {
    return (
      <div className="result-box">
        <div className="small muted">イベント</div>
        <div style={{ fontWeight: 700 }}>{snap.variant.name}</div>
      </div>
    );
  }
  return null;
}

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
        <Outcome snap={snap} />
        <Rewards snap={snap} />
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          {snap.standings.map((r) => (
            <span key={r.seat} className="chip" style={{ borderColor: seatColor(r.seat) }}>
              {r.rank}位 {snap.seats[r.seat]?.displayName}（{r.points}点）
            </span>
          ))}
        </div>
      </div>
      <LeagueRating snap={snap} />
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
