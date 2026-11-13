import type { ClientMessage, Player, RoomSnapshot, ServerMessage } from '@fd/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, wsUrl } from './api';

export type ConnState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Connection to a room. Reconnects automatically with backoff and receives a
 * full snapshot on every (re)connect (spec 23-1: 通信切断後に復帰できる).
 */
export function useRoom(roomId: string) {
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  const [conn, setConn] = useState<ConnState>('connecting');
  const [error, setError] = useState<{ code: string; message?: string; at: number } | null>(null);
  const [offset, setOffset] = useState(0); // serverNow - Date.now()
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUser = useRef(false);

  useEffect(() => {
    closedByUser.current = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const connect = async () => {
      try {
        const { ticket } = await api<{ ticket: string }>(`/api/rooms/${roomId}/ticket`, { body: {} });
        const ws = new WebSocket(wsUrl(`/api/rooms/${roomId}/ws?ticket=${encodeURIComponent(ticket)}`));
        wsRef.current = ws;
        ws.onopen = () => {
          attempt = 0;
          setConn('open');
          ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'ping', t: Date.now() })), 15000);
        };
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data)) as ServerMessage;
          switch (msg.type) {
            case 'snapshot':
              setOffset(msg.state.serverNow - Date.now());
              setSnap(msg.state);
              break;
            case 'players':
              setPlayers(new Map(msg.players.map((p) => [p.id, p])));
              break;
            case 'pick':
              setSnap((s) => {
                if (!s?.draft || s.draft.picks.some((p) => p.pickNo === msg.pick.pickNo)) return s;
                return { ...s, draft: { ...s.draft, picks: [...s.draft.picks, msg.pick], currentSeat: msg.nextSeat, deadline: msg.deadline } };
              });
              break;
            case 'pong':
              setOffset(msg.serverNow - (msg.t + Date.now()) / 2);
              break;
            case 'error':
              setError({ code: msg.code, message: msg.message, at: Date.now() });
              break;
          }
        };
        ws.onclose = () => {
          if (ping) clearInterval(ping);
          wsRef.current = null;
          if (closedByUser.current) {
            setConn('closed');
            return;
          }
          setConn('reconnecting');
          attempt++;
          timer = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt));
        };
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 403 || status === 404) {
          setConn('closed');
          setError({ code: 'NOT_MEMBER', message: 'このルームに参加していません', at: Date.now() });
          return;
        }
        setConn('reconnecting');
        attempt++;
        timer = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt));
      }
    };
    connect();
    return () => {
      closedByUser.current = true;
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      wsRef.current?.close();
    };
  }, [roomId]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }, []);

  const serverNow = useCallback(() => Date.now() + offset, [offset]);

  return { snap, players, conn, error, send, serverNow };
}
