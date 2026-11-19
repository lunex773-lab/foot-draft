import { useEffect, useRef } from 'react';
import { useNow } from '../lib/useNow';
import { sound } from '../sound/player';

/** seconds left; with `tick` the last `tickFrom` seconds also tick (the player's own turn) */
export function Countdown({ deadline, serverNow, warnAt = 3, tick = false, tickFrom = 5 }: { deadline: number | null; serverNow: () => number; warnAt?: number; tick?: boolean; tickFrom?: number }) {
  useNow(200);
  const left = deadline ? Math.max(0, Math.ceil((deadline - serverNow()) / 1000)) : null;
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (!tick || left === null || left <= 0 || left > tickFrom || lastTick.current === left) return;
    lastTick.current = left;
    sound.play('tick');
  }, [tick, left, tickFrom]);
  if (left === null) return <span className="timer">--</span>;
  return <span className={`timer ${left <= warnAt ? 'low' : ''}`}>{left}</span>;
}
