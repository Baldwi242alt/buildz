import { useState } from "react";
import { api, unwrap, type Schemas } from "../lib/api";
import {
  dateTime,
  EmptyState,
  integer,
  LoadState,
  SectionHeading,
  StateLabel,
  useRemote,
} from "./common";
import { PageControls } from "./Support";
import { useWorkflowAction } from "./useWorkflowAction";

export function Review({ me }: { me: Schemas["Me"] }) {
  const [cursor, setCursor] = useState<string>();
  const workspace = useRemote(async (signal) => {
    const projects = await unwrap(
      api!.GET("/v1/review/projects", {
        params: { query: { limit: 100 } },
        signal,
      }),
    );
    const schoolIds = [
      ...new Set(
        me.roles
          .filter((role) =>
            ["institution_admin", "reviewer"].includes(role.role),
          )
          .map((role) => role.institutionId),
      ),
    ];
    const staff = await Promise.all(
      schoolIds.map(async (id) => ({
        id,
        people: await unwrap(
          api!.GET("/v1/institutions/{id}/staff", {
            params: { path: { id } },
            signal,
          }),
        ),
      })),
    );
    return { projects, staff };
  }, me.id);
  const data = useRemote(async (signal) => {
    const result = await api!.GET("/v1/review/proposals", {
      params: { query: { cursor, limit: 100 } },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${me.id}:${cursor}`);
  const action = useWorkflowAction(data.reload);
  return (
    <>
      <SectionHeading
        eyebrow="HELP GOOD IDEAS MOVE FORWARD"
        title="Proposal review"
      >
        Review the request, explain the decision, and grant only the support
        your school can provide.
      </SectionHeading>
      {action.notice}
      {workspace.loading && !workspace.data && (
        <p className="workflow-caption" role="status">
          Loading the authorized project and staff directory before review…
        </p>
      )}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <>
          {!data.data.items.length && (
            <EmptyState title="The queue is clear">
              New proposals from projects you can review will appear here.
            </EmptyState>
          )}
          {data.data.items.map((item) => (
            <article className="workflow-record" key={item.id}>
              <StateLabel state={item.state} />
              <h3>{item.objectives}</h3>
              <p>{item.supportRequested}</p>
              <div className="record-meta">
                <span>{item.minutesRequested} minutes requested</span>
                <time dateTime={item.createdAt}>
                  {dateTime(item.createdAt, me.timezone)}
                </time>
              </div>
              <a
                className="workflow-inline-link"
                href={`#/projects/${item.projectId}/progress`}
              >
                View project progress →
              </a>
              <div className="record-actions">
                {(["approved", "changes_requested", "rejected"] as const).map(
                  (decision) => (
                    <button
                      key={decision}
                      disabled={item.authorId === me.id || !workspace.data}
                      className={`button ${decision === "approved" ? "primary" : "secondary"}`}
                      onClick={() =>
                        action.open(
                          {
                            title:
                              decision === "approved"
                                ? "Approve this proposal?"
                                : decision === "rejected"
                                  ? "Reject this proposal?"
                                  : "Request changes",
                            description:
                              "The decision and your explanation will be saved and shared with the team. This does not create a resource reservation.",
                            label:
                              decision === "approved"
                                ? "Approve proposal"
                                : decision === "rejected"
                                  ? "Reject proposal"
                                  : "Request changes",
                            fields: [
                              {
                                name: "reason",
                                label: "Decision and next steps",
                                type: "textarea",
                                maxLength: 2000,
                              },
                              ...(decision === "approved"
                                ? [
                                    {
                                      name: "minutesGranted",
                                      label: "Time allowance granted (minutes)",
                                      type: "number" as const,
                                      initial: String(item.minutesRequested),
                                      min: 0,
                                      max: 100000,
                                    },
                                    {
                                      name: "supervisorId",
                                      label: "Supervisor (optional)",
                                      type: "select" as const,
                                      optional: true,
                                      options: [
                                        {
                                          value: "",
                                          label: "No supervisor assigned",
                                        },
                                        ...(
                                          workspace.data?.staff.find(
                                            (school) =>
                                              school.id ===
                                              workspace.data?.projects.find(
                                                (project) =>
                                                  project.id === item.projectId,
                                              )?.leadInstitutionId,
                                          )?.people || []
                                        ).map((person) => ({
                                          value: person.userId,
                                          label: person.displayName,
                                        })),
                                      ],
                                      hint: "Verified staff of the project’s lead institution. The server checks eligibility again.",
                                    },
                                  ]
                                : []),
                            ],
                            run: async (values, key) => {
                              await unwrap(
                                api!.POST("/v1/proposals/{id}/decisions", {
                                  params: {
                                    path: { id: item.id },
                                    header: { "Idempotency-Key": key },
                                  },
                                  body: {
                                    version: item.version,
                                    decision,
                                    reason: values.reason.trim(),
                                    ...(decision === "approved"
                                      ? {
                                          minutesGranted: integer(
                                            values.minutesGranted,
                                            "Granted minutes",
                                            0,
                                            100000,
                                          ),
                                          ...(values.supervisorId
                                            ? {
                                                supervisorId:
                                                  values.supervisorId,
                                              }
                                            : {}),
                                        }
                                      : {}),
                                  },
                                }),
                              );
                            },
                          },
                          "Proposal decision saved and shared with the team.",
                        )
                      }
                    >
                      {decision === "approved"
                        ? "Approve"
                        : decision === "rejected"
                          ? "Reject"
                          : "Request changes"}
                    </button>
                  ),
                )}
              </div>
              {item.authorId === me.id && (
                <p className="workflow-caption">
                  Another staff member must review your own proposal.
                </p>
              )}
            </article>
          ))}
          <PageControls
            next={data.data.next}
            cursor={cursor}
            setCursor={setCursor}
          />
        </>
      )}
      <section>
        <SectionHeading title="Projects you support">
          Open a project to read its progress journal and provide feedback. Only
          authorized review projects are shown.
        </SectionHeading>
        <LoadState
          loading={workspace.loading && !workspace.data}
          error={workspace.error}
          retry={workspace.reload}
        />
        {workspace.data?.projects.map((project) => (
          <article className="workflow-record" key={project.id}>
            <h3>{project.title}</h3>
            <p>{project.summary}</p>
            <a
              className="workflow-inline-link"
              href={`#/projects/${project.id}/progress`}
            >
              Review progress →
            </a>
          </article>
        ))}
      </section>
      <Moderation me={me} />
      {action.dialog}
    </>
  );
}

function Moderation({ me }: { me: Schemas["Me"] }) {
  const [cursor, setCursor] = useState<string>();
  const data = useRemote(async (signal) => {
    const result = await api!.GET("/v1/review/reports", {
      params: { query: { limit: 100, cursor } },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${me.id}:${cursor}`);
  const action = useWorkflowAction(data.reload);
  return (
    <section>
      <SectionHeading title="Reported public content">
        Review concerns fairly. Removing a showcase does not delete the private
        project.
      </SectionHeading>
      {action.notice}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data?.items.length === 0 && (
        <p className="workflow-caption">
          No pending reports in your review scope.
        </p>
      )}
      {data.data?.items.map((item) => (
        <article className="workflow-record" key={item.id}>
          <h3>Showcase report</h3>
          <p>{item.reason}</p>
          <a
            className="workflow-inline-link"
            href={`#/showcase/${item.projectId}`}
          >
            Review the public showcase →
          </a>
          <div className="record-actions">
            {(["dismissed", "removed"] as const).map((decision) => (
              <button
                key={decision}
                className="button secondary"
                onClick={() =>
                  action.open(
                    {
                      title:
                        decision === "removed"
                          ? "Remove this public showcase?"
                          : "Dismiss this report?",
                      description:
                        decision === "removed"
                          ? "The showcase will be unpublished. Private project records stay intact."
                          : "The report will be closed without changing the public showcase.",
                      label:
                        decision === "removed"
                          ? "Remove showcase"
                          : "Dismiss report",
                      fields: [],
                      run: async (_values, key) => {
                        await unwrap(
                          api!.POST("/v1/reports/{id}/decisions", {
                            params: {
                              path: { id: item.id },
                              header: { "Idempotency-Key": key },
                            },
                            body: { decision },
                          }),
                        );
                      },
                    },
                    "Content report decision saved.",
                  )
                }
              >
                {decision === "removed" ? "Remove showcase" : "Dismiss report"}
              </button>
            ))}
          </div>
        </article>
      ))}
      {data.data && (
        <PageControls
          next={data.data.next}
          cursor={cursor}
          setCursor={setCursor}
        />
      )}
      {action.dialog}
    </section>
  );
}
