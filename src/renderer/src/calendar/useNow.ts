import { useEffect, useState } from 'react';

/** Current time, refreshed every `interval` ms (aligned to the full minute for the default) */
export function useNow(interval = 60000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number;
    const tick = (): void => {
      setNow(Date.now());
      timer = window.setTimeout(tick, interval - (Date.now() % interval) + 50);
    };
    timer = window.setTimeout(tick, interval - (Date.now() % interval) + 50);
    return () => window.clearTimeout(timer);
  }, [interval]);
  return now;
}
