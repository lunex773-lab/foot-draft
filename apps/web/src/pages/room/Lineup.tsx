import {
  DEFAULT_TACTICS,
  FORMATION_IDS,
  TACTIC_FIELD_LABELS_JA,
  TACTIC_LABELS_JA,
  autoLineup,
  computeChemistry,
  lineupStrength,
  type ClientMessage,
  type FormationId,
  type Lineup as LineupT,
  type Player,
  type RoomSnapshot,
  type Tactics,
} from '@fd/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Countdown } from '../../components/Countdown';
import { MatchDetailModal } from '../../components/MatchDetailModal';
import { PitchEditor } from '../../components/PitchEditor';
import { Standings } from '../../components/Standings';
import { seatColor } from '../../lib/labels';
import { seatRoster } from '../../lib/team';

export function Lineup({ snap, players, send, serverNow }: { snap: RoomSnapshot; players: Map<string, Player>; send: (m: ClientMessage) => void; serverNow: () => number }) {
  const you = snap.you!;
  // MATCH: the seat's cards are strengthened (decision 70)
  const roster = useMemo(() => seatRoster(snap, players, you), [snap.rosters, snap.levels, you, players]);
  const serverLineup = snap.lineups[you];
  const [lineup, setLineup] = useState<LineupT | null>(serverLineup ?? null);
  const [detail, setDetail] = useState<string | null>(null);
  const ready = !!snap.lineupReady[you];
  // Solo Challenge rule: formation fixed
  const locked = snap.variant.kind === 'solo' && snap.variant.challenge.rule.type === 'fixed_formation' ? snap.variant.challenge.rule.formation : null;
  const md = snap.matchday;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // reset local lineup when a new matchday starts
  useEffect(() => {
    setLineup(serverLineup ?? (roster.length ? autoLineup(roster, locked ?? undefined) : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md, roster.length]);

  const update = (l: LineupT) => {
    setLineup(l);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => send({ type: 'lineup', lineup: l, ready: false }), 350);
  };

  if (!lineup) return <div className="muted">読み込み中…</div>;
  const byId = new Map(roster.map((p) => [p.id, p]));
  const chem = computeChemistry(lineup.starters.map((id) => byId.get(id)), lineup.formation, lineup.tactics);
  const strength = lineupStrength(lineup, byId);
  const fixture = snap.fixtures.find((f) => f.matchday === md && (f.homeSeat === you || f.awaySeat === you));
  const opp = fixture ? (fixture.homeSeat === you ? fixture.awaySeat : fixture.homeSeat) : null;
  const oppRoster = opp !== null ? seatRoster(snap, players, opp) : [];
  const oppLineup = opp !== null ? snap.lineups[opp] : null;
  const oppStrength = oppLineup ? lineupStrength(oppLineup, new Map(oppRoster.map((p) => [p.id, p]))) : null;
  const lastResults = snap.fixtures.filter((f) => f.homeGoals !== null);

  const setTactic = <K extends keyof Tactics>(k: K, v: Tactics[K]) => update({ ...lineup, tactics: { ...lineup.tactics, [k]: v } });
  const setFormation = (f: FormationId) => update({ ...autoLineup(roster, f), tactics: lineup.tactics });

  return (
    <div>
      <div className={`turn-banner ${ready ? '' : 'mine'}`}>
        <div className="spread">
          <div>
            <div className="display" style={{ fontSize: 18 }}>
              第{md}節の準備 — 対戦相手：<span style={{ color: opp !== null ? seatColor(opp) : undefined }}>{opp !== null ? snap.seats[opp]?.displayName : '-'}</span>
            </div>
            <div className="tiny muted">
              {Object.entries(snap.lineupReady)
                .map(([s, r]) => `${snap.seats[Number(s)]?.displayName} ${r ? '✓' : '…'}`)
                .join('　')}
            </div>
          </div>
          <div className="row">
            <Countdown deadline={snap.phaseDeadline} serverNow={serverNow} warnAt={5} />
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
          <div className="spread" style={{ marginBottom: 10 }}>
            <label className="field">
              フォーメーション
              <select value={lineup.formation} disabled={!!locked} title={locked ? 'この課題ではフォーメーションは固定です' : undefined} onChange={(e) => setFormation(e.target.value as FormationId)}>
                {FORMATION_IDS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              {locked && <span className="tiny muted">課題のルールで固定</span>}
            </label>
            <button className="btn small" onClick={() => update({ ...autoLineup(roster, lineup.formation), tactics: lineup.tactics })}>
              自動で並べる
            </button>
          </div>
          <PitchEditor roster={roster} lineup={lineup} onChange={update} levels={snap.levels?.[you]} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="grid2">
              <div>
                <div className="small muted">チーム力（スタメン平均）</div>
                <div className="display" style={{ fontSize: 30 }}>
                  {strength}
                  {oppStrength !== null && <span className="small muted"> vs {oppStrength}</span>}
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
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  適性 {chem.positionFit}/40・連携 {chem.links}/25・戦術 {chem.tacticFit}/25・バランス {chem.balance}
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
          {opp !== null && (
            <div className="panel">
              <h3>次の相手：{snap.seats[opp]?.displayName}</h3>
              {oppLineup ? (
                <div className="small">
                  前の試合：{oppLineup.formation}・{TACTIC_LABELS_JA.offense[oppLineup.tactics.offense]}・{TACTIC_LABELS_JA.defense[oppLineup.tactics.defense]}
                </div>
              ) : (
                <div className="small muted">まだ試合をしていないため、編成は非公開です。</div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                {oppRoster
                  .slice()
                  .sort((a, b) => b.ovr - a.ovr)
                  .slice(0, 6)
                  .map((p) => (
                    <span key={p.id} className="chip">
                      {p.primaryPosition} {p.ovr} {p.lastName}
                    </span>
                  ))}
              </div>
            </div>
          )}
          {lastResults.length > 0 && (
            <div className="panel">
              <h3>順位表</h3>
              <Standings rows={snap.standings} seats={snap.seats} you={you} />
              <h3 style={{ marginTop: 14 }}>結果</h3>
              {lastResults.map((f) => (
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
          )}
        </div>
      </div>
      {detail && <MatchDetailModal matchId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
