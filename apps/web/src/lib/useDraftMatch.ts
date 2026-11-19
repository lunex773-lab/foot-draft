import type { DraftMatchClientMessage, DraftMatchServerMessage, DraftMatchSnapshot, Player } from '@fd/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sound } from '../sound/player';
import { api, wsUrl } from './api';
import type { ConnState } from './useRoom';

/**
 * Connection to a DRAFT MATCH room. Reconnects with backoff; every
 * (re)connect receives the whole current state (spec 10: 再接続時に進行状態を復元する).
 */
export function useDraftMatch(roomId: string) {
  const [snap, setSnap] = useState<DraftMatchSnapshot | null>(null);
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());
  const [conn, setConn] = useState<ConnState>('connecting');
  const [error, setError] = useState<{ code: string; message?: string; at: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUser = useRef(false);

  useEffect(() => {
    closedByUser.current = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    const connect = async () => {
      try {
        const { ticket } = await api<{ ticket: string }>(`/api/draft-match/${roomId}/ticket`, { body: {} });
        const ws = new WebSocket(wsUrl(`/api/draft-match/${roomId}/ws?ticket=${encodeURIComponent(ticket)}`));
        wsRef.current = ws;
        ws.onopen = () => {
          attempt = 0;
          setConn('open');
          ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'ping', t: Date.now() })), 15000);
        };
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data)) as DraftMatchServerMessage;
          if (msg.type === 'snapshot') {
            setOffset(msg.state.serverNow - Date.now());
            setSnap(msg.state);
          } else if (msg.type === 'players') setPlayers(new Map(msg.players.map((p) => [p.id, p])));
          else if (msg.type === 'pong') setOffset(msg.serverNow - (msg.t + Date.now()) / 2);
          else if (msg.type === 'error') {
            sound.play('error');
            setError({ code: msg.code, message: msg.message, at: Date.now() });
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

  const send = useCallback((msg: DraftMatchClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }, []);
  const serverNow = useCallback(() => Date.now() + offset, [offset]);
  return { snap, players, conn, error, send, serverNow };
}
