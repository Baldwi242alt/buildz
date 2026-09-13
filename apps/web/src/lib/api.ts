import { createBuildZClient, type components } from "@buildz/sdk";
import { auth } from "./auth";
import { config } from "./config";
import { ServiceError } from "./errors";
export { ServiceError } from "./errors";

export type Schemas = components["schemas"];
let refresh: Promise<unknown> | null = null;
let demoToken: string | null = null;
let rateLimitedUntil = 0;
export function setLocalDemoToken(token: string | null) {
  if (!config.localDemo) throw new Error("Local demo is disabled.");
  demoToken = token;
}
async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  if (Date.now() < rateLimitedUntil)
    throw new ServiceError(
      "Too many requests. Wait before trying again.",
      "RATE_LIMITED",
      undefined,
      Math.ceil((rateLimitedUntil - Date.now()) / 1000),
    );
  const request = new Request(input, init);
  const retry = request.clone();
  const response = await fetch(request, {
    // Free hosted instances can take about a minute to wake. Reads remain
    // cancellable; mutation timeouts stay short and reconcile by request key.
    signal: AbortSignal.any([
      request.signal,
      AbortSignal.timeout(request.method === "GET" ? 75000 : 20000),
    ]),
  });
  if (response.status === 429) {
    const guidance = response.headers.get("Retry-After");
    const seconds =
      guidance && /^\d+$/.test(guidance)
        ? Number(guidance)
        : guidance
          ? Math.max(0, (Date.parse(guidance) - Date.now()) / 1000)
          : 60;
    rateLimitedUntil =
      Date.now() + (Number.isFinite(seconds) ? Math.ceil(seconds) : 60) * 1000;
    throw new ServiceError(
      "Too many requests. Wait before trying again.",
      "RATE_LIMITED",
      undefined,
      Number.isFinite(seconds) ? Math.ceil(seconds) : 60,
    );
  }
  if (
    response.status !== 401 ||
    (config.localDemo && !!demoToken) ||
    !auth ||
    (request.method !== "GET" && !request.headers.has("Idempotency-Key"))
  )
    return response;
  refresh ??= auth.refreshSession().finally(() => {
    refresh = null;
  });
  await refresh;
  const { data } = await auth.getSession();
  if (!data.session) return response;
  retry.headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(retry, {
    signal: AbortSignal.any([
      retry.signal,
      AbortSignal.timeout(retry.method === "GET" ? 75000 : 20000),
    ]),
  });
}
export const api = config.apiBaseUrl
  ? createBuildZClient({
      // Handoff config includes /v1; SDK baseUrl explicitly requires the origin.
      baseUrl: config.apiBaseUrl.replace(/\/v1$/, ""),
      getAccessToken: async () =>
        (config.localDemo && demoToken) ||
        (await auth?.getSession())?.data.session?.access_token ||
        null,
      fetch: authenticatedFetch,
    })
  : null;

export async function unwrap<T>(
  promise: Promise<{
    data?: { data: T };
    error?: Schemas["Error"];
    response: Response;
  }>,
): Promise<T> {
  const result = await promise;
  if (result.error)
    throw new ServiceError(
      result.error.error.message,
      result.error.error.code,
      result.error.error.requestId,
    );
  if (!result.data)
    throw new ServiceError(
      "The service returned an unreadable response. Please try again.",
      "INVALID_RESPONSE",
    );
  return result.data.data;
}
export function errorMessage(error: unknown): string {
  if (error instanceof ServiceError) {
    if (error.code === "VERSION_CONFLICT")
      return "This record changed while you were editing. Your text is kept below. Close this dialog to review the latest version before saving again.";
    if (error.code === "NOT_FOUND")
      return "This record is unavailable in your current workspace.";
    if (["UNAUTHORIZED", "TOKEN_EXPIRED"].includes(error.code))
      return "Your session has expired. Sign in again to continue.";
    return error.message;
  }
  return "We couldn’t confirm the result. Check your connection. Retrying this same action will keep its original request key.";
}
