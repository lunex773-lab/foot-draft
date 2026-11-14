import { GAME_CONFIG, describeFilter, type ClientMessage, type RoomSnapshot } from '@fd/shared';
import { useState } from 'react';
import { Countdown } from '../../components/Countdown';
import { seatColor } from '../../lib/labels';

/** Ranked lobby: waiting for players, CPU fill at the deadline (no code, no settings) */
function RankedLobby({ snap, onLeave, serverNow }: { snap: RoomSnapshot; onLeave: () => void; serverNow: () => number }) {
  const humans = snap.seats.filter((s) => s.userId).length;
  return (
    <div className="grid2">
      <div className="panel">
        <h2>ランク戦の相手を探しています…</h2>
        <div className="spread">
          <div className="small muted">4人そろうとすぐに開始。そろわなければ残り時間で CPU が入って開始します。</div>
          <Countdown deadline={snap.lobbyDeadline} serverNow={serverNow} warnAt={10} />
        </div>
        <div className="seats" style={{ marginTop: 16 }}>
          {snap.seats.map((s) => (
            <div key={s.seat} className="seat" style={{ borderColor: s.userId ? seatColor(s.seat) : undefined }}>
              {s.userId ? (
                <>
                  <div className="name">{s.displayName}</div>
                  <div className="tiny muted row" style={{ marginTop: 4 }}>
                    <span className={`dot ${s.connected ? 'on' : ''}`} /> {s.connected ? '接続中' : '未接続'}
                    {s.seat === snap.you && <span className="chip on">あなた</span>}
                  </div>
                </>
              ) : (
                <div className="muted small">待機中…（時間切れでCPU）</div>
              )}
            </div>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>
          現在 {humans}人
        </div>
      </div>
      <div className="panel">
        <h2>ランク戦のルール</h2>
        <ul className="small muted" style={{ lineHeight: 1.8, paddingLeft: 18, marginTop: 0 }}>
          <li>ルールはクイックドラフトと同じ（1ピック{snap.settings.pickSeconds}秒・候補84人・総当たり3試合）</li>
          <li>最終順位で人間同士のレートが変わります。CPUの順位は計算に入りません</li>
          <li>人間が1人だけの時はレートは変わりません</li>
          <li>開始後に退出しても、あなたの席はサーバーが自動で操作し、結果はレートに反映されます</li>
        </ul>
        <button className="btn ghost danger small" onClick={onLeave}>
          待機をやめる
        </button>
      </div>
    </div>
  );
}

export function Lobby({ snap, send, onLeave, serverNow }: { snap: RoomSnapshot; send: (m: ClientMessage) => void; onLeave: () => void; serverNow: () => number }) {
  return snap.mode === 'ranked' ? <RankedLobby snap={snap} onLeave={onLeave} serverNow={serverNow} /> : <StandardLobby snap={snap} send={send} onLeave={onLeave} />;
}

/** quick / private / event lobby */
function StandardLobby({ snap, send, onLeave }: { snap: RoomSnapshot; send: (m: ClientMessage) => void; onLeave: () => void }) {
  const event = snap.variant.kind === 'event' ? snap.variant : null;
  const me = snap.seats.find((s) => s.seat === snap.you);
  const isHost = !!me?.isHost;
  const humans = snap.seats.filter((s) => s.userId).length;
  const link = `${window.location.origin}/join/${snap.code}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid2">
      <div className="panel">
        <h2>{event ? `イベント：${event.name}` : snap.mode === 'private' ? 'プライベートルーム' : snap.mode === 'collection' ? 'Collection Draft' : 'クイックドラフト'}</h2>
        {event && (
          <div className="row" style={{ marginBottom: 10 }}>
            {describeFilter(event.filter).map((c) => (
              <span key={c} className="chip on">
                {c}
              </span>
            ))}
          </div>
        )}
        {event ? (
          <div className="small muted">{event.description}　参加者はイベント画面の「参加する」から同じルームに入ります。</div>
        ) : snap.mode === 'collection' ? (
          <div className="small muted">参加者はホームの「Collection Draft」から同じルームに入ります（招待コードでは参加できません）。専用枠はコレクション画面で登録します。</div>
        ) : (
          <>
            <div className="small muted">招待コード</div>
            <div className="code">{snap.code}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn small"
                onClick={() => {
                  navigator.clipboard?.writeText(link).then(() => setCopied(true));
                }}
              >
                {copied ? 'コピーしました' : '招待リンクをコピー'}
              </button>
              <span className="tiny muted" style={{ wordBreak: 'break-all' }}>
                {link}
              </span>
            </div>
          </>
        )}
        <div className="seats" style={{ marginTop: 16 }}>
          {snap.seats.map((s) => (
            <div key={s.seat} className="seat" style={{ borderColor: s.userId ? seatColor(s.seat) : undefined }}>
              {s.userId ? (
                <>
                  <div className="name">{s.displayName}</div>
                  <div className="tiny muted row" style={{ marginTop: 4 }}>
                    <span className={`dot ${s.connected ? 'on' : ''}`} /> {s.connected ? '接続中' : '未接続'}
                    {s.isHost && <span className="chip">ホスト</span>}
                    {s.seat === snap.you && <span className="chip on">あなた</span>}
                  </div>
                </>
              ) : (
                <div className="muted small">空き（開始時はCPU）</div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>ルール</h2>
        <ul className="small muted" style={{ lineHeight: 1.8, paddingLeft: 18, marginTop: 0 }}>
          <li>最大4人。各自14人（スタメン11＋控え3）をスネークドラフトで指名</li>
          <li>
            候補は84人{event ? '（イベントの対象選手が全員入り、足りない分は通常の選手）' : ''}
            {snap.mode === 'collection' ? '＋各自の専用枠のカード（最大3枚・本人だけが指名できます）' : ''}。同じ選手は1チームだけ。GKは3人まで
          </li>
          <li>時間切れはサーバーが自動で指名します</li>
          <li>ドラフト後、総当たりリーグ（3試合）で順位を決定</li>
          <li>各試合の前にフォーメーション・戦術・スタメンを変更できます</li>
        </ul>
        {isHost ? (
          <>
            <div className="row" style={{ marginBottom: 12, display: event ? 'none' : undefined }}>
              <label className="field">
                1ピックの制限時間
                <select value={snap.settings.pickSeconds} onChange={(e) => send({ type: 'settings', settings: { pickSeconds: Number(e.target.value) } })}>
                  {GAME_CONFIG.pickSecondsOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}秒
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                空席
                <select value={snap.settings.fillWithCpu ? 'cpu' : 'wait'} onChange={(e) => send({ type: 'settings', settings: { fillWithCpu: e.target.value === 'cpu' } })}>
                  <option value="cpu">CPUで埋める</option>
                  <option value="wait">4人そろうまで待つ</option>
                </select>
              </label>
            </div>
            <button className="btn primary" style={{ width: '100%' }} disabled={!snap.settings.fillWithCpu && humans < 4} onClick={() => send({ type: 'start' })}>
              ドラフト開始（{humans}人{humans < 4 && snap.settings.fillWithCpu ? `＋CPU ${4 - humans}` : ''}）
            </button>
          </>
        ) : (
          <div className="muted">ホストの開始を待っています…（制限時間 {snap.settings.pickSeconds}秒）</div>
        )}
        <button className="btn ghost danger small" style={{ marginTop: 12 }} onClick={onLeave}>
          ルームを退出
        </button>
      </div>
    </div>
  );
}
