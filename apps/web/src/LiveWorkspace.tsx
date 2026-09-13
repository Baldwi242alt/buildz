import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Compass,
  Folder,
  House,
  Info,
  LoaderCircle,
  LogOut,
  Mail,
  Bell,
  Clock3,
  Handshake,
  Ticket,
  ClipboardCheck,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {
  api,
  errorMessage,
  ServiceError,
  unwrap,
  type Schemas,
} from "./lib/api";
import { Brand, ProjectCard, ProjectCover } from "./components/ui";
import { ActionDialog, type ActionSpec } from "./components/ActionDialog";
import { type Project as ViewProject } from "./lib/model";
import { useMobileNavigation } from "./components/useMobileNavigation";
import { ProjectNavigation } from "./workflows/ProjectNavigation";

const WorkflowArea = lazy(() =>
  import("./workflows/WorkflowArea").then((module) => ({
    default: module.WorkflowArea,
  })),
);
const workflowLabels: Record<string, string> = {
  resources: "Spaces & equipment",
  availability: "My availability",
  bookings: "Bookings",
  consultations: "Consultations",
  discover: "Discover",
  showcase: "Public showcase",
  collaboration: "Collaboration",
  notifications: "Updates",
  credits: "Vouchers",
  review: "Staff review",
  calendar: "Calendar",
};

type Project = Schemas["Project"];
type Snapshot = {
  me: Schemas["Me"];
  institutions: Schemas["Institution"][];
  meta: Schemas["ServiceMeta"];
  projects: Project[];
  invitations: Schemas["Invitation"][];
  nextProjects: string | null;
  nextInvitations: string | null;
};
const lifecycleLabel = {
  idea: "Idea",
  active: "In progress",
  completed: "Completed",
  archived: "Archived",
};
const transitions: Record<Project["lifecycle"], Project["lifecycle"][]> = {
  idea: ["active", "archived"],
  active: ["completed", "archived"],
  completed: ["active", "archived"],
  archived: ["idea"],
};
function viewProject(project: Project): ViewProject {
  return {
    ...project,
    schoolId: project.leadInstitutionId,
    lifecycle:
      project.lifecycle === "active" ? "in_progress" : project.lifecycle,
    cover: "idea",
    members: [],
  };
}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
function currentRoute() {
  return (
    location.hash.slice(1) ||
    (location.pathname.startsWith("/invitations/") ||
    location.pathname.startsWith("/showcase/")
      ? location.pathname
      : "/overview")
  );
}
const projectFields = (project?: Project): ActionSpec["fields"] => [
  {
    name: "title",
    label: "Project name",
    initial: project?.title,
    maxLength: 150,
  },
  {
    name: "summary",
    label: "The idea",
    initial: project?.summary,
    type: "textarea",
    maxLength: 2000,
  },
  ...(!project
    ? [
        {
          name: "projectType",
          label: "Project type",
          type: "select" as const,
          options: [
            "community",
            "creative",
            "engineering",
            "business",
            "other",
          ].map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
          })),
        },
      ]
    : []),
];

export function LiveWorkspace({
  onSignOut,
  signingOut,
}: {
  onSignOut: () => Promise<void>;
  signingOut: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [route, setRoute] = useState(currentRoute);
  const [schoolId, setSchoolId] = useState("all");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<Project | null>(null);
  const [members, setMembers] = useState<Schemas["Member"][]>([]);
  const [verifications, setVerifications] = useState<Schemas["Verification"][]>(
    [],
  );
  const [linkedInvitation, setLinkedInvitation] = useState<
    Schemas["Invitation"] | null
  >(null);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const narrow = useMobileNavigation(menu, setMenu);
  const [cooldown, setCooldown] = useState(0);
  const generation = useRef(0);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const projectId = route.startsWith("/projects/")
    ? route.slice(10).split("/")[0]
    : null;
  const projectTab = projectId ? route.split("/")[3] || "" : "";
  const workflow = workflowLabels[route.split("/")[1]];
  const invitationId = route.startsWith("/invitations/")
    ? route.slice(13)
    : null;
  const pane = workflow
    ? "workflow"
    : projectId
      ? "detail"
      : route.startsWith("/invitations")
        ? "invitations"
        : route === "/school"
          ? "school"
          : route === "/profile"
            ? "profile"
            : "projects";
  const load = useCallback(async () => {
    if (!api || !alive.current) return;
    const epoch = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError("");
    try {
      const [me, institutions, meta] = await Promise.all([
        unwrap(api.GET("/v1/me", { signal: controller.signal })),
        unwrap(api.GET("/v1/institutions", { signal: controller.signal })),
        unwrap(api.GET("/v1/meta", { signal: controller.signal })),
      ]);
      const [projectPage, invitationPage] = await Promise.all([
        meta.features.projects
          ? api.GET("/v1/projects", {
              params: { query: { limit: 100 } },
              signal: controller.signal,
            })
          : null,
        meta.features.invitations
          ? api.GET("/v1/me/invitations", {
              params: { query: { limit: 100 } },
              signal: controller.signal,
            })
          : null,
      ]);
      if (projectPage?.error)
        throw new ServiceError(
          projectPage.error.error.message,
          projectPage.error.error.code,
        );
      if (invitationPage?.error)
        throw new ServiceError(
          invitationPage.error.error.message,
          invitationPage.error.error.code,
        );
      if (!alive.current || epoch !== generation.current) return;
      setSnapshot({
        me,
        institutions,
        meta,
        projects: projectPage?.data?.data ?? [],
        invitations: invitationPage?.data?.data ?? [],
        nextProjects: projectPage?.data?.meta.nextCursor ?? null,
        nextInvitations: invitationPage?.data?.meta.nextCursor ?? null,
      });
    } catch (failure) {
      if (
        !alive.current ||
        epoch !== generation.current ||
        controller.signal.aborted
      )
        return;
      const transient =
        !(failure instanceof ServiceError) ||
        [
          "RATE_LIMITED",
          "INVALID_RESPONSE",
          "INTERNAL_ERROR",
          "SERVICE_UNAVAILABLE",
          "NETWORK_ERROR",
        ].includes(failure.code);
      if (!transient) {
        setSnapshot(null);
        setSelected(null);
        setMembers([]);
        setVerifications([]);
        setLinkedInvitation(null);
      }
      setError(
        `${errorMessage(failure)}${transient ? " Previously loaded details may be out of date. Unsaved text is kept; refresh when the connection recovers." : ""}`,
      );
      if (failure instanceof ServiceError && failure.retryAfter)
        setCooldown(failure.retryAfter);
    } finally {
      if (alive.current && epoch === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const navigate = () => {
      const nextRoute = currentRoute();
      setRoute(nextRoute);
      setSelected(null);
      setMembers([]);
      setLinkedInvitation(null);
      setDetailError("");
      setMenu(false);
      // Workflow views load their own scoped records; don't refetch five bootstrap
      // endpoints for every tab change. Basic lists still refresh on entry.
      if (
        [
          "/projects",
          "/overview",
          "/invitations",
          "/school",
          "/profile",
        ].includes(nextRoute)
      )
        void load();
    };
    const focus = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener("hashchange", navigate);
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      ++generation.current;
      abort.current?.abort();
      window.removeEventListener("hashchange", navigate);
      window.removeEventListener("focus", focus);
    };
  }, [load]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (!api || !snapshot) return;
    const controller = new AbortController();
    let active = true;
    setDetailError("");
    // Keep the current view mounted during same-scope refreshes so drafts and focus survive.
    // Navigation and identity changes clear the previous scope before this effect runs.
    const client = api;
    async function detail() {
      setDetailLoading(true);
      try {
        if (projectId) {
          const [project, team] = await Promise.all([
            unwrap(
              client.GET("/v1/projects/{id}", {
                params: { path: { id: projectId } },
                signal: controller.signal,
              }),
            ),
            unwrap(
              client.GET("/v1/projects/{id}/members", {
                params: { path: { id: projectId } },
                signal: controller.signal,
              }),
            ),
          ]);
          if (active) {
            setSelected(project);
            setMembers(team);
          }
        } else if (invitationId) {
          const invitation = await unwrap(
            client.GET("/v1/invitations/{id}", {
              params: { path: { id: invitationId } },
              signal: controller.signal,
            }),
          );
          if (active) setLinkedInvitation(invitation);
        } else if (pane === "school" && schoolId !== "all") {
          const items = await unwrap(
            client.GET("/v1/institutions/{id}/verification-requests", {
              params: { path: { id: schoolId } },
              signal: controller.signal,
            }),
          );
          if (active) setVerifications(items);
        }
      } catch (failure) {
        if (active && !controller.signal.aborted) {
          setSelected(null);
          setMembers([]);
          setLinkedInvitation(null);
          setVerifications([]);
          setDetailError(errorMessage(failure));
        }
      } finally {
        if (active) setDetailLoading(false);
      }
    }
    void detail();
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, projectTab, invitationId, pane, schoolId, snapshot]);
  useEffect(() => {
    document.title = `${selected?.title || workflow || (pane === "projects" ? "My projects" : pane[0].toUpperCase() + pane.slice(1))} — BuildZ`;
  }, [pane, selected?.title, workflow]);
  function navigate(path: string) {
    location.hash = path;
  }
  function after(message: string) {
    setNotice(message);
    void load();
  }
  function openAction(spec: ActionSpec) {
    setAction({ ...spec, refresh: load });
  }
  async function loadMore(kind: "projects" | "invitations") {
    if (!api || !snapshot || loading || cooldown) return;
    setLoading(true);
    setError("");
    const epoch = generation.current;
    try {
      if (kind === "projects" && snapshot.nextProjects) {
        const result = await api.GET("/v1/projects", {
          params: { query: { cursor: snapshot.nextProjects, limit: 100 } },
        });
        const rows = await unwrap(Promise.resolve(result));
        if (alive.current && generation.current === epoch)
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  projects: [
                    ...current.projects,
                    ...rows.filter(
                      (row) =>
                        !current.projects.some((item) => item.id === row.id),
                    ),
                  ],
                  nextProjects: result.data?.meta.nextCursor ?? null,
                }
              : null,
          );
      } else if (snapshot.nextInvitations) {
        const result = await api.GET("/v1/me/invitations", {
          params: { query: { cursor: snapshot.nextInvitations, limit: 100 } },
        });
        const rows = await unwrap(Promise.resolve(result));
        if (alive.current && generation.current === epoch)
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  invitations: [
                    ...current.invitations,
                    ...rows.filter(
                      (row) =>
                        !current.invitations.some((item) => item.id === row.id),
                    ),
                  ],
                  nextInvitations: result.data?.meta.nextCursor ?? null,
                }
              : null,
          );
      }
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure));
    } finally {
      if (alive.current && epoch === generation.current) setLoading(false);
    }
  }
  if (!api)
    return (
      <main className="connection-screen">
        <Brand />
        <h1>Your workspace is almost ready.</h1>
        <p>
          The API address has not been configured. Contact your workspace
          administrator.
        </p>
        <button
          className="button secondary"
          onClick={onSignOut}
          disabled={signingOut}
        >
          Sign out
        </button>
      </main>
    );
  if (!snapshot)
    return (
      <main className="connection-screen">
        <Brand />
        {loading ? (
          <>
            <div className="notice" role="status">
              <LoaderCircle className="spin" size={20} />
              Loading your workspace…
            </div>
            <p className="connection-hint">
              If the hosted service is waking up, this can take about a minute.
              Your saved projects remain on the server.
            </p>
          </>
        ) : (
          <>
            <h1>We couldn’t open your workspace.</h1>
            <p className="error-message" role="alert">
              {error}
            </p>
            <button
              className="button primary"
              disabled={cooldown > 0}
              onClick={() => void load()}
            >
              {cooldown ? `Try again in ${cooldown}s` : "Try again"}
            </button>
          </>
        )}
        <button
          className="button secondary"
          onClick={onSignOut}
          disabled={signingOut}
        >
          Sign out
        </button>
      </main>
    );
  const { me, institutions, meta } = snapshot;
  const school = institutions.find((item) => item.id === schoolId);
  const canCreateAt = (id: string) =>
    me.capabilities.canCreateProject &&
    me.memberships.some(
      (item) =>
        item.institutionId === id &&
        item.affiliation === "student" &&
        item.status === "verified" &&
        (!item.validUntil || Date.parse(item.validUntil) > Date.now()),
    );
  const eligibleSchools = institutions.filter((item) => canCreateAt(item.id));
  const isAdmin = me.roles.some(
    (role) =>
      role.institutionId === schoolId && role.role === "institution_admin",
  );
  const create = () =>
    openAction({
      title: "Every project starts somewhere.",
      description:
        "Your project starts private. Choose the school that will lead it.",
      label: "Create project",
      fields: [
        ...projectFields(),
        {
          name: "institution",
          label: "Lead institution",
          type: "select",
          initial: eligibleSchools.some((item) => item.id === schoolId)
            ? schoolId
            : undefined,
          options: eligibleSchools.map((item) => ({
            value: item.id,
            label: item.name,
          })),
        },
      ],
      run: async (values, key) => {
        const project = await unwrap(
          api!.POST("/v1/projects", {
            params: { header: { "Idempotency-Key": key } },
            body: {
              title: values.title.trim(),
              summary: values.summary.trim(),
              projectType: values.projectType as Project["projectType"],
              leadInstitutionId: values.institution,
            },
          }),
        );
        after("Project created.");
        navigate(`/projects/${project.id}`);
      },
    });
  const scoped = snapshot.projects.filter(
    (item) => schoolId === "all" || item.leadInstitutionId === schoolId,
  );
  const visible = scoped
    .filter(
      (item) =>
        (stage === "all" || item.lifecycle === stage) &&
        `${item.title} ${item.summary}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  const invitationRows = linkedInvitation
    ? [linkedInvitation]
    : snapshot.invitations;
  const canCreate =
    meta.features.projects &&
    eligibleSchools.length > 0 &&
    (schoolId === "all" || canCreateAt(schoolId));
  return (
    <div className="workspace">
      <a
        className="skip-link"
        href="#live-main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("live-main")?.focus();
        }}
      >
        Skip to main content
      </a>
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Dismiss navigation overlay"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        inert={narrow && !menu}
        role={narrow && menu ? "dialog" : undefined}
        aria-modal={narrow && menu ? true : undefined}
        className={`sidebar ${menu ? "open" : ""}`}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-logo">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="school-badge">
          <span className="school-monogram">
            {school ? initials(school.name) : "BZ"}
          </span>
          <div>
            <strong>{school ? "Your campus" : "Your workspace"}</strong>
            <span>{school?.name || "Across your campuses"}</span>
          </div>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {[
            { href: "/overview", label: "Overview", icon: House },
            { href: "/projects", label: "My projects", icon: Folder },
            { href: "/invitations", label: "Invitations", icon: Mail },
            { href: "/school", label: "School membership", icon: ShieldCheck },
            { href: "/profile", label: "My profile", icon: Users },
          ].map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={`#${href}`}
              className={`nav-item ${route === href ? "active" : ""}`}
              aria-current={route === href ? "page" : undefined}
            >
              <Icon size={19} />
              {label}
            </a>
          ))}
          <span className="nav-label second">BUILD TOGETHER</span>
          {[
            {
              href: "/resources",
              label: "Spaces & equipment",
              icon: Compass,
              enabled: meta.features.resources,
            },
            {
              href: "/availability",
              label: "My availability",
              icon: Clock3,
              enabled: meta.features.availability,
            },
            {
              href: "/calendar",
              label: "Calendar",
              icon: CalendarDays,
              enabled: meta.features.bookings && meta.features.consultations,
            },
            {
              href: "/bookings",
              label: "Bookings",
              icon: CalendarDays,
              enabled: meta.features.bookings,
            },
            {
              href: "/consultations",
              label: "Consultations",
              icon: Users,
              enabled: meta.features.consultations,
            },
            {
              href: "/discover",
              label: "Discover",
              icon: Compass,
              enabled: meta.features.publicProjects,
            },
            {
              href: "/collaboration",
              label: "Collaboration",
              icon: Handshake,
              enabled: meta.features.publicProjects,
            },
            {
              href: "/notifications",
              label: "Updates",
              icon: Bell,
              enabled: meta.features.notifications,
            },
            {
              href: "/credits",
              label: "Vouchers",
              icon: Ticket,
              enabled: meta.features.vouchers,
            },
            {
              href: "/review",
              label: "Staff review",
              icon: ClipboardCheck,
              enabled:
                meta.features.proposals &&
                me.roles.some((role) =>
                  ["institution_admin", "reviewer"].includes(role.role),
                ),
            },
          ]
            .filter((item) => item.enabled)
            .map(({ href, label, icon: Icon }) => (
              <a
                key={href}
                href={`#${href}`}
                className={`nav-item ${route === href || route.startsWith(`${href}/`) ? "active" : ""}`}
                aria-current={
                  route === href || route.startsWith(`${href}/`)
                    ? "page"
                    : undefined
                }
              >
                <Icon size={19} />
                {label}
              </a>
            ))}
          {!meta.features.resources && (
            <div className="nav-item disabled" aria-disabled="true">
              <CalendarDays size={19} />
              More tools coming soon
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="idea-note">
            <span className="note-spark">✳</span>
            <h3>Got a what-if?</h3>
            <p>Give it a place to grow.</p>
            <button disabled={!canCreate} onClick={create}>
              Start a project
              <ArrowUpRight size={16} />
            </button>
          </div>
          <button className="profile" onClick={onSignOut} disabled={signingOut}>
            <span className="avatar mint">{initials(me.displayName)}</span>
            <span>
              <strong>{me.displayName}</strong>
              <small>{signingOut ? "Signing out…" : "Sign out"}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace-body" inert={narrow && menu}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ArrowRight size={13} />
            <strong>
              {workflow ||
                (pane === "detail"
                  ? "Project details"
                  : pane === "projects"
                    ? "My projects"
                    : pane === "school"
                      ? "School membership"
                      : pane === "profile"
                        ? "My profile"
                        : "Invitations")}
            </strong>
          </div>
          <div className="topbar-actions">
            <label className="school-selector">
              <span className="sr-only">Active school</span>
              <select
                value={schoolId}
                onChange={(event) => {
                  setSchoolId(event.target.value);
                  setAction(null);
                  setSelected(null);
                  setMembers([]);
                  setQuery("");
                  setStage("all");
                  if (pane === "detail") navigate("/projects");
                  else void load();
                }}
              >
                <option value="all">All my campuses</option>
                {institutions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              disabled={loading || cooldown > 0}
              onClick={() => {
                void load();
                window.dispatchEvent(new Event("buildz:refresh"));
              }}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>
        <main className="main-content" id="live-main" tabIndex={-1}>
          {notice && (
            <div className="notice live-notice" role="status">
              <Check size={18} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {detailError && (
            <p className="error-message" role="alert">
              {detailError}
            </p>
          )}
          {pane === "workflow" && (
            <Suspense
              fallback={<p role="status">Loading this workspace tool…</p>}
            >
              <h1 className="sr-only">{workflow}</h1>
              <WorkflowArea
                key={`${route}:${schoolId}`}
                projects={snapshot.projects}
                route={route}
                me={me}
                members={members}
                institutions={institutions}
                meta={meta}
                onChanged={load}
              />
            </Suspense>
          )}
          {pane === "projects" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR CAMPUS, YOUR POSSIBILITIES</div>
                  <h1>
                    {route === "/overview"
                      ? `Hey ${me.displayName.split(" ")[0]}, what’s next?`
                      : "A home for your ideas."}
                    <span className="heading-spark">✳</span>
                  </h1>
                  <p>
                    Your projects, people, and next steps. All in one place.
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={!canCreate}
                  onClick={create}
                >
                  <Plus size={18} />
                  New project
                </button>
              </div>
              {!canCreate && (
                <div className="notice live-notice">
                  <Info size={18} />
                  {!meta.features.projects
                    ? "Projects are not available in this workspace yet."
                    : "A verified student membership is required to create a project at this school."}
                </div>
              )}
              <div className="content-columns full-width">
                <section className="projects-section">
                  <div className="section-heading">
                    <h2>
                      My projects{" "}
                      <span>
                        {scoped.length}
                        {snapshot.nextProjects ? "+" : ""}
                      </span>
                    </h2>
                  </div>
                  <div className="project-toolbar">
                    <div
                      className="stage-tabs"
                      role="group"
                      aria-label="Filter projects by stage"
                    >
                      {["all", "idea", "active", "completed", "archived"].map(
                        (value) => (
                          <button
                            key={value}
                            className={stage === value ? "selected" : ""}
                            aria-pressed={stage === value}
                            onClick={() => setStage(value)}
                          >
                            {value === "all"
                              ? "All projects"
                              : lifecycleLabel[value as Project["lifecycle"]]}
                          </button>
                        ),
                      )}
                    </div>
                    <div className="view-switch">
                      <button
                        aria-label="Grid view"
                        aria-pressed={view === "grid"}
                        onClick={() => setView("grid")}
                      >
                        Grid
                      </button>
                      <button
                        aria-label="List view"
                        aria-pressed={view === "list"}
                        onClick={() => setView("list")}
                      >
                        List
                      </button>
                    </div>
                  </div>
                  <div className="search-row">
                    <label className="search-field">
                      <Search size={17} />
                      <span className="sr-only">Search projects</span>
                      <input
                        type="search"
                        placeholder="Find a project…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <label className="sort-field">
                      <span className="sr-only">Sort projects</span>
                      <select
                        aria-label="Sort projects"
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                      >
                        <option value="recent">Recently updated</option>
                        <option value="name">Project name</option>
                      </select>
                    </label>
                  </div>
                  <span role="status" className="sr-only">
                    {visible.length} projects shown
                  </span>
                  {visible.length ? (
                    <div
                      className={`projects-grid ${view === "list" ? "list-view" : ""}`}
                    >
                      {visible.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={viewProject(project)}
                          onOpen={() => navigate(`/projects/${project.id}`)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Folder size={35} />
                      <h3>
                        {query || stage !== "all"
                          ? "No projects match these filters."
                          : "There’s room for a new idea."}
                      </h3>
                      <p>
                        {query || stage !== "all"
                          ? "Try a different name or project stage."
                          : "Start a project, or accept an invitation from your team."}
                      </p>
                      {(query || stage !== "all") && (
                        <button
                          className="button secondary"
                          onClick={() => {
                            setQuery("");
                            setStage("all");
                          }}
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  )}
                  {snapshot.nextProjects && (
                    <button
                      className="button secondary load-more"
                      disabled={loading || cooldown > 0}
                      onClick={() => void loadMore("projects")}
                    >
                      Load more projects
                    </button>
                  )}
                </section>
              </div>
            </>
          )}
          {pane === "detail" && (
            <>
              <button
                className="text-button back-link"
                onClick={() => navigate("/projects")}
              >
                <ArrowLeft size={17} />
                Back to my projects
              </button>
              {detailLoading && (
                <div className="notice" role="status">
                  <LoaderCircle size={18} className="spin" />
                  Loading project…
                </div>
              )}
              {selected && (
                <ProjectNavigation
                  id={selected.id}
                  active={projectTab}
                  available={[
                    ...(meta.features.proposals ? ["support"] : []),
                    ...(meta.features.progress ? ["progress"] : []),
                    ...(meta.features.bookings ? ["planning"] : []),
                    ...(meta.features.messages &&
                    (selected.capabilities.canMessage ||
                      members.some((member) => member.userId === me.id))
                      ? ["messages"]
                      : []),
                    ...(meta.features.publicProjects ? ["showcase"] : []),
                  ]}
                />
              )}
              {selected && projectTab && (
                <>
                  <h1 className="project-workflow-title">{selected.title}</h1>
                  <Suspense
                    fallback={<p role="status">Loading project tools…</p>}
                  >
                    <WorkflowArea
                      key={`${selected.id}:${projectTab}`}
                      projects={snapshot.projects}
                      route={route}
                      project={selected}
                      me={me}
                      members={members}
                      institutions={institutions}
                      meta={meta}
                      onChanged={load}
                    />
                  </Suspense>
                </>
              )}
              {selected && !projectTab && (
                <div className="detail-layout">
                  <section>
                    <ProjectCover project={viewProject(selected)} large />
                    <div className="detail-title">
                      <div>
                        <span
                          className={`stage stage-${viewProject(selected).lifecycle}`}
                        >
                          {lifecycleLabel[selected.lifecycle]}
                        </span>
                        <h1>{selected.title}</h1>
                      </div>
                      <span className="private-label">
                        {selected.publicationAudience === "public"
                          ? "Public showcase · private workspace"
                          : "Private"}
                      </span>
                    </div>
                    <p className="detail-summary">{selected.summary}</p>
                    <div className="detail-actions">
                      <button
                        className="button primary"
                        disabled={!selected.capabilities.canEdit}
                        onClick={() =>
                          openAction({
                            title: "Edit project",
                            description:
                              "Save a new version of your project. Your team will see these changes.",
                            label: "Save changes",
                            fields: projectFields(selected),
                            versioned: true,
                            run: async (values) => {
                              await unwrap(
                                api!.PATCH("/v1/projects/{id}", {
                                  params: { path: { id: selected.id } },
                                  body: {
                                    version: selected.version,
                                    title: values.title.trim(),
                                    summary: values.summary.trim(),
                                  },
                                }),
                              );
                              after("Project updated.");
                            },
                          })
                        }
                      >
                        Edit project
                      </button>
                      <button
                        className="button secondary"
                        disabled={
                          !selected.capabilities.canInvite ||
                          !meta.features.invitations
                        }
                        onClick={() =>
                          openAction({
                            title: "Invite a teammate",
                            description:
                              "Create an invitation for this email address. They must sign in and accept before joining. Email delivery is not enabled; share the returned link yourself.",
                            label: "Create invitation",
                            fields: [
                              {
                                name: "email",
                                label: "Teammate email",
                                type: "email",
                                maxLength: 254,
                              },
                              {
                                name: "role",
                                label: "Project role",
                                type: "select",
                                options: [
                                  { value: "member", label: "Member" },
                                  { value: "editor", label: "Editor" },
                                ],
                              },
                            ],
                            run: async (values, key) => {
                              const invitation = await unwrap(
                                api!.POST("/v1/projects/{id}/invitations", {
                                  params: {
                                    path: { id: selected.id },
                                    header: { "Idempotency-Key": key },
                                  },
                                  body: {
                                    email: values.email,
                                    role: values.role as "member" | "editor",
                                  },
                                }),
                              );
                              setLinkedInvitation(invitation);
                              setNotice(
                                `Invitation created for ${invitation.recipientEmail}. No email was sent.`,
                              );
                              navigate(`/invitations/${invitation.id}`);
                            },
                          })
                        }
                      >
                        Invite teammates
                      </button>
                    </div>
                    <section className="detail-next">
                      <h2>Project stage</h2>
                      <p>
                        Update the stage when your team is ready. Archiving also
                        revokes pending invitations.
                      </p>
                      <div className="detail-actions">
                        {transitions[selected.lifecycle].map((next) => (
                          <button
                            className="button secondary"
                            key={next}
                            disabled={
                              selected.ownerId !== me.id ||
                              (next === "archived" &&
                                !selected.capabilities.canArchive)
                            }
                            onClick={() =>
                              openAction({
                                title:
                                  next === "archived"
                                    ? "Archive this project?"
                                    : `Move to ${lifecycleLabel[next].toLowerCase()}?`,
                                description:
                                  next === "archived"
                                    ? "The project becomes read-only and pending invitations are revoked. You can restore it to the idea stage later."
                                    : "This updates the stage for everyone on the project.",
                                label:
                                  next === "archived"
                                    ? "Archive project"
                                    : "Update stage",
                                fields: [],
                                run: async (_values, key) => {
                                  await unwrap(
                                    api!.POST("/v1/projects/{id}/lifecycle", {
                                      params: {
                                        path: { id: selected.id },
                                        header: { "Idempotency-Key": key },
                                      },
                                      body: {
                                        version: selected.version,
                                        lifecycle: next,
                                      },
                                    }),
                                  );
                                  after("Project stage updated.");
                                },
                              })
                            }
                          >
                            {next === "archived"
                              ? "Archive project"
                              : next === "idea"
                                ? "Restore to idea"
                                : `Move to ${lifecycleLabel[next].toLowerCase()}`}
                          </button>
                        ))}
                      </div>
                    </section>
                    {!meta.features.proposals && (
                      <div className="notice">
                        <ShieldCheck size={18} />
                        Public publishing, proposals, and booking are not
                        available in this phase.
                      </div>
                    )}
                  </section>
                  <aside className="project-details-panel">
                    <h2>The people behind it</h2>
                    <p className="modal-intro">
                      {institutions.find(
                        (item) => item.id === selected.leadInstitutionId,
                      )?.name || "Lead institution unavailable"}
                    </p>
                    <ul className="team-list">
                      {members.map((member) => (
                        <li key={member.userId}>
                          <span className="avatar mint">
                            {initials(member.displayName)}
                          </span>
                          <span>
                            {member.displayName}
                            <small>{member.role}</small>
                          </span>
                          {member.role !== "owner" &&
                            (selected.capabilities.canManageMembers ||
                              member.userId === me.id) && (
                              <button
                                className="icon-button"
                                aria-label={
                                  member.userId === me.id
                                    ? "Leave project"
                                    : `Remove ${member.displayName}`
                                }
                                onClick={() =>
                                  openAction({
                                    title:
                                      member.userId === me.id
                                        ? "Leave this project?"
                                        : `Remove ${member.displayName}?`,
                                    description:
                                      "This ends the selected person’s project access. Rejoining requires a new invitation.",
                                    label:
                                      member.userId === me.id
                                        ? "Leave project"
                                        : "Remove member",
                                    fields: [],
                                    run: async (_values, key) => {
                                      await unwrap(
                                        api!.DELETE(
                                          "/v1/projects/{id}/members/{userId}",
                                          {
                                            params: {
                                              path: {
                                                id: selected.id,
                                                userId: member.userId,
                                              },
                                              header: {
                                                "Idempotency-Key": key,
                                              },
                                            },
                                            body: { version: selected.version },
                                          },
                                        ),
                                      );
                                      after("Project membership updated.");
                                      if (member.userId === me.id)
                                        navigate("/projects");
                                    },
                                  })
                                }
                              >
                                <X size={15} />
                              </button>
                            )}
                        </li>
                      ))}
                    </ul>
                    {selected.capabilities.canTransferOwnership && (
                      <button
                        className="button secondary full"
                        disabled={members.length < 2}
                        onClick={() =>
                          openAction({
                            title: "Transfer project ownership",
                            description:
                              "Choose an accepted teammate. They will control membership and ownership; you will remain a teammate.",
                            label: "Transfer ownership",
                            fields: [
                              {
                                name: "newOwnerId",
                                label: "New owner",
                                type: "select",
                                options: members
                                  .filter((member) => member.userId !== me.id)
                                  .map((member) => ({
                                    value: member.userId,
                                    label: member.displayName,
                                  })),
                              },
                            ],
                            run: async (values, key) => {
                              await unwrap(
                                api!.POST(
                                  "/v1/projects/{id}/ownership-transfer",
                                  {
                                    params: {
                                      path: { id: selected.id },
                                      header: { "Idempotency-Key": key },
                                    },
                                    body: {
                                      version: selected.version,
                                      newOwnerId: values.newOwnerId,
                                    },
                                  },
                                ),
                              );
                              after("Project ownership transferred.");
                            },
                          })
                        }
                      >
                        Transfer ownership
                      </button>
                    )}
                  </aside>
                </div>
              )}
            </>
          )}
          {pane === "invitations" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">GOOD THINGS START WITH PEOPLE</div>
                  <h1>Your invitations.</h1>
                  <p>You choose which projects to join.</p>
                </div>
              </div>
              {detailLoading && <p role="status">Loading invitation…</p>}
              {!meta.features.invitations ? (
                <div className="notice">Invitations are not available yet.</div>
              ) : invitationRows.length ? (
                <div className="record-list">
                  {invitationRows.map((invitation) => (
                    <article className="record-card" key={invitation.id}>
                      <div>
                        <span className="category">
                          {invitation.state.toUpperCase()}
                        </span>
                        <h2>Invitation to collaborate</h2>
                        <p>Project {invitation.projectId}</p>
                        <p>
                          For {invitation.recipientEmail} · Join as{" "}
                          {invitation.role}
                        </p>
                        <p>
                          Expires{" "}
                          {new Date(invitation.expiresAt).toLocaleString(
                            undefined,
                            { timeZone: me.timezone },
                          )}
                        </p>
                        {linkedInvitation && (
                          <label className="invitation-link">
                            Invitation link
                            <input
                              readOnly
                              value={invitation.invitationUrl}
                              onFocus={(event) => event.target.select()}
                            />
                          </label>
                        )}
                      </div>
                      <div className="detail-actions">
                        {invitation.state === "pending" &&
                          Date.parse(invitation.expiresAt) > Date.now() &&
                          (invitation.recipientEmail.toLowerCase() ===
                          me.email.toLowerCase() ? (
                            (["accept", "decline"] as const).map((decision) => (
                              <button
                                className={`button ${decision === "accept" ? "primary" : "secondary"}`}
                                key={decision}
                                onClick={() =>
                                  openAction({
                                    title:
                                      decision === "accept"
                                        ? "Join this project?"
                                        : "Decline this invitation?",
                                    description:
                                      decision === "accept"
                                        ? `You will join as a ${invitation.role}. Accept only if you want to collaborate on this project.`
                                        : "You will not join. A new invitation is needed if you change your mind.",
                                    label:
                                      decision === "accept"
                                        ? "Accept invitation"
                                        : "Decline invitation",
                                    fields: [],
                                    run: async (_values, key) => {
                                      if (decision === "accept") {
                                        const result = await unwrap(
                                          api!.POST(
                                            "/v1/invitations/{id}/accept",
                                            {
                                              params: {
                                                path: { id: invitation.id },
                                                header: {
                                                  "Idempotency-Key": key,
                                                },
                                              },
                                            },
                                          ),
                                        );
                                        after("Invitation accepted.");
                                        navigate(
                                          `/projects/${result.projectId}`,
                                        );
                                      } else {
                                        await unwrap(
                                          api!.POST(
                                            "/v1/invitations/{id}/decline",
                                            {
                                              params: {
                                                path: { id: invitation.id },
                                                header: {
                                                  "Idempotency-Key": key,
                                                },
                                              },
                                            },
                                          ),
                                        );
                                        after("Invitation declined.");
                                      }
                                    },
                                  })
                                }
                              >
                                {decision === "accept"
                                  ? "Accept invitation"
                                  : "Decline"}
                              </button>
                            ))
                          ) : (
                            <button
                              className="button secondary"
                              onClick={() =>
                                openAction({
                                  title: "Revoke this invitation?",
                                  description:
                                    "The recipient will no longer be able to accept this invitation.",
                                  label: "Revoke invitation",
                                  fields: [],
                                  run: async (_values, key) => {
                                    await unwrap(
                                      api!.POST("/v1/invitations/{id}/revoke", {
                                        params: {
                                          path: { id: invitation.id },
                                          header: { "Idempotency-Key": key },
                                        },
                                      }),
                                    );
                                    after("Invitation revoked.");
                                  },
                                })
                              }
                            >
                              Revoke invitation
                            </button>
                          ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                !detailLoading &&
                !detailError && (
                  <div className="empty-state">
                    <Mail size={34} />
                    <h3>No invitations right now.</h3>
                    <p>When a teammate invites you, you can review it here.</p>
                  </div>
                )
              )}
              {snapshot.nextInvitations && !linkedInvitation && (
                <button
                  className="button secondary load-more"
                  disabled={loading}
                  onClick={() => void loadMore("invitations")}
                >
                  Load more invitations
                </button>
              )}
            </>
          )}
          {pane === "school" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR SCHOOL CONNECTION</div>
                  <h1>Make it official.</h1>
                  <p>
                    Select a school above to request or review student
                    verification.
                  </p>
                </div>
              </div>
              <div className="record-list">
                {institutions
                  .filter((item) => schoolId === "all" || item.id === schoolId)
                  .map((institution) => (
                    <article className="record-card" key={institution.id}>
                      <div>
                        <h2>{institution.name}</h2>
                        <p>
                          {me.memberships
                            .filter(
                              (item) => item.institutionId === institution.id,
                            )
                            .map(
                              (item) =>
                                `${item.affiliation}: ${item.status}${item.validUntil && Date.parse(item.validUntil) <= Date.now() ? " (expired)" : ""}`,
                            )
                            .join(" · ") || "No verified membership"}
                        </p>
                        <p>
                          {institution.timezone} · {institution.currency}
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        disabled={canCreateAt(institution.id)}
                        onClick={() =>
                          openAction({
                            title: "Request student verification",
                            description: `Explain your student connection to ${institution.name}. A school administrator will review it.`,
                            label: "Request verification",
                            fields: [
                              {
                                name: "statement",
                                label: "Your connection to this school",
                                type: "textarea",
                                maxLength: 1000,
                              },
                            ],
                            run: async (values, key) => {
                              await unwrap(
                                api!.POST(
                                  "/v1/institutions/{id}/verification-requests",
                                  {
                                    params: {
                                      path: { id: institution.id },
                                      header: { "Idempotency-Key": key },
                                    },
                                    body: { statement: values.statement },
                                  },
                                ),
                              );
                              after("Verification requested.");
                            },
                          })
                        }
                      >
                        {canCreateAt(institution.id)
                          ? "Verified student"
                          : "Request verification"}
                      </button>
                    </article>
                  ))}
              </div>
              {schoolId !== "all" && (
                <section className="verification-section">
                  <h2>
                    {isAdmin
                      ? "Verification review queue"
                      : "Your verification requests"}
                  </h2>
                  {detailLoading ? (
                    <p role="status">Loading requests…</p>
                  ) : verifications.length ? (
                    verifications.map((item) => (
                      <article className="record-card" key={item.id}>
                        <div>
                          <span className="category">
                            {item.state.toUpperCase()}
                          </span>
                          <h3>Student verification</h3>
                          {isAdmin && <p>Applicant {item.userId}</p>}
                          <p>{item.statement}</p>
                          {item.reason && <p>Decision: {item.reason}</p>}
                        </div>
                        {isAdmin &&
                          item.state === "pending" &&
                          item.userId !== me.id && (
                            <div className="detail-actions">
                              {(["approved", "rejected"] as const).map(
                                (decision) => (
                                  <button
                                    key={decision}
                                    className="button secondary"
                                    onClick={() =>
                                      openAction({
                                        title:
                                          decision === "approved"
                                            ? "Approve student verification?"
                                            : "Reject student verification?",
                                        description:
                                          "Your decision and reason will be saved. An approval grants a verified student membership.",
                                        label:
                                          decision === "approved"
                                            ? "Approve verification"
                                            : "Reject verification",
                                        fields: [
                                          {
                                            name: "reason",
                                            label: "Decision reason",
                                            type: "textarea",
                                            maxLength: 1000,
                                          },
                                        ],
                                        run: async (values, key) => {
                                          await unwrap(
                                            api!.POST(
                                              "/v1/verification-requests/{id}/decisions",
                                              {
                                                params: {
                                                  path: { id: item.id },
                                                  header: {
                                                    "Idempotency-Key": key,
                                                  },
                                                },
                                                body: {
                                                  version: item.version,
                                                  decision,
                                                  reason: values.reason,
                                                },
                                              },
                                            ),
                                          );
                                          after("Verification decision saved.");
                                        },
                                      })
                                    }
                                  >
                                    {decision === "approved"
                                      ? "Approve"
                                      : "Reject"}
                                  </button>
                                ),
                              )}
                            </div>
                          )}
                      </article>
                    ))
                  ) : (
                    !detailError && (
                      <p className="modal-intro">
                        No verification requests to show.
                      </p>
                    )
                  )}
                </section>
              )}
            </>
          )}
          {pane === "profile" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR CORNER OF BuildZ</div>
                  <h1>My profile.</h1>
                  <p>How your teammates know you.</p>
                </div>
              </div>
              <section className="record-card">
                <div>
                  <span className="avatar mint">
                    {initials(me.displayName)}
                  </span>
                  <h2>{me.displayName}</h2>
                  <p>{me.email}</p>
                  <p>Timezone: {me.timezone}</p>
                  <p>
                    School roles and memberships are managed by your
                    institution.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() =>
                    openAction({
                      title: "Edit profile",
                      description:
                        "Your display name is visible to your teammates. Your timezone is used to display dates.",
                      label: "Save profile",
                      fields: [
                        {
                          name: "displayName",
                          label: "Display name",
                          initial: me.displayName,
                          maxLength: 100,
                        },
                        {
                          name: "timezone",
                          label: "IANA timezone",
                          initial: me.timezone,
                          maxLength: 100,
                        },
                      ],
                      versioned: true,
                      run: async (values) => {
                        try {
                          new Intl.DateTimeFormat(undefined, {
                            timeZone: values.timezone,
                          });
                        } catch {
                          throw new ServiceError(
                            "Enter a valid timezone, such as Asia/Singapore.",
                            "VALIDATION_ERROR",
                          );
                        }
                        await unwrap(
                          api!.PATCH("/v1/me", {
                            body: {
                              displayName: values.displayName.trim(),
                              timezone: values.timezone,
                            },
                          }),
                        );
                        after("Profile saved.");
                      },
                    })
                  }
                >
                  Edit profile
                </button>
              </section>
            </>
          )}
          <footer className="page-footer">
            <Brand />
            <span>A little curiosity. A lot of possibility.</span>
            <span>Projects start private.</span>
          </footer>
        </main>
      </div>
      {action && (
        <ActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
