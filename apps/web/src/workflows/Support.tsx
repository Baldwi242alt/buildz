import { useState } from "react";
import { Plus } from "lucide-react";
import { api, unwrap, ServiceError, type Schemas } from "../lib/api";
import {
  dateTime,
  EmptyState,
  integer,
  LoadState,
  SectionHeading,
  StateLabel,
  useRemote,
} from "./common";
import { useWorkflowAction } from "./useWorkflowAction";
import { evidenceLinks, safeHttps } from "./evidence";
import { FileUpload, FileDownload } from "./Files";

type Project = Schemas["Project"];
type Me = Schemas["Me"];
export function Support({ project, me }: { project: Project; me: Me }) {
  const [cursor, setCursor] = useState<string>();
  const data = useRemote(async (signal) => {
    const result = await api!.GET("/v1/projects/{id}/proposals", {
      params: { path: { id: project.id }, query: { limit: 100, cursor } },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${project.id}:${cursor}`);
  const action = useWorkflowAction(data.reload);
  const approved =
    data.data?.items.filter((item) => item.state === "approved") ?? [];
  return (
    <>
      <SectionHeading
        eyebrow="A LITTLE BACKING GOES A LONG WAY"
        title="Support for your idea"
        action={
          project.capabilities.canSubmitProposal && (
            <button
              className="button primary"
              onClick={() =>
                action.open(
                  {
                    title: "Request project support",
                    description:
                      "Tell your school what you want to achieve and what help would make a difference. Staff will review this proposal before granting support.",
                    label: "Send proposal",
                    fields: [
                      {
                        name: "objectives",
                        label: "What will your project achieve?",
                        type: "textarea",
                        maxLength: 5000,
                      },
                      {
                        name: "supportRequested",
                        label: "What support do you need?",
                        type: "textarea",
                        maxLength: 3000,
                      },
                      {
                        name: "minutesRequested",
                        label: "Time allowance requested (minutes)",
                        type: "number",
                        initial: "0",
                        min: 0,
                        max: 100000,
                        hint: "A request is not an approved allowance. Enter 0 if you only need other support.",
                      },
                    ],
                    run: async (values, key) => {
                      await unwrap(
                        api!.POST("/v1/projects/{id}/proposals", {
                          params: {
                            path: { id: project.id },
                            header: { "Idempotency-Key": key },
                          },
                          body: {
                            objectives: values.objectives.trim(),
                            supportRequested: values.supportRequested.trim(),
                            minutesRequested: integer(
                              values.minutesRequested,
                              "Requested minutes",
                              0,
                              100000,
                            ),
                          },
                        }),
                      );
                    },
                  },
                  "Proposal sent to your school for review.",
                )
              }
            >
              <Plus size={17} />
              Request support
            </button>
          )
        }
      >
        Make the ask clear. Keep the decision—and the next step—in one place.
      </SectionHeading>
      {action.notice}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <div className="workflow-layout">
          <div className="workflow-main">
            {!data.data.items.length && (
              <EmptyState title="Give your school the bigger picture">
                A proposal explains your aims, the support you need, and the
                time you’re requesting. Project owners and editors can send one.
              </EmptyState>
            )}
            {data.data.items.map((item) => (
              <article className="workflow-record" key={item.id}>
                <StateLabel state={item.state} />
                <h3>{item.objectives}</h3>
                <p>{item.supportRequested}</p>
                <div className="record-meta">
                  <span>{item.minutesRequested} minutes requested</span>
                  <span>Sent {dateTime(item.createdAt, me.timezone)}</span>
                </div>
                {item.decisionReason && (
                  <div className="workflow-notice">
                    <strong>Staff feedback</strong>
                    <p>{item.decisionReason}</p>
                    {item.state === "approved" && (
                      <p>
                        {item.minutesGranted} minutes granted
                        {item.supervisorId
                          ? " · A supervisor has been assigned."
                          : ""}
                      </p>
                    )}
                  </div>
                )}
                {item.state === "changes_requested" && (
                  <p className="workflow-caption">
                    Use the feedback to send a revised proposal. Your earlier
                    proposal stays in the history.
                  </p>
                )}
              </article>
            ))}
            <PageControls
              next={data.data.next}
              cursor={cursor}
              setCursor={setCursor}
            />
          </div>
          <aside className="workflow-aside">
            <h3>Make the request useful.</h3>
            <p>
              Explain the outcome, who benefits, and what you need to move
              forward. Specific requests are easier to review.
            </p>
            <dl>
              <dt>Approved proposals on this page</dt>
              <dd>{approved.length}</dd>
              <dt>Granted time on this page</dt>
              <dd>
                {approved.reduce((sum, item) => sum + item.minutesGranted, 0)}{" "}
                minutes
              </dd>
            </dl>
            <p className="workflow-caption">
              A grant is a staff decision, not a booking or a remaining balance.
              Plan reservations separately.
            </p>
          </aside>
        </div>
      )}
      {action.dialog}
    </>
  );
}

export function PageControls({
  next,
  cursor,
  setCursor,
}: {
  next?: string | null;
  cursor?: string;
  setCursor: (value: string | undefined) => void;
}) {
  return next || cursor ? (
    <div className="record-actions" aria-label="Pagination">
      {cursor && (
        <button
          className="button secondary"
          onClick={() => setCursor(undefined)}
        >
          Back to newest
        </button>
      )}
      {next && (
        <button className="button secondary" onClick={() => setCursor(next)}>
          Next page
        </button>
      )}
    </div>
  ) : null;
}

export function Progress({
  project,
  me,
  members,
  filesAvailable = false,
}: {
  project: Project;
  me: Me;
  members: Schemas["Member"][];
  filesAvailable?: boolean;
}) {
  const [cursor, setCursor] = useState<string>();
  const data = useRemote(async (signal) => {
    const result = await api!.GET("/v1/projects/{id}/progress", {
      params: { path: { id: project.id }, query: { limit: 100, cursor } },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${project.id}:${cursor}`);
  const action = useWorkflowAction(data.reload);
  const isMember = members.some((member) => member.userId === me.id);
  const [uploading, setUploading] = useState(false);
  const files = useRemote(
    (signal) =>
      filesAvailable
        ? unwrap(
            api!.GET("/v1/projects/{id}/files", {
              params: { path: { id: project.id }, query: { limit: 100 } },
              signal,
            }),
          )
        : Promise.resolve([]),
    `${project.id}:${filesAvailable}`,
  );
  const reviewer = project.capabilities.canReviewProgress === true;
  return (
    <>
      <SectionHeading
        eyebrow="THE SMALL STEPS COUNT"
        title="Your progress journal"
        action={
          isMember &&
          project.lifecycle !== "archived" && (
            <button
              className="button primary"
              onClick={() =>
                action.open(
                  {
                    title: "Share a progress update",
                    description:
                      "Describe what changed, record your time, and choose the evidence to share with your team and authorized reviewers. Only successfully saved files can be attached.",
                    label: "Share update",
                    fields: [
                      {
                        name: "summary",
                        label: "What did you work on?",
                        type: "textarea",
                        maxLength: 5000,
                      },
                      {
                        name: "minutesSpent",
                        label: "Time spent (minutes)",
                        type: "number",
                        initial: "0",
                        min: 0,
                        max: 100000,
                      },
                      {
                        name: "evidence",
                        label: "Evidence links (optional)",
                        type: "textarea",
                        optional: true,
                        maxLength: 10000,
                        hint: "One HTTPS link per line, up to 5. Make sure intended reviewers can access the source. Do not include private access tokens.",
                      },
                      ...(files.data || []).map((file) => ({
                        name: `file-${file.id}`,
                        label: `Attach ${file.name}`,
                        type: "checkbox" as const,
                        optional: true,
                      })),
                    ],
                    run: async (values, key) => {
                      const evidence: Schemas["Evidence"][] = evidenceLinks(
                        values.evidence,
                      ).map((url, index) => ({
                        url,
                        label: `Evidence ${index + 1}`,
                        kind: "link" as const,
                      }));
                      for (const file of files.data || [])
                        if (values[`file-${file.id}`] === "true")
                          evidence.push({
                            fileId: file.id,
                            label: file.name,
                            kind: file.mimeType.startsWith("image/")
                              ? "photo"
                              : "document",
                          });
                      if (evidence.length > 10)
                        throw new ServiceError(
                          "Attach no more than 10 evidence items to one update.",
                          "VALIDATION_ERROR",
                        );
                      await unwrap(
                        api!.POST("/v1/projects/{id}/progress", {
                          params: {
                            path: { id: project.id },
                            header: { "Idempotency-Key": key },
                          },
                          body: {
                            summary: values.summary.trim(),
                            minutesSpent: integer(
                              values.minutesSpent,
                              "Time spent",
                              0,
                              100000,
                            ),
                            evidence,
                          },
                        }),
                      );
                    },
                  },
                  "Progress update shared with your team and reviewers.",
                )
              }
            >
              <Plus size={17} />
              Share update
            </button>
          )
        }
      >
        Capture what you tried, what you learned, and where you need a hand.
      </SectionHeading>
      {action.notice}
      {filesAvailable && (
        <div className="record-actions">
          {isMember && project.lifecycle !== "archived" && (
            <button
              className="button secondary"
              onClick={() => setUploading(true)}
            >
              Upload evidence file
            </button>
          )}
          <span className="workflow-caption">
            Private uploads are separate from progress submission.
          </span>
        </div>
      )}
      {files.error && (
        <p className="error-message" role="alert">
          Evidence files: {files.error}
        </p>
      )}
      {uploading && (
        <FileUpload
          projectId={project.id}
          onClose={() => setUploading(false)}
          onUploaded={() => files.reload()}
        />
      )}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <>
          {!data.data.items.length && (
            <EmptyState title="Every step is worth recording">
              Share your first update when you have something to show or a
              question to work through.
            </EmptyState>
          )}
          {data.data.items.map((item) => (
            <ProgressEntry
              key={item.id}
              item={item}
              me={me}
              reviewer={reviewer}
              author={
                members.find((member) => member.userId === item.authorId)
                  ?.displayName
              }
            />
          ))}
          <PageControls
            next={data.data.next}
            cursor={cursor}
            setCursor={setCursor}
          />
        </>
      )}
      {action.dialog}
    </>
  );
}

export function ProgressEntry({
  item,
  me,
  reviewer,
  author,
}: {
  item: Schemas["Progress"];
  me: Me;
  reviewer: boolean;
  author?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const reviews = useRemote(
    (signal) =>
      expanded
        ? unwrap(
            api!.GET("/v1/progress/{id}/reviews", {
              params: { path: { id: item.id } },
              signal,
            }),
          )
        : Promise.resolve([]),
    `${item.id}:${expanded}`,
  );
  const action = useWorkflowAction(reviews.reload);
  return (
    <article className="workflow-record">
      <div className="record-meta">
        <strong>{author || "Project contributor"}</strong>
        <time dateTime={item.createdAt}>
          {dateTime(item.createdAt, me.timezone)}
        </time>
        <span>{item.minutesSpent} minutes</span>
      </div>
      <p>{item.summary}</p>
      {item.evidence.length > 0 && (
        <ul className="evidence-list">
          {item.evidence.map((evidence, index) => (
            <li key={index}>
              {evidence.fileId ? (
                <FileDownload fileId={evidence.fileId} label={evidence.label} />
              ) : evidence.url && safeHttps(evidence.url) ? (
                <a
                  className="workflow-inline-link"
                  href={safeHttps(evidence.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {evidence.label} ↗{" "}
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <span>Evidence link unavailable</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="record-actions">
        <button
          className="button secondary"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide feedback" : "View feedback"}
        </button>
        {reviewer && item.authorId !== me.id && (
          <button
            className="button secondary"
            onClick={() =>
              action.open(
                {
                  title: "Review progress",
                  description:
                    "Your feedback is visible to the project team. Acknowledge progress or explain what needs attention.",
                  label: "Save feedback",
                  fields: [
                    {
                      name: "outcome",
                      label: "Review outcome",
                      type: "select",
                      options: [
                        { value: "acknowledged", label: "Acknowledged" },
                        { value: "needs_attention", label: "Needs attention" },
                      ],
                    },
                    {
                      name: "feedback",
                      label: "Feedback for the team",
                      type: "textarea",
                      maxLength: 3000,
                    },
                  ],
                  run: async (values, key) => {
                    await unwrap(
                      api!.POST("/v1/progress/{id}/reviews", {
                        params: {
                          path: { id: item.id },
                          header: { "Idempotency-Key": key },
                        },
                        body: {
                          feedback: values.feedback.trim(),
                          outcome: values.outcome as
                            "acknowledged" | "needs_attention",
                        },
                      }),
                    );
                    setExpanded(true);
                  },
                },
                "Feedback saved.",
              )
            }
          >
            Give feedback
          </button>
        )}
      </div>
      {action.notice}
      {expanded && (
        <div className="feedback-thread">
          <LoadState
            loading={reviews.loading && !reviews.data}
            error={reviews.error}
            retry={reviews.reload}
          />
          {reviews.data?.length === 0 && (
            <p className="workflow-caption">No feedback yet.</p>
          )}
          {reviews.data?.map((review) => (
            <div className="workflow-notice" key={review.id}>
              <StateLabel state={review.outcome} />
              <p>{review.feedback}</p>
              <span className="workflow-caption">
                {dateTime(review.createdAt, me.timezone)}
              </span>
            </div>
          ))}
        </div>
      )}
      {action.dialog}
    </article>
  );
}
