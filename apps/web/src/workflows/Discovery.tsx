import { useState, type FormEvent } from "react";
import { ArrowUpRight, Globe, Search, ShieldCheck } from "lucide-react";
import { api, unwrap, ServiceError, type Schemas } from "../lib/api";
import {
  dateTime,
  EmptyState,
  LoadState,
  SectionHeading,
  StateLabel,
  useRemote,
} from "./common";
import { useWorkflowAction } from "./useWorkflowAction";
import { PageControls } from "./Support";
import { Brand } from "../components/ui";
import { RequestMentorship } from "./Mentorship";

export function Discover({
  me,
  projectId,
  onSignIn,
}: {
  me?: Schemas["Me"];
  projectId?: string;
  onSignIn?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [cursor, setCursor] = useState<string>();
  const data = useRemote(async (signal) => {
    if (!api)
      throw new ServiceError(
        "BuildZ’s service address is not configured.",
        "NOT_CONFIGURED",
      );
    if (projectId)
      return {
        items: [
          await unwrap(
            api.GET("/v1/public/projects/{id}", {
              params: { path: { id: projectId } },
              signal,
            }),
          ),
        ],
        next: null,
      };
    const result = await api.GET("/v1/public/projects", {
      params: {
        query: {
          limit: 24,
          cursor,
          ...(query ? { search: query } : {}),
          ...(category
            ? {
                projectType:
                  category as Schemas["PublicProject"]["projectType"],
              }
            : {}),
        },
      },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${projectId}:${query}:${category}:${cursor}`);
  const action = useWorkflowAction(data.reload);
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery(draft.trim());
    setCursor(undefined);
  }
  return (
    <>
      {projectId ? (
        <a className="workflow-inline-link" href="#/discover">
          ← All public projects
        </a>
      ) : (
        <SectionHeading
          eyebrow="GOOD IDEAS DON’T STOP AT ONE CAMPUS"
          title="Find your kind of project"
        >
          Explore what students choose to share. Public showcases never expose
          their private workspace.
        </SectionHeading>
      )}
      {!projectId && (
        <form className="workflow-toolbar" onSubmit={submitSearch}>
          <label>
            Search public projects
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={100}
              placeholder="A topic, idea, or project name"
            />
          </label>
          <label>
            Project type
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setCursor(undefined);
              }}
            >
              <option value="">All types</option>
              {[
                "community",
                "creative",
                "engineering",
                "business",
                "other",
              ].map((type) => (
                <option key={type} value={type}>
                  {type[0].toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary">
            <Search size={16} />
            Search
          </button>
          {(query || category) && (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setDraft("");
                setQuery("");
                setCategory("");
                setCursor(undefined);
              }}
            >
              Clear filters
            </button>
          )}
        </form>
      )}
      {action.notice}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <>
          {!data.data.items.length && (
            <EmptyState
              title={
                query || category
                  ? "No projects match yet"
                  : "A place for what comes next"
              }
            >
              {query || category
                ? "Try a broader topic or clear your filters."
                : "Student projects will appear here when their owners publish a showcase."}
            </EmptyState>
          )}
          <div className={projectId ? "public-detail" : "discovery-grid"}>
            {data.data.items.map((item) => (
              <article className="discovery-project" key={item.id}>
                {!projectId && (
                  <div
                    className={`discovery-cover discovery-${item.projectType}`}
                    aria-hidden="true"
                  >
                    <span>{item.projectType}</span>
                    <ArrowUpRight size={42} />
                    <strong>{item.title}</strong>
                  </div>
                )}
                <div className="discovery-body">
                  <span className="eyebrow">
                    {item.projectType} · PUBLIC SHOWCASE
                  </span>
                  {projectId ? (
                    <h1>{item.title}</h1>
                  ) : (
                    <h2>
                      <a href={`#/showcase/${item.id}`}>{item.title}</a>
                    </h2>
                  )}
                  <p className="public-summary">{item.summary}</p>
                  {item.tags.length > 0 && (
                    <ul className="tag-list" aria-label="Project topics">
                      {item.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  )}
                  {item.seeking && (
                    <div className="seeking">
                      <strong>Looking for</strong>
                      <p>{item.seeking}</p>
                    </div>
                  )}
                  {projectId ? (
                    <>
                      <div className="record-actions">
                        {me ? (
                          <RequestMentorship projectId={item.id} />
                        ) : (
                          <button
                            className="button secondary"
                            onClick={onSignIn}
                          >
                            Request for mentorship
                          </button>
                        )}
                        {me ? (
                          (["join", "advice"] as const).map((kind) => (
                            <button
                              className={`button ${kind === "join" ? "primary" : "secondary"}`}
                              key={kind}
                              onClick={() =>
                                action.open(
                                  {
                                    title:
                                      kind === "join"
                                        ? "Ask to join this project"
                                        : "Send an advice request",
                                    description:
                                      kind === "join"
                                        ? "Introduce yourself to the project owner. If they accept, you’ll join as a member with access to private project content. Sending this request is your consent to join if accepted."
                                        : "Send a question to the project owner. An accepted advice request does not grant project membership.",
                                    label:
                                      kind === "join"
                                        ? "Send join request"
                                        : "Send advice request",
                                    fields: [
                                      {
                                        name: "message",
                                        label:
                                          kind === "join"
                                            ? "Introduce yourself and how you’d like to help"
                                            : "What would you like to ask?",
                                        type: "textarea",
                                        maxLength: 2000,
                                      },
                                    ],
                                    run: async (values, key) => {
                                      await unwrap(
                                        api!.POST(
                                          "/v1/public/projects/{id}/collaboration-requests",
                                          {
                                            params: {
                                              path: { id: item.id },
                                              header: {
                                                "Idempotency-Key": key,
                                              },
                                            },
                                            body: {
                                              kind,
                                              message: values.message.trim(),
                                            },
                                          },
                                        ),
                                      );
                                    },
                                  },
                                  "Request sent. Follow its status in Collaboration.",
                                )
                              }
                            >
                              {kind === "join"
                                ? "Ask to join"
                                : "Ask for advice"}
                            </button>
                          ))
                        ) : (
                          <button className="button primary" onClick={onSignIn}>
                            Sign in to collaborate
                          </button>
                        )}
                      </div>
                      <p className="workflow-caption">
                        <ShieldCheck size={14} /> Only the owner’s chosen
                        showcase content is public. Updated{" "}
                        {dateTime(item.updatedAt, me?.timezone)}.
                      </p>
                      {me && (
                        <button
                          className="text-button"
                          onClick={() =>
                            action.open(
                              {
                                title: "Report this showcase",
                                description:
                                  "Describe the concern for the school’s reviewers. A report does not automatically remove content.",
                                label: "Send report",
                                fields: [
                                  {
                                    name: "reason",
                                    label: "What should the reviewers know?",
                                    type: "textarea",
                                    maxLength: 2000,
                                  },
                                ],
                                run: async (values, key) => {
                                  await unwrap(
                                    api!.POST(
                                      "/v1/public/projects/{id}/reports",
                                      {
                                        params: {
                                          path: { id: item.id },
                                          header: { "Idempotency-Key": key },
                                        },
                                        body: { reason: values.reason.trim() },
                                      },
                                    ),
                                  );
                                },
                              },
                              "Report sent to the authorized reviewers.",
                            )
                          }
                        >
                          Report a concern
                        </button>
                      )}
                    </>
                  ) : (
                    <a
                      className="workflow-inline-link"
                      href={`#/showcase/${item.id}`}
                    >
                      Explore this project →
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
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

export function PublicExperience({
  projectId,
  onSignIn,
}: {
  projectId?: string;
  onSignIn: () => void;
}) {
  return (
    <div className="public-shell">
      <header>
        <a href="#/discover" aria-label="BuildZ public projects">
          <Brand />
        </a>
        <button className="button secondary" onClick={onSignIn}>
          Sign in
        </button>
      </header>
      <main>
        <Discover projectId={projectId} onSignIn={onSignIn} />
      </main>
      <footer className="page-footer">
        <Brand />
        <span>Good ideas, shared thoughtfully.</span>
      </footer>
    </div>
  );
}

export function Showcase({
  project,
  me,
  onChanged,
}: {
  project: Schemas["Project"];
  me: Schemas["Me"];
  onChanged: () => void;
}) {
  const data = useRemote(
    async (signal) =>
      project.publicationAudience === "public"
        ? unwrap(
            api!.GET("/v1/public/projects/{id}", {
              params: { path: { id: project.id } },
              signal,
            }),
          )
        : null,
    `${project.id}:${project.version}`,
  );
  const action = useWorkflowAction(() => {
    data.reload();
    onChanged();
  });
  const owner = project.ownerId === me.id;
  return (
    <>
      <SectionHeading
        eyebrow="YOUR STORY. YOUR CHOICE."
        title="A window into your project"
      >
        Publish a separate, deliberately written showcase. Your messages,
        proposals, evidence, bookings, and member details stay private.
      </SectionHeading>
      {action.notice}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      <div className="workflow-layout">
        <div>
          <div className="workflow-notice">
            <Globe size={20} />
            <strong>
              {project.publicationAudience === "public"
                ? "Your showcase is public."
                : "Your project is private."}
            </strong>
            <p>
              {project.publicationAudience === "public"
                ? "Anyone with the link can read the selected showcase. You can update it or take it offline."
                : "Nothing appears in discovery until you explicitly publish."}
            </p>
          </div>
          {data.data && (
            <article className="workflow-receipt">
              <h3>{data.data.title}</h3>
              <p className="public-summary">{data.data.summary}</p>
              <p className="workflow-caption">{data.data.seeking}</p>
              <a
                className="workflow-inline-link"
                href={`#/showcase/${project.id}`}
              >
                View public showcase →
              </a>
              <label className="invitation-link">
                Shareable showcase link
                <input
                  readOnly
                  value={data.data.shareUrl}
                  onFocus={(event) => event.target.select()}
                />
              </label>
            </article>
          )}
          <div className="record-actions">
            {project.capabilities.canPublish && (
              <button
                className="button primary"
                onClick={() =>
                  action.open(
                    {
                      title:
                        project.publicationAudience === "public"
                          ? "Update your public showcase"
                          : "Publish a project showcase",
                      description:
                        "Review every field below. Only this title, summary, topics, collaboration preferences and project type become public. Do not include private names or sensitive information without permission.",
                      label:
                        project.publicationAudience === "public"
                          ? "Update public showcase"
                          : "Publish showcase",
                      fields: [
                        {
                          name: "title",
                          label: "Public title",
                          initial: data.data?.title || project.title,
                          maxLength: 150,
                        },
                        {
                          name: "summary",
                          label: "Public summary",
                          type: "textarea",
                          initial: data.data?.summary || "",
                          maxLength: 2000,
                        },
                        {
                          name: "tags",
                          label: "Topics (optional)",
                          initial: data.data?.tags.join(", ") || "",
                          optional: true,
                          maxLength: 400,
                          hint: "Up to 10 topics, separated by commas.",
                        },
                        {
                          name: "seeking",
                          label: "Who or what are you looking for? (optional)",
                          initial: data.data?.seeking || "",
                          type: "textarea",
                          optional: true,
                          maxLength: 1000,
                        },
                        {
                          name: "consent",
                          label:
                            "I have reviewed these fields and want them to be public",
                          type: "checkbox",
                        },
                      ],
                      run: async (values, key) => {
                        const tags = [
                          ...new Set(
                            values.tags
                              .split(",")
                              .map((tag) => tag.trim())
                              .filter(Boolean),
                          ),
                        ];
                        if (
                          tags.length > 10 ||
                          tags.some((tag) => tag.length > 40)
                        )
                          throw new ServiceError(
                            "Use up to 10 topics, each no longer than 40 characters.",
                            "VALIDATION_ERROR",
                          );
                        await unwrap(
                          api!.POST("/v1/projects/{id}/publication", {
                            params: {
                              path: { id: project.id },
                              header: { "Idempotency-Key": key },
                            },
                            body: {
                              version: project.version,
                              title: values.title.trim(),
                              summary: values.summary.trim(),
                              tags,
                              seeking: values.seeking.trim(),
                            },
                          }),
                        );
                      },
                    },
                    "Public showcase saved.",
                  )
                }
              >
                {project.publicationAudience === "public"
                  ? "Edit showcase"
                  : "Create a showcase"}
              </button>
            )}
            {owner && project.publicationAudience === "public" && (
              <button
                className="button secondary"
                onClick={() =>
                  action.open(
                    {
                      title: "Take this showcase offline?",
                      description:
                        "The public page will no longer be available. Your private project and existing accepted members remain unchanged.",
                      label: "Unpublish showcase",
                      fields: [],
                      run: async (_values, key) => {
                        await unwrap(
                          api!.POST("/v1/projects/{id}/unpublish", {
                            params: {
                              path: { id: project.id },
                              header: { "Idempotency-Key": key },
                            },
                            body: { version: project.version },
                          }),
                        );
                      },
                    },
                    "Showcase taken offline.",
                  )
                }
              >
                Unpublish showcase
              </button>
            )}
          </div>
          {owner && (
            <Collaboration
              me={me}
              projectId={project.id}
              onChanged={onChanged}
            />
          )}
        </div>
        <aside className="workflow-aside">
          <h3>Share the idea, not the entire workspace.</h3>
          <p>
            The showcase is separate from your private summary. Editing your
            project does not silently rewrite your public story.
          </p>
          <p className="workflow-caption">
            People can ask to join or request advice. You choose what to accept.
            Joining grants member access—not editing or ownership.
          </p>
        </aside>
      </div>
      {action.dialog}
    </>
  );
}

export function CollaborationHub({
  me,
  projects,
  onChanged,
}: {
  me: Schemas["Me"];
  projects: Schemas["Project"][];
  onChanged: () => void;
}) {
  const owned = projects.filter((project) => project.ownerId === me.id);
  const [selected, setSelected] = useState(
    owned.find((project) => project.publicationAudience === "public")?.id ||
      owned[0]?.id ||
      "",
  );
  return (
    <>
      {owned.length > 0 && (
        <section aria-label="Incoming collaboration requests">
          <div className="workflow-toolbar">
            <label>
              Requests received by project
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {owned.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Collaboration
            key={selected}
            me={me}
            projectId={selected}
            onChanged={onChanged}
          />
        </section>
      )}
      <Collaboration me={me} onChanged={onChanged} />
    </>
  );
}

export function Collaboration({
  me,
  projectId,
  onChanged,
}: {
  me: Schemas["Me"];
  projectId?: string;
  onChanged?: () => void;
}) {
  const [cursor, setCursor] = useState<string>();
  const data = useRemote(async (signal) => {
    const result = projectId
      ? await api!.GET("/v1/projects/{id}/collaboration-requests", {
          params: { path: { id: projectId }, query: { limit: 100, cursor } },
          signal,
        })
      : await api!.GET("/v1/me/collaboration-requests", {
          params: { query: { limit: 100, cursor } },
          signal,
        });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${me.id}:${projectId}:${cursor}`);
  const action = useWorkflowAction(() => {
    data.reload();
    onChanged?.();
  });
  return (
    <section>
      <SectionHeading
        title={
          projectId ? "People who reached out" : "Your collaboration requests"
        }
      >
        {projectId
          ? "Read their introduction before opening the project to someone new."
          : "Keep track of your requests, responses, and next steps."}
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
            <EmptyState title="No requests yet">
              {projectId
                ? "Join and advice requests from your showcase will appear here."
                : "Explore public showcases to find a project you’d like to connect with."}
            </EmptyState>
          )}
          {data.data.items.map((item) => (
            <article className="workflow-record" key={item.id}>
              <StateLabel state={item.state} />
              <h3>
                {item.kind === "join" ? "Request to join" : "Advice request"}
              </h3>
              <p>{item.message}</p>
              <div className="record-meta">
                <span>{dateTime(item.createdAt, me.timezone)}</span>
              </div>
              {item.response && (
                <div className="workflow-notice">
                  <strong>Response</strong>
                  <p>{item.response}</p>
                </div>
              )}
              {!projectId && (
                <a
                  className="workflow-inline-link"
                  href={
                    item.state === "accepted" && item.kind === "join"
                      ? `#/projects/${item.projectId}`
                      : `#/showcase/${item.projectId}`
                  }
                >
                  {item.state === "accepted" && item.kind === "join"
                    ? "Open joined project →"
                    : "View showcase →"}
                </a>
              )}
              {item.state === "pending" && (
                <div className="record-actions">
                  {(projectId
                    ? (["accepted", "declined"] as const)
                    : (["withdrawn"] as const)
                  ).map((decision) => (
                    <button
                      className="button secondary"
                      key={decision}
                      onClick={() =>
                        action.open(
                          {
                            title:
                              decision === "accepted"
                                ? "Accept this request?"
                                : decision === "declined"
                                  ? "Decline this request?"
                                  : "Withdraw this request?",
                            description:
                              decision === "accepted" && item.kind === "join"
                                ? "This person asked to join. Accepting gives them member access to your private project, progress and team chat."
                                : decision === "accepted"
                                  ? "This accepts an advice request only. It does not add them to the private project."
                                  : "Your decision will be saved. No membership is added.",
                            label:
                              decision === "accepted"
                                ? "Accept request"
                                : decision === "declined"
                                  ? "Decline request"
                                  : "Withdraw request",
                            fields:
                              decision !== "withdrawn"
                                ? [
                                    {
                                      name: "response",
                                      label: "Response (optional)",
                                      type: "textarea",
                                      maxLength: 2000,
                                      optional: true,
                                    },
                                  ]
                                : [],
                            run: async (values, key) => {
                              await unwrap(
                                api!.POST(
                                  "/v1/collaboration-requests/{id}/decisions",
                                  {
                                    params: {
                                      path: { id: item.id },
                                      header: { "Idempotency-Key": key },
                                    },
                                    body: {
                                      version: item.version,
                                      decision,
                                      ...(values.response?.trim()
                                        ? { response: values.response.trim() }
                                        : {}),
                                    },
                                  },
                                ),
                              );
                            },
                          },
                          "Collaboration request updated.",
                        )
                      }
                    >
                      {decision === "accepted"
                        ? "Accept request"
                        : decision === "declined"
                          ? "Decline request"
                          : "Withdraw request"}
                    </button>
                  ))}
                </div>
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
    </section>
  );
}
