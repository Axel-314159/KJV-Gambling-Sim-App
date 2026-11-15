import { useEffect, useState } from 'react';

export function useServerCountdown(serverTimeUtc?: string, targetTimeUtc?: string) {
  const [remainingMs, setRemainingMs] = useState<number>(0);

  useEffect(() => {
    if (!serverTimeUtc || !targetTimeUtc) return;

    const clockOffset = new Date(serverTimeUtc).getTime() - Date.now();
    const targetMs = new Date(targetTimeUtc).getTime();

    const tick = () => {
      const estimatedServerNow = Date.now() + clockOffset;
      setRemainingMs(Math.max(0, targetMs - estimatedServerNow));
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [serverTimeUtc, targetTimeUtc]);

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    remainingMs,
    formatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    isExpired: remainingMs === 0,
  };
}