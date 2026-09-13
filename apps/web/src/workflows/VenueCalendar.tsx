import { useState } from "react";
import { api, unwrap, type Schemas } from "../lib/api";
import {
  dateTime,
  deviceTimezone,
  EmptyState,
  LoadState,
  useRemote,
} from "./common";
import {
  dayRange,
  intervalState,
  localDay,
  MonthPicker,
  overlaps,
} from "./MonthPicker";
import { usePolling } from "./usePolling";

export function VenueCalendar({
  resources,
  projects,
}: {
  resources: Schemas["Resource"][];
  projects: Schemas["Project"][];
}) {
  const venues = resources.filter(
    (item) => item.category !== "equipment" && item.active,
  );
  const [id, setId] = useState(venues[0]?.id || "");
  const [day, setDay] = useState(localDay());
  return (
    <section className="venue-calendar" aria-label="Venue booking calendar">
      <div className="workflow-heading">
        <div>
          <span className="eyebrow">FIND A PLACE TO MAKE</span>
          <h2>Venues & time slots</h2>
          <p>
            Choose a venue and date. Free means the venue has no recorded
            conflict; your team, permissions and price are checked before
            booking.
          </p>
        </div>
      </div>
      {!venues.length ? (
        <EmptyState title="No venues available">
          Your school’s published venues will appear here. Browse Resources for
          equipment and other spaces.
        </EmptyState>
      ) : (
        <>
          <label className="venue-select">
            Venue
            <select value={id} onChange={(event) => setId(event.target.value)}>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name} · {venue.location}
                </option>
              ))}
            </select>
          </label>
          <div className="venue-calendar-layout">
            <MonthPicker value={day} onChange={setDay} />
            <VenueDay
              key={`${id}:${day}`}
              id={id}
              day={day}
              projects={projects}
            />
          </div>
        </>
      )}
    </section>
  );
}
function VenueDay({
  id,
  day,
  projects,
}: {
  id: string;
  day: string;
  projects: Schemas["Project"][];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [allHours, setAllHours] = useState(false);
  const [projectId, setProjectId] = useState(
    projects.find((project) => project.lifecycle !== "archived")?.id || "",
  );
  const range = dayRange(day);
  const data = useRemote(
    (signal) =>
      unwrap(
        api!.GET("/v1/resources/{id}/calendar", {
          params: { path: { id }, query: range },
          signal,
        }),
      ),
    `${id}:${day}`,
  );
  usePolling(data.reload, selected === null, 60000);
  const start = Date.parse(range.startsAt),
    end = Date.parse(range.endsAt);
  const slots = Array.from(
    { length: Math.ceil((end - start) / (30 * 60000)) },
    (_, index) => start + index * 30 * 60000,
  );
  const selectedFree =
    selected !== null &&
    data.data &&
    !data.loading &&
    intervalState(
      data.data.windows,
      data.data.busy,
      selected,
      selected + 30 * 60000,
    ) === "Free";
  const openIndexes = slots.flatMap((time, index) =>
    data.data &&
    [...data.data.windows, ...data.data.busy].some((window) =>
      overlaps(window, time, time + 30 * 60000),
    )
      ? [index]
      : [],
  );
  const visibleSlots = allHours
    ? slots
    : openIndexes.length
      ? slots.slice(
          Math.max(0, openIndexes[0] - 1),
          Math.min(slots.length, openIndexes[openIndexes.length - 1] + 2),
        )
      : [];
  return (
    <div className="venue-day">
      <h3>
        {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
          dateStyle: "full",
        })}
      </h3>
      <p className="workflow-caption">
        30-minute slots · {deviceTimezone}. Busy reservations reveal no names.
        Closed means outside published hours.
      </p>
      <LoadState
        loading={data.loading}
        error={data.error}
        retry={data.reload}
      />
      {!data.loading && data.data && (
        <>
          <button
            className="text-button"
            aria-pressed={allHours}
            onClick={() => setAllHours(!allHours)}
          >
            {allHours ? "Show opening hours only" : "Show all 24 hours"}
          </button>
          {!visibleSlots.length && (
            <EmptyState title="No opening hours on this date">
              Choose another day or view all hours. The venue’s published
              schedule does not offer a free slot here.
            </EmptyState>
          )}
          <div className="venue-slot-board" aria-label="Venue time slots">
            {visibleSlots.map((time) => {
              const state = intervalState(
                data.data!.windows,
                data.data!.busy,
                time,
                time + 30 * 60000,
              );
              const past = time <= Date.now();
              const label = past
                ? "Past"
                : state === "Not shared"
                  ? "Closed"
                  : state;
              return (
                <button
                  key={time}
                  className={`venue-time-slot availability-${label.toLowerCase()}`}
                  disabled={label !== "Free"}
                  aria-pressed={selected === time}
                  onClick={() => setSelected(time)}
                >
                  <time dateTime={new Date(time).toISOString()}>
                    {new Date(time).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {selectedFree && (
        <div className="workflow-receipt" aria-label="Selected venue time">
          <h3>
            Start at{" "}
            {dateTime(new Date(selected!).toISOString(), deviceTimezone)}
          </h3>
          <p>
            This is a selection, not a hold. Continue to choose teammates,
            adjust duration and review the current quote.
          </p>
          <label>
            Booking project
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects
                .filter((project) => project.lifecycle !== "archived")
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
            </select>
          </label>
          {projectId ? (
            <a
              className="button primary"
              href={`#/projects/${projectId}/planning/${id}/${encodeURIComponent(new Date(selected!).toISOString())}/${encodeURIComponent(new Date(selected! + 30 * 60000).toISOString())}`}
            >
              Plan this booking
            </a>
          ) : (
            <p>Create or join an active project to book.</p>
          )}
        </div>
      )}
    </div>
  );
}
