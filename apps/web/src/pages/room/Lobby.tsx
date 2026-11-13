import { GAME_CONFIG, type ClientMessage, type RoomSnapshot } from '@fd/shared';
import { useState } from 'react';
import { seatColor } from '../../lib/labels';

export function Lobby({ snap, send, onLeave }: { snap: RoomSnapshot; send: (m: ClientMessage) => void; onLeave: () => void }) {
  const me = snap.seats.find((s) => s.seat === snap.you);
  const isHost = !!me?.isHost;
  const humans = snap.seats.filter((s) => s.userId).length;
  const link = `${window.location.origin}/join/${snap.code}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid2">
      <div className="panel">
        <h2>{snap.mode === 'private' ? 'プライベートルーム' : 'クイックドラフト'}</h2>
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
          <li>候補は84人。同じ選手は1チームだけ。GKは3人まで</li>
          <li>時間切れはサーバーが自動で指名します</li>
          <li>ドラフト後、総当たりリーグ（3試合）で順位を決定</li>
          <li>各試合の前にフォーメーション・戦術・スタメンを変更できます</li>
        </ul>
        {isHost ? (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
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
