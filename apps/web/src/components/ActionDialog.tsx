import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Modal } from "./ui";
import { errorMessage, ServiceError } from "../lib/api";

export interface ActionField {
  name: string;
  label: string;
  initial?: string;
  type?:
    | "text"
    | "email"
    | "textarea"
    | "select"
    | "number"
    | "datetime-local"
    | "date"
    | "checkbox";
  maxLength?: number;
  min?: number | string;
  max?: number | string;
  step?: number;
  optional?: boolean;
  hint?: string;
  options?: { value: string; label: string }[];
}
export interface ActionSpec {
  title: string;
  description: string;
  label: string;
  fields: ActionField[];
  run: (values: Record<string, string>, key: string) => Promise<void>;
  refresh?: () => Promise<void>;
  versioned?: boolean;
}
export function ActionDialog({
  action,
  onClose,
}: {
  action: ActionSpec;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      action.fields.map((field) => [
        field.name,
        field.initial ?? field.options?.[0]?.value ?? "",
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [wait, setWait] = useState(0);
  const key = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || wait || conflict) return;
    if (
      action.fields.some(
        (field) =>
          !field.optional &&
          (!values[field.name]?.trim() ||
            (field.type === "checkbox" && values[field.name] !== "true")),
      )
    ) {
      setError("Complete each field before continuing.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await action.run(values, key.current);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ServiceError && failure.retryAfter)
        setWait(failure.retryAfter);
      if (
        failure instanceof ServiceError &&
        [
          "VERSION_CONFLICT",
          "CAPABILITY_DENIED",
          "FORBIDDEN",
          "NOT_FOUND",
          "QUOTE_CHANGED",
          "QUOTE_EXPIRED",
          "SLOT_UNAVAILABLE",
          "SLOT_TAKEN",
          "RESOURCE_UNAVAILABLE",
          "ATTENDEE_BUSY",
          "BOOKING_EXPIRED",
        ].includes(failure.code)
      ) {
        setConflict(true);
        await action.refresh?.().catch(() => {});
      }
      // Freeze a possibly submitted body. Retrying uses the same intention and key.
      if (
        !(failure instanceof ServiceError) ||
        failure.code === "INVALID_RESPONSE"
      ) {
        setLocked(true);
        if (action.versioned) {
          setConflict(true);
          await action.refresh?.().catch(() => {});
        }
      }
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <Modal
      title={action.title}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p className="modal-intro">{action.description}</p>
      <form className="project-form" onSubmit={submit}>
        {action.fields.map((field) => (
          <div className="action-field" key={field.name}>
            <label htmlFor={`action-${field.name}`}>{field.label}</label>
            {field.hint && (
              <p className="field-hint" id={`hint-${field.name}`}>
                {field.hint}
              </p>
            )}
            {field.type === "checkbox" ? (
              <input
                id={`action-${field.name}`}
                type="checkbox"
                checked={values[field.name] === "true"}
                required={!field.optional}
                disabled={busy || locked}
                aria-describedby={field.hint ? `hint-${field.name}` : undefined}
                onChange={(event) =>
                  setValues({
                    ...values,
                    [field.name]: String(event.target.checked),
                  })
                }
              />
            ) : field.type === "select" ? (
              <select
                id={`action-${field.name}`}
                value={values[field.name]}
                required={!field.optional}
                aria-describedby={field.hint ? `hint-${field.name}` : undefined}
                disabled={busy || locked}
                onChange={(event) =>
                  setValues({ ...values, [field.name]: event.target.value })
                }
              >
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                id={`action-${field.name}`}
                value={values[field.name]}
                required={!field.optional}
                aria-describedby={field.hint ? `hint-${field.name}` : undefined}
                maxLength={field.maxLength}
                rows={4}
                disabled={busy || locked}
                onChange={(event) =>
                  setValues({ ...values, [field.name]: event.target.value })
                }
              />
            ) : (
              <input
                id={`action-${field.name}`}
                type={field.type || "text"}
                value={values[field.name]}
                required={!field.optional}
                aria-describedby={field.hint ? `hint-${field.name}` : undefined}
                maxLength={field.maxLength}
                min={field.min}
                max={field.max}
                step={field.step}
                disabled={busy || locked}
                onChange={(event) =>
                  setValues({ ...values, [field.name]: event.target.value })
                }
              />
            )}
          </div>
        ))}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {conflict ? "Close and review latest" : "Cancel"}
          </button>
          <button
            className="button primary"
            disabled={busy || conflict || wait > 0}
          >
            {busy
              ? "Saving…"
              : wait
                ? `Try again in ${wait}s`
                : locked
                  ? "Retry same action"
                  : action.label}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
