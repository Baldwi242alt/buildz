import { useEffect, useState } from "react";

type ProviderError = { message?: string; code?: string; status?: number };
let retryAt = 0;
const listeners = new Set<() => void>();

function deferEmail(seconds: number) {
  retryAt = Math.max(retryAt, Date.now() + Math.max(1, seconds) * 1000);
  for (const notify of listeners) notify();
}

/** Observe only email-command throttling; return the untouched response to Auth. */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    response.status === 429 &&
    /\/auth\/v1\/(signup|recover|resend)$/.test(url.pathname)
  ) {
    const guidance = response.headers.get("Retry-After");
    const seconds =
      guidance && /^\d+$/.test(guidance)
        ? Number(guidance)
        : guidance
          ? Math.ceil((Date.parse(guidance) - Date.now()) / 1000)
          : 60;
    // Headers may not be exposed by the provider's CORS policy. This is a local
    // retry guard, not a claim that its project-wide email quota resets in 60s.
    deferEmail(Number.isFinite(seconds) && seconds >= 0 ? seconds : 60);
  }
  return response;
}

export function emailRequestError(error: ProviderError) {
  if (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    /email.*rate.?limit|rate.?limit.*email/i.test(error.message || "")
  ) {
    if (retryAt <= Date.now()) deferEmail(60);
    return "Email sending is temporarily limited. Your entries are kept. Check your inbox for an earlier email, then try again later. If this continues, contact the workspace administrator.";
  }
  return (
    error.message ||
    "We couldn’t send the email. Your entries are kept; please try again later."
  );
}

export function useEmailCooldown() {
  const [clock, setClock] = useState(() => ({
    until: retryAt,
    now: Date.now(),
  }));
  useEffect(() => {
    const update = () => setClock({ until: retryAt, now: Date.now() });
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  const remaining = Math.max(0, Math.ceil((clock.until - clock.now) / 1000));
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(
      () => setClock({ until: retryAt, now: Date.now() }),
      1000,
    );
    return () => clearTimeout(timer);
  }, [remaining, clock.until]);
  return remaining;
}
