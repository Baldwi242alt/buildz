import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CalendarDays, Check, Search } from "lucide-react";
import {
  api,
  unwrap,
  errorMessage,
  ServiceError,
  type Schemas,
} from "../lib/api";
import {
  dateTime,
  deviceTimezone,
  EmptyState,
  integer,
  isoDate,
  LoadState,
  money,
  SectionHeading,
  StateLabel,
  useRemote,
} from "./common";
import { PageControls } from "./Support";
import { manages } from "./Resources";
import { useWorkflowAction } from "./useWorkflowAction";
import { usePolling } from "./usePolling";

export function Planning({
  project,
  me,
  members,
}: {
  project: Schemas["Project"];
  me: Schemas["Me"];
  members: Schemas["Member"][];
}) {
  const resources = useRemote(
    (signal) =>
      unwrap(
        api!.GET("/v1/resources", {
          params: { query: { limit: 100 } },
          signal,
        }),
      ),
    project.id,
  );
  const [resourceId, setResourceId] = useState("");
  const [startsAt, setStart] = useState("");
  const [endsAt, setEnd] = useState("");
  const [people, setPeople] = useState<string[]>([me.id]);
  const [voucher, setVoucher] = useState("");
  const [duration, setDuration] = useState("60");
  const [quote, setQuote] = useState<{
    value: Schemas["BookingQuote"];
    input: Schemas["BookingInput"];
  } | null>(null);
  const [slots, setSlots] = useState<Schemas["BuildSlot"][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Schemas["Booking"] | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);
  const resource = resources.data?.find((item) => item.id === resourceId);
  const attemptedBookings = useRef(new Set<string>());
  const editable =
    members.some((item) => item.userId === me.id) &&
    project.lifecycle !== "archived";
  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
    setQuote(null);
  }, []);
  const action = useWorkflowAction(refresh);
  useEffect(() => {
    if (!quote) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);
  const expired = !!quote && Date.parse(quote.value.validUntil) <= now;
  function changed() {
    setQuote(null);
    setSlots(null);
    setError("");
    setReceipt(null);
  }
  function input(): Schemas["BookingInput"] {
    if (!resourceId)
      throw new ServiceError("Choose a resource first.", "VALIDATION_ERROR");
    if (!people.includes(me.id) || people.length > 20)
      throw new ServiceError(
        "Include yourself and up to 19 other accepted teammates.",
        "VALIDATION_ERROR",
      );
    const start = isoDate(startsAt, "start time"),
      end = isoDate(endsAt, "end time");
    if (end <= start)
      throw new ServiceError(
        "End time must be after start time.",
        "VALIDATION_ERROR",
      );
    return {
      projectId: project.id,
      resourceId,
      startsAt: start,
      endsAt: end,
      attendees: people,
      ...(voucher.trim() ? { voucherCode: voucher.trim().toUpperCase() } : {}),
    };
  }
  async function find(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSlots(null);
    setQuote(null);
    try {
      const draft = input();
      const matches = await unwrap(
        api!.POST("/v1/projects/{id}/build-slots/search", {
          params: { path: { id: project.id } },
          body: {
            resourceId: draft.resourceId,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            participantIds: people,
            requiredParticipantIds: people,
            minimumAttendees: people.length,
            durationMinutes: integer(duration, "Duration", 5, 480),
          },
        }),
      );
      setSlots(matches);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function getQuote(preset?: Schemas["BookingInput"]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setQuote(null);
    try {
      const draft = preset || input();
      if (Date.parse(draft.endsAt) - Date.parse(draft.startsAt) > 8 * 3600000)
        throw new ServiceError(
          "A single booking can be no longer than 8 hours. Choose a suggested slot or shorten your exact interval.",
          "VALIDATION_ERROR",
        );
      const value = await unwrap(
        api!.POST("/v1/booking-quotes", { body: draft }),
      );
      setNow(Date.now());
      setQuote({ value, input: draft });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <SectionHeading
        eyebrow="THE RIGHT PEOPLE, PLACE, AND TIME"
        title="Plan a build session"
      >
        Choose your team and a resource. Find a shared time, review the actual
        quote, then reserve.
      </SectionHeading>
      <LoadState
        loading={resources.loading && !resources.data}
        error={resources.error}
        retry={resources.reload}
      />
      {!editable && (
        <p className="workflow-notice">
          Only accepted project members can make reservations. Archived projects
          must be restored first.
        </p>
      )}
      {editable && resources.data && (
        <div className="workflow-layout">
          <div>
            <form className="workflow-form" onSubmit={find}>
              <label>
                Space or equipment
                <select
                  value={resourceId}
                  required
                  disabled={busy}
                  onChange={(event) => {
                    setResourceId(event.target.value);
                    changed();
                  }}
                >
                  <option value="">Choose an available resource</option>
                  {resources.data
                    .filter((item) => item.active)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · up to {item.capacity} people
                      </option>
                    ))}
                </select>
              </label>
              {resource && (
                <a
                  className="workflow-inline-link"
                  href={`#/resources/${resource.id}`}
                >
                  View {resource.name} rules and opening hours →
                </a>
              )}
              <fieldset className="attendee-picker" disabled={busy}>
                <legend>Who needs to be there?</legend>
                <p className="workflow-caption">
                  Choose accepted teammates. You are included as the booking
                  organizer.
                </p>
                {members.map((member) => (
                  <label className="checkbox-row" key={member.userId}>
                    <input
                      type="checkbox"
                      checked={people.includes(member.userId)}
                      disabled={member.userId === me.id}
                      onChange={(event) => {
                        setPeople(
                          event.target.checked
                            ? [...people, member.userId]
                            : people.filter((id) => id !== member.userId),
                        );
                        changed();
                      }}
                    />
                    {member.displayName}
                    {member.userId === me.id ? " (you)" : ""}
                  </label>
                ))}
              </fieldset>
              <div className="schedule-pair">
                <label>
                  Search from / exact start
                  <input
                    type="datetime-local"
                    required
                    value={startsAt}
                    disabled={busy}
                    onChange={(event) => {
                      setStart(event.target.value);
                      changed();
                    }}
                  />
                </label>
                <label>
                  Search until / exact end
                  <input
                    type="datetime-local"
                    required
                    value={endsAt}
                    disabled={busy}
                    onChange={(event) => {
                      setEnd(event.target.value);
                      changed();
                    }}
                  />
                </label>
              </div>
              <p className="workflow-caption">
                Input timezone: {deviceTimezone}. Search up to 14 days ahead
                within your range; exact bookings are limited to 8 hours.
              </p>
              <label>
                Session duration for matching (minutes)
                <input
                  type="number"
                  min={5}
                  max={480}
                  step={1}
                  value={duration}
                  disabled={busy}
                  onChange={(event) => {
                    setDuration(event.target.value);
                    changed();
                  }}
                />
              </label>
              <label>
                Voucher code (optional)
                <input
                  maxLength={64}
                  value={voucher}
                  disabled={busy}
                  onChange={(event) => {
                    setVoucher(event.target.value);
                    changed();
                  }}
                  placeholder="A code from your institution"
                />
              </label>
              <div className="record-actions">
                <button className="button primary" disabled={busy}>
                  <Search size={16} />
                  {busy ? "Checking…" : "Find a shared time"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void getQuote()}
                >
                  Quote this exact time
                </button>
              </div>
            </form>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            {slots && (
              <section>
                <h3 className="section-subtitle">
                  {slots.length} suggested times
                </h3>
                {!slots.length && (
                  <EmptyState title="No shared time in this range">
                    Check that each selected teammate has shared availability,
                    the resource is open, and the group meets its capacity and
                    safety rules. Try a different date or smaller team.
                  </EmptyState>
                )}
                {slots.map((slot) => (
                  <article
                    className="slot-result"
                    key={`${slot.startsAt}:${slot.endsAt}`}
                  >
                    <div>
                      <strong>{dateTime(slot.startsAt, me.timezone)}</strong>
                      <p>
                        Until {dateTime(slot.endsAt, me.timezone)} ·{" "}
                        {me.timezone}
                      </p>
                      <span className="workflow-caption">
                        {money(slot.estimatedTotalMinor, slot.currency)}{" "}
                        estimated before vouchers
                      </span>
                    </div>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void getQuote({
                          projectId: project.id,
                          resourceId: slot.resourceId,
                          startsAt: slot.startsAt,
                          endsAt: slot.endsAt,
                          attendees: people,
                          ...(voucher.trim()
                            ? { voucherCode: voucher.trim().toUpperCase() }
                            : {}),
                        })
                      }
                    >
                      Review quote
                    </button>
                  </article>
                ))}
              </section>
            )}
            {quote && (
              <section className="workflow-receipt" aria-label="Booking quote">
                <h3>Review your booking</h3>
                <p>{resource?.name}</p>
                <dl>
                  <dt>From</dt>
                  <dd>{dateTime(quote.value.startsAt, me.timezone)}</dd>
                  <dt>Until</dt>
                  <dd>{dateTime(quote.value.endsAt, me.timezone)}</dd>
                  <dt>Attendees</dt>
                  <dd>
                    {quote.input.attendees
                      .map(
                        (id) =>
                          members.find((item) => item.userId === id)
                            ?.displayName || "Teammate",
                      )
                      .join(", ")}
                  </dd>
                  <dt>Resource cost</dt>
                  <dd>
                    {money(quote.value.subtotalMinor, quote.value.currency)}
                  </dd>
                  <dt>Voucher discount</dt>
                  <dd>
                    −{money(quote.value.discountMinor, quote.value.currency)}
                  </dd>
                  <dt className="total">Total</dt>
                  <dd className="total">
                    {money(quote.value.totalMinor, quote.value.currency)}
                  </dd>
                </dl>
                <p className="workflow-notice">
                  {quote.value.requiresApproval
                    ? "This booking requires staff approval. It is not confirmed until approved."
                    : "The server will confirm this booking only if it is still available and everyone is eligible."}{" "}
                  Payment is managed by the school. BuildZ will not charge a
                  card.
                </p>
                <p className="workflow-caption">
                  Quote valid until{" "}
                  {dateTime(quote.value.validUntil, me.timezone)}. A quote does
                  not hold the resource.
                </p>
                <button
                  className="button primary"
                  disabled={expired || busy}
                  onClick={() =>
                    action.open(
                      {
                        title: quote.value.requiresApproval
                          ? "Request this booking?"
                          : "Confirm this booking?",
                        description: `${resource?.name || "Resource"} · ${dateTime(quote.value.startsAt, me.timezone)} to ${dateTime(quote.value.endsAt, me.timezone)} (${me.timezone}). Total ${money(quote.value.totalMinor, quote.value.currency)}, school-managed payment. ${quote.value.requiresApproval ? "Staff approval is required." : "Availability is checked again on confirmation."}`,
                        label: quote.value.requiresApproval
                          ? "Request booking"
                          : "Confirm booking",
                        fields: [
                          {
                            name: "consent",
                            label:
                              "I reviewed the time, attendees, total, and resource rules",
                            type: "checkbox",
                          },
                        ],
                        refresh: async () => {
                          setQuote(null);
                          setSlots(null);
                        },
                        run: async (_values, key) => {
                          if (
                            !attemptedBookings.current.has(key) &&
                            Date.parse(quote.value.validUntil) <= Date.now()
                          )
                            throw new ServiceError(
                              "This quote expired. Close and request a new quote before booking.",
                              "QUOTE_EXPIRED",
                            );
                          const booking = await unwrap(
                            api!.POST("/v1/bookings", {
                              params: { header: { "Idempotency-Key": key } },
                              body: {
                                ...quote.input,
                                resourceVersion: quote.value.resourceVersion,
                                expectedTotalMinor: quote.value.totalMinor,
                              },
                            }),
                          ).catch((failure: unknown) => {
                            if (
                              !(failure instanceof ServiceError) ||
                              failure.code === "INVALID_RESPONSE"
                            )
                              attemptedBookings.current.add(key);
                            throw failure;
                          });
                          setReceipt(booking);
                        },
                      },
                      "Booking saved. Check its current state below.",
                    )
                  }
                >
                  {expired
                    ? "Quote expired—request a new one"
                    : quote.value.requiresApproval
                      ? "Request staff approval"
                      : "Confirm booking"}
                </button>
                {expired && (
                  <button
                    className="button secondary"
                    onClick={() => void getQuote(quote.input)}
                  >
                    Refresh quote
                  </button>
                )}
              </section>
            )}
            {action.notice}
            {receipt && (
              <div className="workflow-receipt" role="status">
                <Check size={22} />
                <h3>Your booking was saved.</h3>
                <p>
                  Check the booking history below for its current approval or
                  cancellation status.
                </p>
                <p>
                  {dateTime(receipt.startsAt, me.timezone)} →{" "}
                  {dateTime(receipt.endsAt, me.timezone)}
                </p>
                <p className="workflow-caption">
                  Booking reference {receipt.id}. It is saved in your project’s
                  booking history.
                </p>
              </div>
            )}
          </div>
          <aside className="workflow-aside">
            <CalendarDays size={28} />
            <h3>Start with availability.</h3>
            <p>
              Shared-time matching uses each teammate’s available windows,
              existing reservations, resource hours, and eligibility.
            </p>
            <a className="workflow-inline-link" href="#/availability">
              Set your availability →
            </a>
            <p className="workflow-caption">
              No suitable match? An exact-time quote still checks real opening
              hours and conflicts. It doesn’t silently assume everyone is free.
            </p>
          </aside>
        </div>
      )}
      <BookingList
        key={revision}
        project={project}
        me={me}
        resources={resources.data || []}
      />
      {action.dialog}
    </>
  );
}

export function BookingList({
  project,
  me,
  resources,
}: {
  project?: Schemas["Project"];
  me: Schemas["Me"];
  resources: Schemas["Resource"][];
}) {
  const [cursor, setCursor] = useState<string>();
  const data = useRemote(async (signal) => {
    const result = await api!.GET("/v1/bookings", {
      params: {
        query: {
          limit: 100,
          cursor,
          ...(project ? { projectId: project.id } : {}),
        },
      },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${me.id}:${project?.id}:${cursor}`);
  const action = useWorkflowAction(data.reload);
  usePolling(data.reload, !action.action && !cursor, 30000);
  return (
    <section>
      <SectionHeading
        title={project ? "Project bookings" : "Resource bookings"}
      >
        Saved reservations and their actual status. Pending approval is not a
        confirmed booking.
      </SectionHeading>
      {action.notice}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <>
          {!data.data.items.length && (
            <EmptyState title="No bookings yet">
              A reserved space and a shared time will appear here once the
              server saves your booking.
            </EmptyState>
          )}
          {data.data.items.map((item) => {
            const resource = resources.find(
              (resource) => resource.id === item.resourceId,
            );
            const manager = resource
              ? manages(me, resource.institutionId)
              : false;
            const canCancel =
              manager || item.bookedBy === me.id || project?.ownerId === me.id;
            const options: Schemas["BookingDecision"]["decision"][] =
              item.state === "pending"
                ? manager
                  ? ["confirmed", "rejected", "cancelled"]
                  : canCancel
                    ? ["cancelled"]
                    : []
                : item.state === "confirmed"
                  ? manager
                    ? Date.parse(item.endsAt) <= Date.now()
                      ? ["completed", "no_show", "cancelled"]
                      : ["cancelled"]
                    : canCancel && Date.parse(item.startsAt) > Date.now()
                      ? ["cancelled"]
                      : []
                  : [];
            return (
              <article className="workflow-record" key={item.id}>
                <StateLabel state={item.state} />
                <h3>{resource?.name || "Resource reservation"}</h3>
                <p>
                  {dateTime(item.startsAt, me.timezone)} →{" "}
                  {dateTime(item.endsAt, me.timezone)}
                </p>
                <div className="record-meta">
                  <span>{item.attendees.length} attendees</span>
                  <span>{money(item.totalMinor, item.currency)} total</span>
                  {item.discountMinor > 0 && (
                    <span>
                      {money(item.discountMinor, item.currency)} voucher applied
                    </span>
                  )}
                </div>
                {item.decisionReason && (
                  <p className="workflow-notice">{item.decisionReason}</p>
                )}
                {item.expiresAt && item.state === "pending" && (
                  <p className="workflow-caption">
                    Approval expires {dateTime(item.expiresAt, me.timezone)}. An
                    expired request must be booked again.
                  </p>
                )}
                <details className="booking-reference">
                  <summary>Booking reference</summary>
                  <p>{item.id}</p>
                </details>
                <div className="record-actions">
                  {options.map((decision) => (
                    <button
                      className="button secondary"
                      key={decision}
                      onClick={() =>
                        action.open(
                          {
                            title:
                              decision === "cancelled"
                                ? "Cancel this booking?"
                                : `Mark booking ${decision.replaceAll("_", " ")}?`,
                            description:
                              decision === "cancelled" ||
                              decision === "rejected"
                                ? "This releases the reservation and applicable voucher credit. It cannot be undone; a new booking needs a fresh quote."
                                : "The server verifies the reservation’s current state and eligibility before saving this decision.",
                            label:
                              decision === "cancelled"
                                ? "Cancel booking"
                                : decision === "confirmed"
                                  ? "Approve booking"
                                  : decision === "rejected"
                                    ? "Reject booking"
                                    : decision === "completed"
                                      ? "Mark completed"
                                      : "Record no-show",
                            fields: [
                              {
                                name: "reason",
                                label: "Reason / note for the team",
                                type: "textarea",
                                maxLength: 2000,
                              },
                            ],
                            run: async (values, key) => {
                              await unwrap(
                                api!.POST("/v1/bookings/{id}/decisions", {
                                  params: {
                                    path: { id: item.id },
                                    header: { "Idempotency-Key": key },
                                  },
                                  body: {
                                    version: item.version,
                                    decision,
                                    reason: values.reason.trim(),
                                  },
                                }),
                              );
                            },
                          },
                          "Booking status updated.",
                        )
                      }
                    >
                      {decision === "cancelled"
                        ? "Cancel booking"
                        : decision === "confirmed"
                          ? "Approve booking"
                          : decision === "rejected"
                            ? "Reject booking"
                            : decision === "completed"
                              ? "Mark completed"
                              : "Record no-show"}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
          <PageControls
            next={data.data.next}
            cursor={cursor}
            setCursor={setCursor}
          />
        </>
      )}
      {action.dialog}
    </section>
  );
}
