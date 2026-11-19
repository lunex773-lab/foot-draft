import type { AuctionLotView, AuctionMarketView, AuctionServerMessage, AuctionWalletView, Rarity } from '@fd/shared';
import { useCallback, useEffect, useState } from 'react';
import { sound } from '../sound/player';
import { api, wsUrl } from './api';
import type { ConnState } from './useRoom';

export interface AuctionWin {
  lotId: string;
  no: number;
  playerId: string;
  rarity: Rarity;
  price: number;
  outcome: 'new' | 'enhanced' | 'points';
  levelAfter: number | null;
  points: number;
  at: number;
}

export interface AuctionRules {
  initialFunds: number;
  bidSeconds: number;
  extendWindowSeconds: number;
  extendSeconds: number;
  minRaisePercent: number;
  minRaiseAmount: number;
  startPrice: Record<Rarity, number>;
  coinsPerGem: number;
}

interface StateResponse {
  market: AuctionMarketView;
  wallet: AuctionWalletView;
  gems: { free: number; paidPurchased: number; paidGranted: number; paid: number; total: number };
  owned: Record<string, number>;
  wins: AuctionWin[];
  rules: AuctionRules;
}

export type AuctionNotice =
  | { kind: 'outbid'; lotId: string; playerId: string; price: number; at: number }
  | { kind: 'won'; lotId: string; playerId: string; price: number; levelAfter: number | null; points: number; at: number };

/**
 * The auction market (decisions 97-106): the state over HTTP, then live over a
 * WebSocket (reconnects with backoff; every connection receives the whole
 * market again, spec 6). Bids go over HTTP and the market answers.
 */
export function useAuction() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [lots, setLots] = useState<AuctionLotView[]>([]);
  const [market, setMarket] = useState<{ open: boolean; mode: string } | null>(null);
  const [wallet, setWallet] = useState<AuctionWalletView | null>(null);
  const [owned, setOwned] = useState<Record<string, number>>({});
  const [conn, setConn] = useState<ConnState>('connecting');
  const [notices, setNotices] = useState<AuctionNotice[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const notify = useCallback((n: AuctionNotice) => setNotices((list) => [...list.slice(-4), n]), []);

  const applyMarket = useCallback((m: AuctionMarketView) => {
    setOffset(m.serverNow - Date.now());
    setLots(m.lots);
    setMarket({ open: m.open, mode: m.mode });
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await api<StateResponse>('/api/auction/state');
      setState(s);
      setWallet(s.wallet);
      setOwned(s.owned);
      applyMarket(s.market);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [applyMarket]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let ws: WebSocket | null = null;
    const connect = async () => {
      try {
        const { ticket } = await api<{ ticket: string }>('/api/auction/ticket', { body: {} });
        if (closed) return;
        ws = new WebSocket(wsUrl(`/api/auction/ws?ticket=${encodeURIComponent(ticket)}`));
        ws.onopen = () => {
          attempt = 0;
          setConn('open');
          ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'ping', t: Date.now() })), 20000);
        };
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data)) as AuctionServerMessage;
          if (msg.type === 'market') applyMarket(msg.market);
          else if (msg.type === 'lot') {
            setOffset(msg.serverNow - Date.now());
            setLots((list) => {
              const i = list.findIndex((l) => l.id === msg.lot.id);
              if (i < 0) return [...list, msg.lot].sort((a, b) => a.no - b.no);
              const next = [...list];
              next[i] = msg.lot;
              return next;
            });
          } else if (msg.type === 'ended') setLots((list) => list.filter((l) => l.id !== msg.lotId));
          else if (msg.type === 'outbid') {
            sound.play('cancel');
            notify({ kind: 'outbid', lotId: msg.lotId, playerId: msg.playerId, price: msg.price, at: Date.now() });
          } else if (msg.type === 'won') {
            sound.play('card');
            notify({ kind: 'won', lotId: msg.lotId, playerId: msg.playerId, price: msg.price, levelAfter: msg.levelAfter, points: msg.points, at: Date.now() });
            if (msg.levelAfter !== null) setOwned((o) => ({ ...o, [msg.playerId]: msg.levelAfter! }));
            void load();
          } else if (msg.type === 'wallet') setWallet(msg.wallet);
          else if (msg.type === 'pong') setOffset(msg.serverNow - (msg.t + Date.now()) / 2);
        };
        ws.onclose = () => {
          if (ping) clearInterval(ping);
          ws = null;
          if (closed) {
            setConn('closed');
            return;
          }
          setConn('reconnecting');
          attempt++;
          timer = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt));
        };
      } catch {
        if (closed) return;
        setConn('reconnecting');
        attempt++;
        timer = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt));
      }
    };
    void connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      ws?.close();
    };
  }, [applyMarket, load, notify]);

  /** spec 2: a bid (the market decides; the error code says why it was refused) */
  const bid = useCallback(async (lotId: string, amount: number) => {
    const res = await api<{ lot: AuctionLotView; wallet: AuctionWalletView }>('/api/auction/bid', { body: { lotId, amount } });
    setWallet(res.wallet);
    setLots((list) => list.map((l) => (l.id === res.lot.id ? res.lot : l)));
    return res;
  }, []);

  /** decisions 101-102: GEMS -> auction coins (one way) */
  const exchange = useCallback(
    async (gems: number) => {
      const requestId = `ax-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await api<{ coins: number; auction: AuctionWalletView; wallet: { gems: StateResponse['gems'] } }>('/api/auction/exchange', { body: { gems, requestId } });
      setWallet(res.auction);
      setState((s) => (s ? { ...s, gems: res.wallet.gems } : s));
      return res;
    },
    [],
  );

  const dismiss = useCallback((at: number) => setNotices((list) => list.filter((n) => n.at !== at)), []);
  const serverNow = useCallback(() => Date.now() + offset, [offset]);

  return { state, lots, market, wallet, owned, conn, notices, dismiss, error, bid, exchange, reload: load, serverNow };
}
