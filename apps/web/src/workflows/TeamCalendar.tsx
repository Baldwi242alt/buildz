import { useState } from "react";
import { api, unwrap } from "../lib/api";
import { dateTime, deviceTimezone, LoadState, useRemote } from "./common";
import { dayRange, intervalState } from "./MonthPicker";
import { usePolling } from "./usePolling";

export function TeamCalendar({
  projectId,
  day,
}: {
  projectId: string;
  day: string;
}) {
  const [time, setTime] = useState("10:00");
  const range = dayRange(day);
  const data = useRemote(
    (signal) =>
      unwrap(
        api!.GET("/v1/projects/{id}/team-calendar", {
          params: { path: { id: projectId }, query: range },
          signal,
        }),
      ),
    `${projectId}:${day}`,
  );
  usePolling(data.reload, true, 60000);
  const start = +new Date(`${day}T${time || "10:00"}:00`);
  const end = start + 30 * 60000;
  return (
    <section
      className="team-availability"
      aria-label="Project member availability"
    >
      <div className="workflow-toolbar">
        <h3>Who’s free to build?</h3>
        <label>
          Check a time
          <input
            type="time"
            step={1800}
            value={time}
            onChange={(event) => {
              if (event.target.value) setTime(event.target.value);
            }}
          />
        </label>
      </div>
      <p className="workflow-caption">
        30-minute window from{" "}
        {dateTime(new Date(start).toISOString(), deviceTimezone)}. Busy takes
        priority; “Not shared” is not a free-time promise. Only availability is
        shown, never private appointment details.
      </p>
      <LoadState
        loading={data.loading}
        error={data.error}
        retry={data.reload}
      />
      {!data.loading && data.data && (
        <ul className="member-availability-list">
          {data.data.members.map((member) => {
            const state = intervalState(
              member.windows,
              member.busy,
              start,
              end,
            );
            return (
              <li key={member.userId}>
                <div className="member-availability-summary">
                  <strong>{member.displayName}</strong>
                  <span
                    className={`availability-state availability-${state.toLowerCase().replace(" ", "-")}`}
                  >
                    {state}
                  </span>
                </div>
                <details>
                  <summary>Day’s shared times</summary>
                  {!member.windows.length && !member.busy.length && (
                    <p>No availability shared for this date.</p>
                  )}
                  {member.windows.map((window, index) => (
                    <p key={`free-${index}`}>
                      <strong>Shared free:</strong>{" "}
                      {dateTime(window.startsAt, deviceTimezone)} →{" "}
                      {dateTime(window.endsAt, deviceTimezone)}
                    </p>
                  ))}
                  {member.busy.map((window, index) => (
                    <p key={`busy-${index}`}>
                      <strong>Busy:</strong>{" "}
                      {dateTime(window.startsAt, deviceTimezone)} →{" "}
                      {dateTime(window.endsAt, deviceTimezone)}
                    </p>
                  ))}
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
