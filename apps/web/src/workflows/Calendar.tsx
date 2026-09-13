import { useState } from "react";
import { api, unwrap, type Schemas } from "../lib/api";
import {
  dateTime,
  EmptyState,
  LoadState,
  SectionHeading,
  StateLabel,
  useRemote,
} from "./common";
import { usePolling } from "./usePolling";
import { localDay, MonthPicker } from "./MonthPicker";
import { TeamCalendar } from "./TeamCalendar";

export function Calendar({
  me,
  projects,
}: {
  me: Schemas["Me"];
  projects: Schemas["Project"][];
}) {
  const [from, setFrom] = useState(() => localDay());
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const data = useRemote(async (signal) => {
    const bookings: Schemas["Booking"][] = [];
    const consultations: Schemas["Consultation"][] = [];
    let cursor: string | undefined;
    do {
      const result = await api!.GET("/v1/bookings", {
        params: { query: { limit: 100, cursor } },
        signal,
      });
      bookings.push(...(await unwrap(Promise.resolve(result))));
      cursor = result.data?.meta.nextCursor || undefined;
    } while (cursor && !signal.aborted);
    cursor = undefined;
    do {
      const query: { limit: number; cursor?: string } = { limit: 100, cursor };
      const result = await api!.GET("/v1/consultations", {
        params: { query },
        signal,
      });
      consultations.push(...(await unwrap(Promise.resolve(result))));
      cursor = result.data?.meta.nextCursor || undefined;
    } while (cursor && !signal.aborted);
    return { bookings, consultations };
  }, me.id);
  usePolling(data.reload, true, 60000);
  const start = new Date(`${from}T00:00:00`);
  const finish = new Date(start);
  finish.setDate(finish.getDate() + 1);
  const validRange = Number.isFinite(+start);
  const events = data.data
    ? [
        ...data.data.bookings
          .filter((item) => ["pending", "confirmed"].includes(item.state))
          .map((item) => ({
            id: item.id,
            start: item.startsAt,
            end: item.endsAt,
            state: item.state,
            title:
              projects.find((project) => project.id === item.projectId)
                ?.title || "Project reservation",
            detail: "Resource booking",
            href: `#/projects/${item.projectId}/planning`,
          })),
        ...data.data.consultations
          .filter((item) => item.state === "booked")
          .map((item) => ({
            id: item.id,
            start: item.startsAt,
            end: item.endsAt,
            state: item.state,
            title: item.topic,
            detail: `${item.hostDisplayName} · ${item.location}`,
            href: "#/consultations",
          })),
      ]
        .filter(
          (item) =>
            Date.parse(item.start) < +finish && Date.parse(item.end) > +start,
        )
        .sort((a, b) => a.start.localeCompare(b.start))
    : [];
  return (
    <>
      <SectionHeading
        eyebrow="MAKE THE WEEK WORK"
        title="Your project calendar"
      >
        Choose a date to see who can meet, then review your saved reservations
        and consultations. A team’s shared time is not a booking.
      </SectionHeading>
      <div className="workflow-toolbar">
        <label>
          Starting date
          <input
            type="date"
            required
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Project team
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {!projects.length && <option value="">No projects yet</option>}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <a className="button secondary" href="#/availability">
          Edit availability
        </a>
      </div>
      <p className="workflow-caption">
        Date filter uses your device’s local date. Event times are shown in{" "}
        {me.timezone}. Updates every minute while visible.
      </p>
      <div className="team-calendar-layout">
        <MonthPicker value={from || localDay()} onChange={setFrom} />
        {projectId && validRange ? (
          <TeamCalendar
            key={`${projectId}:${from}`}
            projectId={projectId}
            day={from}
          />
        ) : !projectId ? (
          <EmptyState title="Start with a project">
            Create or join a project to compare your team’s shared availability.
          </EmptyState>
        ) : null}
      </div>
      <h3 className="section-subtitle">Saved events for the selected date</h3>
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {!validRange && (
        <p className="error-message" role="alert">
          Choose a starting date to view your calendar.
        </p>
      )}
      {data.data && validRange && (
        <>
          {!events.length && (
            <EmptyState title="A little space in the calendar">
              No active bookings or consultations overlap this range. Pick
              another date or plan a session from your project.
            </EmptyState>
          )}
          <ol className="agenda-list">
            {events.map((item) => (
              <li key={item.id}>
                <div className="agenda-time">
                  <time dateTime={item.start}>
                    {dateTime(item.start, me.timezone)}
                  </time>
                  <span>until {dateTime(item.end, me.timezone)}</span>
                </div>
                <div>
                  <StateLabel state={item.state} />
                  <h3>
                    <a href={item.href}>{item.title}</a>
                  </h3>
                  <p>{item.detail}</p>
                  <a className="workflow-inline-link" href={item.href}>
                    View details →
                  </a>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
