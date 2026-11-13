import { useNow } from '../lib/useNow';

export function Countdown({ deadline, serverNow, warnAt = 3 }: { deadline: number | null; serverNow: () => number; warnAt?: number }) {
  useNow(200);
  if (!deadline) return <span className="timer">--</span>;
  const left = Math.max(0, Math.ceil((deadline - serverNow()) / 1000));
  return <span className={`timer ${left <= warnAt ? 'low' : ''}`}>{left}</span>;
}
