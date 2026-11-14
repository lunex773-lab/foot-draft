import { GAME_CONFIG, POSITION_GROUP, type ClientMessage, type Player, type PositionGroup, type RoomSnapshot } from '@fd/shared';
import { PlayerCard } from '@fd/ui';
import { useMemo, useState } from 'react';
import { Countdown } from '../../components/Countdown';
import { PlayerRow } from '../../components/PlayerRow';
import { seatColor } from '../../lib/labels';

type Filter = 'ALL' | PositionGroup;
type Sort = 'ovr' | 'pac' | 'sho' | 'pas' | 'dri' | 'def' | 'phy';

export function Draft({ snap, players, send, serverNow }: { snap: RoomSnapshot; players: Map<string, Player>; send: (m: ClientMessage) => void; serverNow: () => number }) {
  const d = snap.draft!;
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<Sort>('ovr');
  const [hideTaken, setHideTaken] = useState(() => window.innerWidth < 640);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<number | null>(null);
  const myTurn = d.currentSeat === snap.you;
  const takenBy = useMemo(() => new Map(d.picks.map((p) => [p.playerId, p.seat])), [d.picks]);
  // Collection Draft: cards reserved for their owners (decision 36)
  const reserved = d.reserved ?? {};
  const blocked = (id: string) => !!reserved[id] && (snap.you === null || !reserved[id].includes(snap.you));
  const reservedLabel = (id: string) => (reserved[id].includes(snap.you ?? -1) ? 'あなたの専用' : `専用：${reserved[id].map((s) => snap.seats[s]?.displayName).join('・')}`);
  const mine = d.picks.filter((p) => p.seat === snap.you).map((p) => players.get(p.playerId)!).filter(Boolean);
  const myGk = mine.filter((p) => p.primaryPosition === 'GK').length;
  const viewSeat = view ?? snap.you ?? 0;
  const viewRoster = d.picks.filter((p) => p.seat === viewSeat).map((p) => players.get(p.playerId)!).filter(Boolean);
  const pickNo = d.picks.length + 1;
  const myNextIndex = d.order.findIndex((s, i) => i >= d.picks.length && s === snap.you);

  const list = d.pool
    .map((id) => players.get(id)!)
    .filter(Boolean)
    .filter((p) => filter === 'ALL' || POSITION_GROUP[p.primaryPosition] === filter)
    .filter((p) => !hideTaken || !takenBy.has(p.id))
    .sort((a, b) => (sort === 'ovr' ? b.ovr - a.ovr : b.stats[sort] - a.stats[sort]) || a.id.localeCompare(b.id));

  const pick = (id: string) => {
    if (!myTurn || takenBy.has(id) || blocked(id)) return;
    send({ type: 'pick', playerId: id });
    setSelected(null);
  };
  const sel = selected ? players.get(selected) : null;
  const groups: Record<PositionGroup, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const p of mine) groups[POSITION_GROUP[p.primaryPosition]]++;

  return (
    <div>
      <div className={`turn-banner ${myTurn ? 'mine' : ''}`}>
        <div className="spread">
          <div>
            <div className="display" style={{ fontSize: 18 }}>
              {d.currentSeat === null ? 'ドラフト終了' : myTurn ? 'あなたの指名です' : `${snap.seats[d.currentSeat]?.displayName} が指名中…`}
            </div>
            <div className="tiny muted">
              {pickNo > 56 ? 56 : pickNo} / 56 ピック・ラウンド {Math.min(14, Math.ceil(pickNo / 4))}
              {!myTurn && myNextIndex >= 0 && `・あなたの番まであと ${myNextIndex - d.picks.length} ピック`}
            </div>
            <div className="tiny muted">
              あなた {mine.length}/14（GK {groups.GK}/3・DF {groups.DF}・MF {groups.MF}・FW {groups.FW}）
            </div>
          </div>
          <Countdown deadline={d.deadline} serverNow={serverNow} />
        </div>
        <div className="order-strip" style={{ marginTop: 8 }}>
          {d.order.map((seat, i) => (
            <div key={i} className={`o ${i < d.picks.length ? 'done' : ''} ${i === d.picks.length ? 'now' : ''}`} style={{ background: seatColor(seat) }} title={snap.seats[seat]?.displayName}>
              {i % 4 === 0 ? Math.floor(i / 4) + 1 : ''}
            </div>
          ))}
        </div>
        {sel && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="small">
              選択中：<b>{sel.name}</b>（{sel.primaryPosition} {sel.ovr}）
            </span>
            <button className="btn primary small" disabled={!myTurn || takenBy.has(sel.id) || blocked(sel.id) || (sel.primaryPosition === 'GK' && myGk >= GAME_CONFIG.maxGkPerTeam)} onClick={() => pick(sel.id)}>
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
          <div className="spread" style={{ marginBottom: 10 }}>
            <div className="tabs">
              {(['ALL', 'GK', 'DF', 'MF', 'FW'] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f === 'ALL' ? 'すべて' : f}
                </button>
              ))}
            </div>
            <div className="row small">
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="並び替え">
                <option value="ovr">総合値順</option>
                <option value="pac">PAC順</option>
                <option value="sho">SHO順</option>
                <option value="pas">PAS順</option>
                <option value="dri">DRI順</option>
                <option value="def">DEF順</option>
                <option value="phy">PHY順</option>
              </select>
              <label className="row small muted">
                <input type="checkbox" checked={hideTaken} onChange={(e) => setHideTaken(e.target.checked)} style={{ minHeight: 0 }} /> 指名済みを隠す
              </label>
            </div>
          </div>
          <div className="pool">
            {list.map((p) => {
              const by = takenBy.get(p.id);
              return (
                <div className="slot" key={p.id} onDoubleClick={() => pick(p.id)}>
                  <PlayerCard player={p} width="100%" disabled={by !== undefined || blocked(p.id)} selected={selected === p.id} onClick={() => by === undefined && !blocked(p.id) && setSelected(p.id)} />
                  {reserved[p.id] && by === undefined && <span className="reserved-tag">{reservedLabel(p.id)}</span>}
                  {by !== undefined && (
                    <span className="taken" style={{ color: seatColor(by) }}>
                      {snap.seats[by]?.displayName}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel" style={{ position: 'sticky', top: 12 }}>
          <div className="tabs" style={{ marginBottom: 10 }}>
            {snap.seats.map((s) => (
              <button key={s.seat} className={viewSeat === s.seat ? 'on' : ''} onClick={() => setView(s.seat)} style={{ borderColor: viewSeat === s.seat ? seatColor(s.seat) : undefined }}>
                {s.seat === snap.you ? 'あなた' : s.displayName}
              </button>
            ))}
          </div>
          {viewSeat === snap.you && (
            <div className="row tiny muted" style={{ marginBottom: 8 }}>
              <span className="chip">GK {groups.GK}/3</span>
              <span className="chip">DF {groups.DF}</span>
              <span className="chip">MF {groups.MF}</span>
              <span className="chip">FW {groups.FW}</span>
              <span className="chip">{mine.length}/14</span>
            </div>
          )}
          <div className="plist">
            {viewRoster
              .slice()
              .sort((a, b) => ['GK', 'DF', 'MF', 'FW'].indexOf(POSITION_GROUP[a.primaryPosition]) - ['GK', 'DF', 'MF', 'FW'].indexOf(POSITION_GROUP[b.primaryPosition]) || b.ovr - a.ovr)
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
