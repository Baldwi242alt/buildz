import { useState } from "react";
import { Plus } from "lucide-react";
import { api, unwrap, ServiceError, type Schemas } from "../lib/api";
import {
  dateTime,
  deviceTimezone,
  EmptyState,
  isoDate,
  LoadState,
  SectionHeading,
  StateLabel,
  useRemote,
} from "./common";
import { useWorkflowAction } from "./useWorkflowAction";
import { PageControls } from "./Support";
import { usePolling } from "./usePolling";
import { MentorshipInbox } from "./Mentorship";

export function Consultations({
  me,
  institutions,
  projects,
}: {
  me: Schemas["Me"];
  institutions: Schemas["Institution"][];
  projects: Schemas["Project"][];
}) {
  const [school, setSchool] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [bookedCursor, setBookedCursor] = useState<string>();
  const data = useRemote(async (signal) => {
    const [slotResult, bookingResult, mentorships] = await Promise.all([
      api!.GET("/v1/consultation-slots", {
        params: {
          query: {
            limit: 100,
            cursor,
            ...(school ? { institutionId: school } : {}),
          },
        },
        signal,
      }),
      api!.GET("/v1/consultations", {
        params: { query: { limit: 100, cursor: bookedCursor } },
        signal,
      }),
      unwrap(api!.GET("/v1/mentorships", { signal })),
    ]);
    return {
      slots: await unwrap(Promise.resolve(slotResult)),
      bookings: await unwrap(Promise.resolve(bookingResult)),
      nextSlots: slotResult.data?.meta.nextCursor,
      nextBookings: bookingResult.data?.meta.nextCursor,
      mentorships,
    };
  }, `${me.id}:${school}:${cursor}:${bookedCursor}`);
  const action = useWorkflowAction(data.reload);
  usePolling(data.reload, !action.action && !cursor && !bookedCursor, 30000);
  const eligible = institutions.filter((item) =>
    me.roles.some(
      (role) =>
        role.institutionId === item.id &&
        ["institution_admin", "reviewer"].includes(role.role),
    ),
  );
  const projectOptions = projects
    .filter((project) => project.lifecycle !== "archived")
    .map((project) => ({ value: project.id, label: project.title }));
  return (
    <>
      <SectionHeading
        eyebrow="A CONVERSATION CAN CHANGE THE NEXT STEP"
        title="Consultations"
        action={
          eligible.length > 0 && (
            <button
              className="button primary"
              onClick={() =>
                action.open(
                  {
                    title: "Offer a consultation slot",
                    description:
                      "You will host this session. Publish a specific time and location; the server prevents overlapping host appointments.",
                    label: "Publish consultation slot",
                    fields: [
                      {
                        name: "institutionId",
                        label: "Hosting institution",
                        type: "select",
                        options: eligible.map((item) => ({
                          value: item.id,
                          label: item.name,
                        })),
                      },
                      {
                        name: "startsAt",
                        label: "Session start",
                        type: "datetime-local",
                        hint: `Times use ${deviceTimezone}.`,
                      },
                      {
                        name: "endsAt",
                        label: "Session end",
                        type: "datetime-local",
                      },
                      {
                        name: "location",
                        label: "Location or meeting instructions",
                        maxLength: 300,
                      },
                      {
                        name: "crossSchool",
                        label: "Open to eligible students from other schools",
                        type: "checkbox",
                        optional: true,
                      },
                    ],
                    run: async (values, key) => {
                      const startsAt = isoDate(
                          values.startsAt,
                          "session start",
                        ),
                        endsAt = isoDate(values.endsAt, "session end");
                      if (endsAt <= startsAt)
                        throw new ServiceError(
                          "Session end must be after its start.",
                          "VALIDATION_ERROR",
                        );
                      await unwrap(
                        api!.POST("/v1/consultation-slots", {
                          params: { header: { "Idempotency-Key": key } },
                          body: {
                            institutionId: values.institutionId,
                            startsAt,
                            endsAt,
                            location: values.location.trim(),
                            crossSchool: values.crossSchool === "true",
                          },
                        }),
                      );
                    },
                  },
                  "Consultation slot published.",
                )
              }
            >
              <Plus size={17} />
              Offer a session
            </button>
          )
        }
      >
        Request a mentor from your project first. Once they accept, book their
        offered sessions here and keep the conversation connected to your
        project.
      </SectionHeading>
      {action.notice}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <>
          <MentorshipInbox
            requests={data.data.mentorships}
            me={me}
            projects={projects}
            reload={data.reload}
          />
          <section>
            <h3 className="section-subtitle">Your saved consultations</h3>
            {!data.data.bookings.length && (
              <EmptyState title="No consultations booked yet">
                Choose an available session below. Your confirmed time and
                meeting instructions will stay here after reload.
              </EmptyState>
            )}
            {data.data.bookings.map((item) => {
              const host = item.hostId === me.id;
              const canCancel =
                host ||
                item.bookedBy === me.id ||
                projects.some(
                  (project) =>
                    project.id === item.projectId && project.ownerId === me.id,
                );
              return (
                <article className="workflow-record" key={item.id}>
                  <StateLabel state={item.state} />
                  <h3>{item.topic}</h3>
                  <p>
                    {dateTime(item.startsAt, me.timezone)} →{" "}
                    {dateTime(item.endsAt, me.timezone)}
                  </p>
                  <p>
                    With {item.hostDisplayName} · {item.location}
                  </p>
                  <p className="workflow-caption">
                    {projects.find((project) => project.id === item.projectId)
                      ?.title || "Project consultation"}{" "}
                    · Reference {item.id}
                  </p>
                  {item.state === "booked" && (
                    <div className="record-actions">
                      {canCancel && (
                        <button
                          className="button secondary"
                          onClick={() =>
                            action.open(
                              {
                                title: "Cancel this consultation?",
                                description:
                                  "The session will be cancelled and the slot released. The project and its other bookings are unchanged.",
                                label: "Cancel consultation",
                                fields: [],
                                run: async (_values, key) => {
                                  await unwrap(
                                    api!.POST(
                                      "/v1/consultations/{id}/decisions",
                                      {
                                        params: {
                                          path: { id: item.id },
                                          header: { "Idempotency-Key": key },
                                        },
                                        body: {
                                          version: item.version,
                                          decision: "cancelled",
                                        },
                                      },
                                    ),
                                  );
                                },
                              },
                              "Consultation cancelled.",
                            )
                          }
                        >
                          Cancel consultation
                        </button>
                      )}
                      {host && Date.parse(item.endsAt) <= Date.now() && (
                        <button
                          className="button secondary"
                          onClick={() =>
                            action.open(
                              {
                                title: "Mark consultation completed?",
                                description:
                                  "Confirm the consultation took place. This records the final state for the project.",
                                label: "Mark completed",
                                fields: [],
                                run: async (_values, key) => {
                                  await unwrap(
                                    api!.POST(
                                      "/v1/consultations/{id}/decisions",
                                      {
                                        params: {
                                          path: { id: item.id },
                                          header: { "Idempotency-Key": key },
                                        },
                                        body: {
                                          version: item.version,
                                          decision: "completed",
                                        },
                                      },
                                    ),
                                  );
                                },
                              },
                              "Consultation marked completed.",
                            )
                          }
                        >
                          Mark completed
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            <PageControls
              next={data.data.nextBookings}
              cursor={bookedCursor}
              setCursor={setBookedCursor}
            />
          </section>
          <section>
            <SectionHeading title="Available sessions">
              Times shown in {me.timezone}. Availability is checked again when
              you book.
            </SectionHeading>
            <div className="workflow-toolbar">
              <label>
                Institution
                <select
                  value={school}
                  onChange={(event) => {
                    setSchool(event.target.value);
                    setCursor(undefined);
                  }}
                >
                  <option value="">All accessible institutions</option>
                  {institutions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!data.data.slots.length && (
              <EmptyState title="No sessions available right now">
                Check another institution or come back when an advisor publishes
                more times.
              </EmptyState>
            )}
            {data.data.slots.map((item) => {
              const acceptedProjects = projectOptions.filter((project) =>
                data.data!.mentorships.some(
                  (mentorship) =>
                    mentorship.state === "accepted" &&
                    mentorship.mentorId === item.hostId &&
                    mentorship.projectId === project.value,
                ),
              );
              return (
                <article className="slot-result" key={item.id}>
                  <div>
                    <strong>{dateTime(item.startsAt, me.timezone)}</strong>
                    <p>Until {dateTime(item.endsAt, me.timezone)}</p>
                    <p>{item.location}</p>
                    <span className="workflow-caption">
                      {
                        institutions.find(
                          (school) => school.id === item.institutionId,
                        )?.name
                      }
                      {item.hostId === me.id ? " · You are hosting" : ""}
                    </span>
                  </div>
                  <div className="record-actions">
                    {item.hostId === me.id ? (
                      <button
                        className="button secondary"
                        onClick={() =>
                          action.open(
                            {
                              title: "Close this unbooked slot?",
                              description:
                                "Students will no longer be able to book this time. A booked session must be cancelled separately.",
                              label: "Close slot",
                              fields: [],
                              run: async (_values, key) => {
                                await unwrap(
                                  api!.POST(
                                    "/v1/consultation-slots/{id}/close",
                                    {
                                      params: {
                                        path: { id: item.id },
                                        header: { "Idempotency-Key": key },
                                      },
                                    },
                                  ),
                                );
                              },
                            },
                            "Consultation slot closed.",
                          )
                        }
                      >
                        Close slot
                      </button>
                    ) : (
                      <button
                        className="button primary"
                        disabled={!acceptedProjects.length}
                        onClick={() =>
                          action.open(
                            {
                              title: "Book a consultation",
                              description: `${dateTime(item.startsAt, me.timezone)} to ${dateTime(item.endsAt, me.timezone)} (${me.timezone}). ${item.location}. You must be an accepted member of the selected project and free at this time.`,
                              label: "Book consultation",
                              fields: [
                                {
                                  name: "projectId",
                                  label: "Project",
                                  type: "select",
                                  options: acceptedProjects,
                                },
                                {
                                  name: "topic",
                                  label: "What would you like help with?",
                                  type: "textarea",
                                  maxLength: 2000,
                                },
                              ],
                              run: async (values, key) => {
                                await unwrap(
                                  api!.POST("/v1/consultations", {
                                    params: {
                                      header: { "Idempotency-Key": key },
                                    },
                                    body: {
                                      slotId: item.id,
                                      projectId: values.projectId,
                                      topic: values.topic.trim(),
                                    },
                                  }),
                                );
                              },
                            },
                            "Consultation booked. Your saved receipt is above.",
                          )
                        }
                      >
                        {acceptedProjects.length
                          ? "Book session"
                          : "Accepted mentorship required"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {!projectOptions.length && (
              <p className="workflow-caption">
                Create or join a project to book a consultation.
              </p>
            )}
            <PageControls
              next={data.data.nextSlots}
              cursor={cursor}
              setCursor={setCursor}
            />
          </section>
        </>
      )}
      {action.dialog}
    </>
  );
}
