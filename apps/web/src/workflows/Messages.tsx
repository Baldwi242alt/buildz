import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import {
  api,
  unwrap,
  errorMessage,
  ServiceError,
  type Schemas,
} from "../lib/api";
import {
  dateTime,
  EmptyState,
  LoadState,
  SectionHeading,
  useRemote,
} from "./common";
import { usePolling } from "./usePolling";
import { PageControls } from "./Support";
import { useWorkflowAction } from "./useWorkflowAction";

export function Messages({
  project,
  me,
  members,
}: {
  project: Schemas["Project"];
  me: Schemas["Me"];
  members: Schemas["Member"][];
}) {
  const [cursor, setCursor] = useState<string>();
  const data = useRemote(async (signal) => {
    const result = await api!.GET("/v1/projects/{id}/messages", {
      params: { path: { id: project.id }, query: { limit: 100, cursor } },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${project.id}:${cursor}`);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [wait, setWait] = useState(0);
  const [notice, setNotice] = useState("");
  const key = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const canSend =
    project.capabilities.canMessage !== false &&
    project.lifecycle !== "archived";
  usePolling(data.reload, !cursor && !busy && !locked, 15000);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || wait || !body.trim() || !canSend) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await unwrap(
        api!.POST("/v1/projects/{id}/messages", {
          params: {
            path: { id: project.id },
            header: { "Idempotency-Key": key.current },
          },
          body: { body: body.trim() },
        }),
      );
      setBody("");
      setLocked(false);
      key.current = crypto.randomUUID();
      setCursor(undefined);
      data.reload();
      setNotice("Message sent.");
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ServiceError && failure.retryAfter)
        setWait(failure.retryAfter);
      if (
        !(failure instanceof ServiceError) ||
        failure.code === "INVALID_RESPONSE"
      )
        setLocked(true);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <>
      <SectionHeading eyebrow="THINK TOGETHER" title="Team chat">
        A private conversation for project members and assigned supervisors.
        Checks for new messages every 15 seconds while this page is visible.
      </SectionHeading>
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <>
          <PageControls
            next={data.data.next}
            cursor={cursor}
            setCursor={setCursor}
          />
          <div className="message-thread" aria-label="Project messages">
            {!data.data.items.length && (
              <EmptyState title="Start the conversation">
                Share an idea, ask a question, or help your team decide what’s
                next.
              </EmptyState>
            )}
            {[...data.data.items].reverse().map((item) => (
              <article
                className={`message-bubble ${item.senderId === me.id ? "own" : ""}`}
                key={item.id}
              >
                <div className="record-meta">
                  <strong>
                    {item.senderId === me.id
                      ? "You"
                      : members.find(
                          (member) => member.userId === item.senderId,
                        )?.displayName || "Project supervisor"}
                  </strong>
                  <time dateTime={item.createdAt}>
                    {dateTime(item.createdAt, me.timezone)}
                  </time>
                </div>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
          <form className="message-composer workflow-form" onSubmit={send}>
            <label htmlFor="team-message">
              Message your team
              <textarea
                id="team-message"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={4000}
                required
                rows={3}
                disabled={busy || locked || !canSend}
                placeholder="What’s on your mind?"
              />
            </label>
            <div className="composer-bottom">
              <span className="workflow-caption">
                {body.length}/4000 · Shared only with this project
              </span>
              <button
                className="button primary"
                disabled={busy || wait > 0 || !body.trim() || !canSend}
              >
                <Send size={16} />
                {busy
                  ? "Sending…"
                  : wait
                    ? `Try again in ${wait}s`
                    : locked
                      ? "Retry same message"
                      : "Send message"}
              </button>
            </div>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="sr-only" role="status">
                {notice}
              </p>
            )}
          </form>
          {!canSend && (
            <p className="workflow-caption">
              This conversation is read-only in your current project role or
              lifecycle.
            </p>
          )}
        </>
      )}
    </>
  );
}

const notificationLabels: Record<string, string> = {
  "proposal.submitted": "A support proposal is ready for review",
  "proposal.decided": "A support decision is ready",
  "progress.submitted": "Your team shared a progress update",
  "progress.reviewed": "Feedback is ready for your team",
  "booking.created": "A resource booking was created",
  "booking.changed": "A booking was updated",
  "consultation.booked": "A consultation was booked",
  "consultation.changed": "A consultation was updated",
  "mentorship.requested": "A mentorship request arrived",
  "mentorship.accepted": "A mentor accepted your project",
  "mentorship.declined": "A mentorship request was declined",
  "mentorship.cancelled": "A mentorship was cancelled",
  "message.created": "Your team has a new message",
  "publication.changed": "A project showcase was updated",
  "collaboration.requested": "A collaboration request arrived",
  "collaboration.decided": "A collaboration request was updated",
};
export function Notifications({ me }: { me: Schemas["Me"] }) {
  const [cursor, setCursor] = useState<string>();
  const [unread, setUnread] = useState(false);
  const data = useRemote(async (signal) => {
    const result = await api!.GET("/v1/me/notifications", {
      params: {
        query: { limit: 100, cursor, ...(unread ? { unread: true } : {}) },
      },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${me.id}:${cursor}:${unread}`);
  const action = useWorkflowAction(data.reload);
  usePolling(data.reload, !action.action && !cursor, 30000);
  return (
    <>
      <SectionHeading eyebrow="STAY IN THE LOOP" title="Your updates">
        Project activity, decisions, and messages. Updates are checked every 30
        seconds while visible.
      </SectionHeading>
      <div className="record-actions">
        <button
          className="button secondary"
          aria-pressed={unread}
          onClick={() => {
            setUnread(!unread);
            setCursor(undefined);
          }}
        >
          {unread ? "Showing unread only" : "Show unread only"}
        </button>
        <button
          className="button secondary"
          disabled={data.loading}
          onClick={data.reload}
        >
          Refresh updates
        </button>
      </div>
      {action.notice}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <>
          {data.data.items.length === 0 && (
            <EmptyState title="You’re all caught up">
              Relevant activity from your projects will appear here.
            </EmptyState>
          )}
          {data.data.items.map((item) => (
            <article
              className={`workflow-record notification-row ${item.readAt ? "read" : "unread"}`}
              key={item.id}
            >
              <div>
                <span className="workflow-caption">
                  {item.readAt ? "Read" : "Unread"} ·{" "}
                  {dateTime(item.createdAt, me.timezone)}
                </span>
                <h3>
                  {notificationLabels[item.type] ||
                    item.type.replaceAll(".", " · ").replaceAll("_", " ")}
                </h3>
                <span className="workflow-caption">
                  Reference {item.subjectId}
                </span>
                {item.type.startsWith("mentorship.") && (
                  <p>
                    <a className="workflow-inline-link" href="#/consultations">
                      View mentorship & consultations →
                    </a>
                  </p>
                )}
              </div>
              {!item.readAt && (
                <button
                  className="button secondary"
                  onClick={() =>
                    action.open(
                      {
                        title: "Mark this update as read?",
                        description:
                          "This changes only your unread status. The underlying project activity stays available.",
                        label: "Mark as read",
                        fields: [],
                        run: async (_values, key) => {
                          await unwrap(
                            api!.POST("/v1/notifications/{id}/read", {
                              params: {
                                path: { id: item.id },
                                header: { "Idempotency-Key": key },
                              },
                            }),
                          );
                        },
                      },
                      "Update marked as read.",
                    )
                  }
                >
                  Mark as read
                </button>
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
      {action.dialog}
    </>
  );
}
