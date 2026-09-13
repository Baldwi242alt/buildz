import { useRef, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "../components/ui";
import { errorMessage, ServiceError, type Schemas } from "../lib/api";
import { deviceTimezone, isoDate } from "./common";

function localInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
export function ScheduleEditor({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  initial: Schemas["Window"][];
  onSave: (windows: Schemas["Window"][], key: string) => Promise<void>;
  onClose: () => void;
}) {
  const [windows, setWindows] = useState(() =>
    initial.map((window) => ({
      key: crypto.randomUUID(),
      start: localInput(window.startsAt),
      end: localInput(window.endsAt),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [review, setReview] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const key = useRef(crypto.randomUUID());
  const sending = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !review) return;
    if (Date.now() < waitUntil) {
      setError("Please wait for the rate limit before retrying.");
      return;
    }
    setError("");
    let spans: Schemas["Window"][];
    try {
      spans = windows.map((window) => {
        const startsAt = isoDate(window.start, "start time"),
          endsAt = isoDate(window.end, "end time");
        if (
          endsAt <= startsAt ||
          Date.parse(endsAt) - Date.parse(startsAt) > 31 * 86400000
        )
          throw new ServiceError(
            "Every window must end after it starts and be no longer than 31 days.",
            "VALIDATION_ERROR",
          );
        return { startsAt, endsAt };
      });
      const sorted = [...spans].sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      );
      if (
        sorted.some(
          (span, index) =>
            index > 0 && span.startsAt < sorted[index - 1].endsAt,
        )
      )
        throw new ServiceError(
          "Opening windows must not overlap. Combine overlapping times before saving.",
          "VALIDATION_ERROR",
        );
    } catch (failure) {
      setError(errorMessage(failure));
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      await onSave(spans, key.current);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      if (
        !(failure instanceof ServiceError) ||
        failure.code === "INVALID_RESPONSE"
      )
        setLocked(true);
      if (failure instanceof ServiceError && failure.retryAfter)
        setWaitUntil(Date.now() + failure.retryAfter * 1000);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="modal-intro">
        Save the complete schedule, not just an additional window. Times below
        use your device timezone: <strong>{deviceTimezone}</strong>.
      </p>
      <form className="workflow-form" onSubmit={save}>
        {windows.map((window, index) => (
          <fieldset
            className="schedule-window"
            key={window.key}
            disabled={busy || locked}
          >
            <legend>Window {index + 1}</legend>
            <label>
              Start
              <input
                type="datetime-local"
                required
                value={window.start}
                onChange={(event) => {
                  setReview(false);
                  setWindows(
                    windows.map((item) =>
                      item.key === window.key
                        ? { ...item, start: event.target.value }
                        : item,
                    ),
                  );
                }}
              />
            </label>
            <label>
              End
              <input
                type="datetime-local"
                required
                value={window.end}
                onChange={(event) => {
                  setReview(false);
                  setWindows(
                    windows.map((item) =>
                      item.key === window.key
                        ? { ...item, end: event.target.value }
                        : item,
                    ),
                  );
                }}
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove window ${index + 1}`}
              onClick={() => {
                setWindows(windows.filter((item) => item.key !== window.key));
                setReview(false);
              }}
            >
              <Trash2 size={17} />
            </button>
          </fieldset>
        ))}
        {!windows.length && (
          <p className="workflow-notice">
            No windows selected. Saving will clear the complete schedule.
          </p>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={busy || locked || windows.length >= 100}
          onClick={() => {
            setWindows([
              ...windows,
              { key: crypto.randomUUID(), start: "", end: "" },
            ]);
            setReview(false);
          }}
        >
          <Plus size={17} />
          Add time window
        </button>
        <label className="checkbox-row">
          <input
            type="checkbox"
            required
            checked={review}
            disabled={busy || locked}
            onChange={(event) => setReview(event.target.checked)}
          />
          I understand this replaces the entire saved schedule, including dates
          outside the current view.
        </label>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy || !review}>
            {busy
              ? "Saving…"
              : locked
                ? "Retry same schedule"
                : "Replace schedule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
