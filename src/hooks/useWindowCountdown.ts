import { useState, useEffect } from "react";

/**
 * Custom hook to track the time remaining in the current 5-minute session.
 * Used for UI countdowns and to trigger data refreshes when a window ends.
 *
 * Polymarket BTC prediction markets operate on a fixed 5-minute schedule (300 seconds).
 * This hook synchronizes the client UI with that global window.
 *
 * @returns The number of seconds remaining in the current 300-second window.
 */
export function useWindowCountdown(): number {
  // secs stores the seconds left until the next 5-minute interval.
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    // The tick function calculates the remainder of the current Unix time divided by 300.
    // Subtracting this from 300 gives us the exact seconds until the next window starts.
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      setSecs(300 - (now % 300));
    };

    // Call immediately to set initial state, then run every 1 second.
    tick();
    const id = setInterval(tick, 1000);

    // Cleanup the interval when the component unmounts to prevent memory leaks.
    return () => clearInterval(id);
  }, []);

  return secs;
}