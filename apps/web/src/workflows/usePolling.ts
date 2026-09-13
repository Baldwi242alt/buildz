import { useEffect } from "react";

/** Poll only while visible; return from a hidden tab triggers an immediate refetch. */
export function usePolling(
  refresh: () => void,
  enabled: boolean,
  milliseconds = 30000,
) {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (!document.hidden) refresh();
    };
    const interval = window.setInterval(tick, milliseconds);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh, enabled, milliseconds]);
}
