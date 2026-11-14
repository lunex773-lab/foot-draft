import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { trackSessions } from './session';

/** balances as returned by the server (the client never computes them) */
export interface Wallet {
  coins: number;
  gems: { free: number; paidPurchased: number; paidGranted: number; paid: number; total: number };
  points: { standard: number; premium: number };
}

export interface LoginStatus {
  dayKey: string;
  claimedToday: boolean;
  streak: number;
  amount: number;
}

export interface MembershipStatus {
  active: boolean;
  autoRenew: boolean;
  periodEnd: number | null;
}

interface WalletCtx {
  wallet: Wallet | null;
  /** Premium Membership (badge) */
  membership: MembershipStatus | null;
  login: LoginStatus | null;
  matchRewards: { leaguesToday: number; cap: number } | null;
  /** message shown once (login bonus received) */
  notice: string | null;
  clearNotice: () => void;
  refresh: () => Promise<void>;
  /** apply a wallet returned by an operation (gacha, exchange, claim) */
  setWallet: (w: Wallet) => void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [login, setLogin] = useState<LoginStatus | null>(null);
  const [matchRewards, setMatchRewards] = useState<WalletCtx['matchRewards']>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [membership, setMembership] = useState<MembershipStatus | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<{ wallet: Wallet; login: LoginStatus; matchRewards: { leaguesToday: number; cap: number } }>('/api/currency');
    setWallet(r.wallet);
    setLogin(r.login);
    setMatchRewards(r.matchRewards);
    api<{ membership: MembershipStatus }>('/api/users/me')
      .then((m) => setMembership(m.membership))
      .catch(() => undefined);
  }, []);

  // app sessions for the admin analytics (DAU, play time)
  useEffect(() => trackSessions(), []);

  useEffect(() => {
    // receive today's login bonus when the app opens (once per Japan day, decided by the server)
    (async () => {
      try {
        const lb = await api<LoginStatus & { paid: number; membershipGems: number; wallet: Wallet }>('/api/rewards/login', { body: {} });
        const parts = [
          lb.paid > 0 ? `ログインボーナス：${lb.paid.toLocaleString()} COINS（${lb.streak}日連続）` : '',
          lb.membershipGems > 0 ? `会員特典：無償GEMS ${lb.membershipGems}` : '',
        ].filter(Boolean);
        if (parts.length) setNotice(`${parts.join('　')} を受け取りました`);
      } catch {
        /* shown as not received */
      }
      await refresh().catch(() => undefined);
    })();
  }, [refresh]);

  return (
    <Ctx.Provider value={{ wallet, membership, login, matchRewards, notice, clearNotice: () => setNotice(null), refresh, setWallet }}>{children}</Ctx.Provider>
  );
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('WalletProvider missing');
  return c;
}

/** unique id per user action, so a retried request is never charged twice */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const fmt = (n: number) => n.toLocaleString('ja-JP');

export const REASON_LABEL: Record<string, string> = {
  match_reward: '対戦報酬',
  login_bonus: 'ログインボーナス',
  mission: 'ミッション',
  solo_clear: 'ソロ課題の達成',
  event_bonus: 'イベントの順位報酬',
  season_reward: 'シーズン報酬',
  gacha: 'ガシャ',
  test_grant: 'テスト用の付与',
  duplicate: '重複カードの変換',
  redeem: '交換所',
  distribution: '運営からの配布',
  purchase: '購入',
  purchase_bonus: '購入のおまけ',
  refund: '返金による回収',
  season_pass: 'Season Pass',
  membership_daily: '会員特典',
};

export const CURRENCY_SHORT: Record<string, string> = {
  COINS: 'COINS',
  GEMS_FREE: '無償GEMS',
  GEMS_PAID_PURCHASED: '有償GEMS（購入）',
  GEMS_PAID_GRANTED: '有償GEMS（配布）',
};
