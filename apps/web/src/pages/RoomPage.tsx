import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { errorText } from '../lib/labels';
import { useRoom } from '../lib/useRoom';
import { Draft } from './room/Draft';
import { Final } from './room/Final';
import { Lineup } from './room/Lineup';
import { Lobby } from './room/Lobby';
import { Playing } from './room/Playing';

export default function RoomPage() {
  const { roomId = '' } = useParams();
  const nav = useNavigate();
  const { snap, players, conn, error, send, serverNow } = useRoom(roomId);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    setToast(errorText(error.code, error.message));
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  const leave = async () => {
    await api(`/api/rooms/${roomId}/leave`, { body: {} }).catch(() => undefined);
    nav('/');
  };

  if (error?.code === 'NOT_MEMBER') {
    return (
      <div className="panel">
        <div className="error">このルームには参加していません。</div>
      </div>
    );
  }
  if (!snap) return <div className="muted">ルームに接続しています…</div>;

  return (
    <div>
      {conn !== 'open' && (
        <div className="error" style={{ marginBottom: 12 }}>
          {conn === 'reconnecting' ? '接続が切れました。再接続しています…（ドラフトの時間切れはサーバーが自動で指名します）' : '接続していません'}
        </div>
      )}
      {snap.phase === 'lobby' && <Lobby snap={snap} send={send} onLeave={leave} />}
      {snap.phase === 'drafting' && snap.draft && <Draft snap={snap} players={players} send={send} serverNow={serverNow} />}
      {snap.phase === 'lineup' && <Lineup snap={snap} players={players} send={send} serverNow={serverNow} />}
      {snap.phase === 'playing' && <Playing snap={snap} players={players} serverNow={serverNow} />}
      {snap.phase === 'finished' && <Final snap={snap} />}
      {snap.phase === 'closed' && <div className="panel muted">このルームは閉じられました。</div>}
      {toast && <div className="toast error">{toast}</div>}
    </div>
  );
}
