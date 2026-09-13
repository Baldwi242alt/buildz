import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { errorMessage, ServiceError } from "../lib/api";

/** Reads are cancelled on scope changes; failures never fall back to sample data. */
export function useRemote<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  scope: string,
) {
  const loaderRef = useRef(loader);
  const previousScope = useRef(scope);
  const notBefore = useRef(0);
  const failures = useRef(0);
  loaderRef.current = loader;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string;
  }>({ data: null, loading: true, error: "" });
  const reload = useCallback(() => {
    if (Date.now() >= notBefore.current) setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const sameScope = previousScope.current === scope;
    if (!sameScope) {
      notBefore.current = 0;
      failures.current = 0;
    }
    previousScope.current = scope;
    setState((current) => ({
      data: sameScope ? current.data : null,
      loading: true,
      error: "",
    }));
    loaderRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          notBefore.current = 0;
          failures.current = 0;
          setState({ data, loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          failures.current += 1;
          const seconds =
            error instanceof ServiceError && error.retryAfter
              ? error.retryAfter
              : Math.min(60, 5 * 2 ** Math.min(4, failures.current - 1));
          notBefore.current = Date.now() + seconds * 1000;
          setState({
            data: null,
            loading: false,
            error: `${errorMessage(error)} You can retry after ${seconds} seconds.`,
          });
        }
      });
    return () => controller.abort();
  }, [scope, revision]);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) reload();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("buildz:refresh", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("buildz:refresh", refresh);
    };
  }, [reload]);
  return { ...state, reload };
}

export function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (error)
    return (
      <div className="workflow-error" role="alert">
        <p>{error}</p>
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={16} />
          Try again
        </button>
      </div>
    );
  if (loading)
    return (
      <div className="workflow-loading" role="status">
        <span className="loading-line" />
        Loading the latest details…
      </div>
    );
  return null;
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="workflow-empty">
      <span className="empty-symbol" aria-hidden="true">
        ↗
      </span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
        {action}
      </div>
    </div>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="workflow-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}
export function StateLabel({ state }: { state: string }) {
  return (
    <span className={`state-label state-${state}`}>
      <span aria-hidden="true" />
      {state.replaceAll("_", " ")}
    </span>
  );
}
export function WorkflowLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="button secondary" href={href}>
      {children}
      <ArrowRight size={16} />
    </a>
  );
}
export function dateTime(value: string, timezone = "Asia/Singapore") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
}
export function money(amountMinor: number, currency: string) {
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** digits);
}
export function integer(
  value: string,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  const result = Number(value);
  if (
    !value.trim() ||
    !Number.isSafeInteger(result) ||
    result < min ||
    result > max
  )
    throw new ServiceError(
      `${label} must be a whole number between ${min} and ${max}.`,
      "VALIDATION_ERROR",
    );
  return result;
}
/** Native datetime-local values are deliberately labelled as the device timezone. */
export function isoDate(value: string, label: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new ServiceError(
      `Enter a valid ${label.toLowerCase()}.`,
      "VALIDATION_ERROR",
    );
  return parsed.toISOString();
}
export const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
