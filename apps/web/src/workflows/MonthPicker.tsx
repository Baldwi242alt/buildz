import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type TimeWindow = { startsAt: string; endsAt: string };
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dayRange(day: string) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}
export function overlaps(window: TimeWindow, start: number, end: number) {
  return Date.parse(window.startsAt) < end && Date.parse(window.endsAt) > start;
}
export function intervalState(
  windows: TimeWindow[],
  busy: TimeWindow[],
  start: number,
  end: number,
) {
  if (busy.some((item) => overlaps(item, start, end))) return "Busy";
  // Adjacent shared windows jointly cover a slot; gaps remain unknown/closed.
  let coveredUntil = start;
  for (const item of [...windows].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  )) {
    if (Date.parse(item.startsAt) > coveredUntil) break;
    coveredUntil = Math.max(coveredUntil, Date.parse(item.endsAt));
    if (coveredUntil >= end) return "Free";
  }
  return "Not shared";
}

/** Native date buttons, with optional arrow-key shortcuts and no focus trap. */
export function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const date = new Date(`${value}T12:00:00`);
  const year = date.getFullYear(),
    month = date.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  function moveMonth(delta: number) {
    onChange(localDay(new Date(year, month + delta, 1)));
  }
  return (
    <section className="month-picker" aria-label="Choose a calendar date">
      <div className="month-heading">
        <button
          className="icon-button"
          aria-label="Previous month"
          onClick={() => moveMonth(-1)}
        >
          <ChevronLeft size={20} />
        </button>
        <h3 aria-live="polite">
          {date.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h3>
        <button
          className="icon-button"
          aria-label="Next month"
          onClick={() => moveMonth(1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="month-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span className="month-weekday" key={day} aria-hidden="true">
            {day}
          </span>
        ))}
        {Array.from({ length: offset }, (_, index) => (
          <span key={`empty-${index}`} />
        ))}
        {Array.from({ length: count }, (_, index) => {
          const current = new Date(year, month, index + 1);
          const key = localDay(current);
          return (
            <button
              key={key}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              className="month-day"
              aria-label={current.toLocaleDateString(undefined, {
                dateStyle: "full",
              })}
              aria-pressed={key === value}
              aria-current={key === localDay() ? "date" : undefined}
              onClick={() => onChange(key)}
              onKeyDown={(event) => {
                const delta = {
                  ArrowLeft: -1,
                  ArrowRight: 1,
                  ArrowUp: -7,
                  ArrowDown: 7,
                }[event.key];
                if (delta !== undefined) {
                  event.preventDefault();
                  buttons.current[
                    Math.min(count - 1, Math.max(0, index + delta))
                  ]?.focus();
                }
              }}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
      <button className="button secondary" onClick={() => onChange(localDay())}>
        Today
      </button>
    </section>
  );
}
