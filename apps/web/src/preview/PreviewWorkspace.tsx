import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  Folder,
  House,
  Info,
  LayoutGrid,
  List,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  Brand,
  MemberAvatars,
  Modal,
  ProjectCard,
  ProjectCover,
} from "../components/ui";
import { ProjectForm } from "../components/ProjectForm";
import {
  stageLabels,
  typeLabels,
  type Project,
  type ProjectType,
  type Stage,
} from "../lib/model";
import { projects as sampleProjects, schools } from "./scenarios";
import { clearDrafts, makeDraft, readDrafts, writeDrafts } from "./drafts";
import { useMobileNavigation } from "../components/useMobileNavigation";

function routeFromHash() {
  return window.location.hash.slice(1) || "/overview";
}
export function PreviewWorkspace({ onExit }: { onExit: () => void }) {
  const [route, setRoute] = useState(routeFromHash);
  const [schoolId, setSchoolId] = useState(schools[0].id);
  const [drafts, setDrafts] = useState<Project[]>([]);
  const [storageError, setStorageError] = useState("");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage | "all">("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [form, setForm] = useState<Project | "new" | null>(null);
  const [help, setHelp] = useState(false);
  const [exitDialog, setExitDialog] = useState(false);
  const [menu, setMenu] = useState(false);
  const narrow = useMobileNavigation(menu, setMenu);
  const [notice, setNotice] = useState("");
  const school = schools.find((item) => item.id === schoolId)!;
  const allProjects = [...drafts, ...sampleProjects].filter(
    (item) => item.schoolId === schoolId,
  );
  const selectedId = route.startsWith("/projects/")
    ? route.slice("/projects/".length)
    : null;
  const selected = selectedId
    ? allProjects.find((item) => item.id === selectedId)
    : undefined;
  const isOverview = route === "/overview";
  const isListPage = isOverview || route === "/projects";
  useEffect(() => {
    const listener = () => {
      setRoute(routeFromHash());
      setMenu(false);
    };
    window.addEventListener("hashchange", listener);
    try {
      setDrafts(readDrafts());
    } catch {
      setStorageError(
        "Saved drafts could not be read. Existing browser data has been left in place. New drafts cannot be saved until storage is available.",
      );
    }
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    document.title = `${selected?.title || (isOverview ? "Overview" : "My projects")} — BuildZ`;
  }, [selected?.title, isOverview]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  function navigate(path: string) {
    window.location.hash = path;
    setRoute(path);
    setMenu(false);
  }
  function switchSchool(value: string) {
    setSchoolId(value);
    setQuery("");
    setStage("all");
    setForm(null);
    setNotice("");
    navigate("/overview");
  }
  function saveDraft(input: {
    title: string;
    summary: string;
    projectType: ProjectType;
  }) {
    if (!school.canCreate || storageError)
      throw new Error("Draft saving is unavailable.");
    const next =
      form && form !== "new"
        ? {
            ...form,
            ...input,
            version: form.version + 1,
            updatedAt: new Date().toISOString(),
          }
        : makeDraft({ ...input, schoolId });
    const nextDrafts = [next, ...drafts.filter((item) => item.id !== next.id)];
    writeDrafts(nextDrafts);
    setDrafts(nextDrafts);
    setForm(null);
    setNotice(
      "Draft saved in this browser. Nothing has been sent to your school.",
    );
    navigate(`/projects/${next.id}`);
  }
  function exitPreview() {
    setDrafts([]);
    setForm(null);
    setQuery("");
    onExit();
  }
  const visible = allProjects
    .filter(
      (project) =>
        (stage === "all" || project.lifecycle === stage) &&
        `${project.title} ${project.summary}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  const createDisabled = !school.canCreate || !!storageError;
  const newButton = (
    <button
      className="button primary"
      onClick={() => setForm("new")}
      disabled={createDisabled}
      title={
        !school.canCreate
          ? "Your sample membership at this school is read-only."
          : undefined
      }
    >
      <Plus size={18} />
      New project
    </button>
  );
  return (
    <div className="workspace">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
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
          <span className="school-monogram">{school.initials}</span>
          <div>
            <strong>Your campus</strong>
            <span>Student workspace</span>
          </div>
          <span className="online-dot" />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          <a
            href="#/overview"
            className={isOverview ? "nav-item active" : "nav-item"}
            aria-current={isOverview ? "page" : undefined}
          >
            <House size={19} />
            Overview
          </a>
          <a
            href="#/projects"
            className={!isOverview ? "nav-item active" : "nav-item"}
            aria-current={!isOverview ? "page" : undefined}
          >
            <Folder size={19} />
            My projects<span className="nav-count">{allProjects.length}</span>
          </a>
          <div className="nav-item disabled" aria-disabled="true">
            <CalendarDays size={19} />
            Calendar<span className="later">Later</span>
          </div>
          <div className="nav-item disabled" aria-disabled="true">
            <MessageCircle size={19} />
            Messages<span className="later">Later</span>
          </div>
          <span className="nav-label second">EXPLORE</span>
          <div className="nav-item disabled" aria-disabled="true">
            <Compass size={19} />
            Discover<span className="later">Later</span>
          </div>
          <div className="nav-item disabled" aria-disabled="true">
            <Wrench size={19} />
            Spaces & equipment<span className="later">Later</span>
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="idea-note">
            <span className="note-spark">✳</span>
            <h3>Got a what-if?</h3>
            <p>Give it a place to grow.</p>
            <button onClick={() => setForm("new")} disabled={createDisabled}>
              Start a project
              <ArrowUpRight size={16} />
            </button>
          </div>
          <button className="nav-item help-link" onClick={() => setHelp(true)}>
            <CircleHelp size={19} />
            Help & getting started
          </button>
          <button className="profile" onClick={() => setExitDialog(true)}>
            <span className="avatar mint">MT</span>
            <span>
              <strong>Mina Tan</strong>
              <small>
                {school.canCreate
                  ? "Student · Sample account"
                  : "Guest · Read-only sample"}
              </small>
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
            <ChevronRight size={14} />
            <strong>
              {selected
                ? "Project details"
                : isOverview
                  ? "Overview"
                  : "My projects"}
            </strong>
          </div>
          <div className="topbar-actions">
            <label className="school-selector">
              <span className="sr-only">Active school</span>
              <span className="school-mini" aria-hidden="true">
                {school.initials}
              </span>
              <select
                value={schoolId}
                onChange={(event) => switchSchool(event.target.value)}
              >
                {schools.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </label>
            <button
              className="top-avatar avatar mint"
              onClick={() => setExitDialog(true)}
              aria-label="Sample account options"
            >
              MT
            </button>
          </div>
        </header>
        <div className="preview-strip">
          <span>
            <span className="preview-dot" />
            DEVELOPMENT PREVIEW{" "}
            <span className="preview-strip-detail">
              · Fictional data. Drafts stay in this browser.
            </span>
          </span>
          <button onClick={onExit}>
            Open connected workspace
            <ArrowUpRight size={13} />
          </button>
        </div>
        <main className="main-content" id="main-content" tabIndex={-1}>
          {storageError && (
            <div role="alert" className="error-message">
              {storageError}
            </div>
          )}
          {isListPage ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR CAMPUS, YOUR POSSIBILITIES</div>
                  <h1>
                    {isOverview
                      ? "Hey Mina, let’s make things happen."
                      : "A home for your ideas."}
                    <span className="heading-spark" aria-hidden="true">
                      ✳
                    </span>
                  </h1>
                  <p>
                    {isOverview
                      ? "A little progress today. Something meaningful tomorrow."
                      : "Keep your projects, people, and next steps together."}
                  </p>
                </div>
                {newButton}
              </div>
              {isOverview && (
                <section
                  className="welcome-banner"
                  aria-labelledby="welcome-title"
                >
                  <div className="welcome-copy">
                    <span className="eyebrow light">
                      FROM WHAT IF TO WHAT’S NEXT
                    </span>
                    <h2 id="welcome-title">
                      Big ideas start
                      <br />
                      with small steps.
                    </h2>
                    <p>
                      Make a little space for that thing
                      <br className="desktop-only" /> you’ve been wanting to
                      build.
                    </p>
                    <button
                      className="button light-button"
                      disabled={createDisabled}
                      onClick={() => setForm("new")}
                    >
                      Start with an idea
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                  <div className="build-illustration" aria-hidden="true">
                    <div className="build-top">
                      <span>the spark</span>
                      <Sparkles size={34} strokeWidth={1.4} />
                    </div>
                    <div className="build-middle">
                      <Users size={31} strokeWidth={1.4} />
                      <span>your people</span>
                    </div>
                    <div className="build-bottom">
                      <span>
                        something
                        <br />
                        <strong>that matters.</strong>
                      </span>
                      <ArrowUpRight size={52} strokeWidth={1.15} />
                    </div>
                    <span className="illustration-caption">
                      A WORK IN POSSIBILITY.
                    </span>
                  </div>
                  <div className="banner-aside">
                    <span className="banner-circle">
                      <ArrowUpRight size={24} />
                    </span>
                    <p>
                      You don’t need
                      <br />
                      the whole plan.
                      <br />
                      <strong>Just a place to start.</strong>
                    </p>
                  </div>
                </section>
              )}
              <div
                className={`content-columns ${!isOverview ? "full-width" : ""}`}
              >
                <section
                  className="projects-section"
                  aria-labelledby="projects-heading"
                >
                  <div className="section-heading">
                    <h2 id="projects-heading">
                      My projects <span>{allProjects.length}</span>
                    </h2>
                    {isOverview && (
                      <a href="#/projects">
                        View all
                        <ArrowRight size={15} />
                      </a>
                    )}
                  </div>
                  <div className="project-toolbar">
                    <div
                      className="stage-tabs"
                      role="group"
                      aria-label="Filter projects by stage"
                    >
                      {(
                        ["all", "in_progress", "idea", "completed"] as const
                      ).map((value) => (
                        <button
                          key={value}
                          aria-pressed={stage === value}
                          className={stage === value ? "selected" : ""}
                          onClick={() => setStage(value)}
                        >
                          {value === "all"
                            ? "All projects"
                            : stageLabels[value]}
                        </button>
                      ))}
                    </div>
                    <div
                      className="view-switch"
                      role="group"
                      aria-label="Project layout"
                    >
                      <button
                        className={view === "grid" ? "selected" : ""}
                        aria-label="Grid view"
                        aria-pressed={view === "grid"}
                        onClick={() => setView("grid")}
                      >
                        <LayoutGrid size={16} />
                      </button>
                      <button
                        className={view === "list" ? "selected" : ""}
                        aria-label="List view"
                        aria-pressed={view === "list"}
                        onClick={() => setView("list")}
                      >
                        <List size={17} />
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
                      <Settings2 size={15} />
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
                  <span className="sr-only" role="status">
                    {visible.length} projects shown
                  </span>
                  {visible.length ? (
                    <div
                      className={`projects-grid ${view === "list" ? "list-view" : ""}`}
                    >
                      {visible.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                          onOpen={() => navigate(`/projects/${project.id}`)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Folder size={34} strokeWidth={1.3} />
                      <h3>
                        {query
                          ? "No projects match your search."
                          : stage === "completed"
                            ? "The finish line is still ahead."
                            : "There’s room for a new idea."}
                      </h3>
                      <p>
                        {query
                          ? "Try another name or a few different words."
                          : "Your projects will appear here as they grow."}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => {
                          setQuery("");
                          setStage("all");
                        }}
                      >
                        Show all projects
                      </button>
                    </div>
                  )}
                  {!school.canCreate && (
                    <div className="notice read-only-note">
                      <LockKeyhole size={17} />
                      You have a read-only sample membership at this school.
                    </div>
                  )}
                </section>
                {isOverview && (
                  <aside className="right-column" aria-label="Getting started">
                    <div className="getting-started">
                      <span className="guide-icon">
                        <BookOpen size={20} />
                      </span>
                      <h2>A little direction.</h2>
                      <p>Your idea doesn’t have to arrive fully formed.</p>
                      <ol className="getting-started-steps">
                        <li>
                          <span>1</span>
                          <div>
                            <strong>Give your idea a home</strong>
                            <p>Start with a name and a short description.</p>
                          </div>
                        </li>
                        <li>
                          <span>2</span>
                          <div>
                            <strong>Find your people</strong>
                            <p>Invite different skills and shared curiosity.</p>
                            <small>Available in a later phase</small>
                          </div>
                        </li>
                        <li>
                          <span>3</span>
                          <div>
                            <strong>Take the next step</strong>
                            <p>
                              Turn a shared idea into a plan you can act on.
                            </p>
                            <small>Available in a later phase</small>
                          </div>
                        </li>
                      </ol>
                      <button onClick={() => setHelp(true)}>
                        A quick guide to BuildZ
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <div className="privacy-note">
                      <ShieldCheck size={20} />
                      <div>
                        <strong>Yours until you share it.</strong>
                        <p>
                          Projects start private. You choose what becomes
                          public.
                        </p>
                      </div>
                    </div>
                  </aside>
                )}
              </div>
              <footer className="page-footer">
                <Brand />
                <span>A little curiosity. A lot of possibility.</span>
                <span>Made for building together.</span>
              </footer>
            </>
          ) : selected ? (
            <>
              <button
                className="text-button back-link"
                onClick={() => navigate("/projects")}
              >
                <ArrowLeft size={17} />
                Back to my projects
              </button>
              <div className="detail-layout">
                <section>
                  <ProjectCover project={selected} large />
                  <div className="detail-title">
                    <div>
                      <div className="card-meta">
                        <span className="category">
                          {typeLabels[selected.projectType]}
                        </span>
                        <span className={`stage stage-${selected.lifecycle}`}>
                          <i />
                          {stageLabels[selected.lifecycle]}
                        </span>
                      </div>
                      <h1>{selected.title}</h1>
                    </div>
                    <span className="private-label">
                      <LockKeyhole size={14} />
                      Private
                    </span>
                  </div>
                  <p className="detail-summary">{selected.summary}</p>
                  <div className="notice">
                    <Info size={18} />
                    <span>
                      {selected.localDraft
                        ? "This draft is saved only in this browser. It has not been created on the BuildZ service."
                        : "This is a fictional, read-only sample project. Its team and progress are for preview only."}
                    </span>
                  </div>
                  <section className="detail-next">
                    <h2>
                      {selected.localDraft
                        ? "A good place to begin."
                        : "Keep the idea moving."}
                    </h2>
                    <p>
                      {selected.localDraft
                        ? "Refine your browser-local draft here. Open the connected workspace to create a persisted project and work with teammates."
                        : "This sample tour is read-only. Open the connected workspace to create, edit, and collaborate on persisted projects."}
                    </p>
                    <div className="detail-actions">
                      {selected.capabilities.canEdit && (
                        <button
                          className="button primary"
                          disabled={!selected.capabilities.canEdit}
                          onClick={() => setForm(selected)}
                        >
                          Edit local draft
                        </button>
                      )}
                      <button className="button secondary" onClick={onExit}>
                        Open connected workspace
                      </button>
                    </div>
                    {!selected.capabilities.canEdit && (
                      <small>
                        Sample projects are read-only. Create a local draft to
                        try editing.
                      </small>
                    )}
                  </section>
                </section>
                <aside className="project-details-panel">
                  <h2>Project details</h2>
                  <dl>
                    <dt>Lead institution</dt>
                    <dd>{school.name}</dd>
                    <dt>Project stage</dt>
                    <dd>{stageLabels[selected.lifecycle]}</dd>
                    <dt>Visibility</dt>
                    <dd>
                      <LockKeyhole size={14} />
                      Private to the project
                    </dd>
                    <dt>Project type</dt>
                    <dd>{typeLabels[selected.projectType]}</dd>
                  </dl>
                  <div className="team-heading">
                    <h3>The people behind it</h3>
                    <span>{selected.members.length}</span>
                  </div>
                  <MemberAvatars members={selected.members} />
                  <ul className="team-list">
                    {selected.members.map((member) => (
                      <li key={member.name}>
                        <span className={`avatar ${member.color}`}>
                          {member.initials}
                        </span>
                        <span>
                          {member.name}
                          <small>
                            {selected.localDraft
                              ? "Draft author"
                              : "Sample teammate"}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="detail-support">
                    <ShieldCheck size={19} />
                    <p>
                      Publishing and team changes need your school’s connected
                      workspace.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          ) : (
            <div className="empty-state unavailable">
              <LockKeyhole size={36} />
              <h1>This page isn’t available.</h1>
              <p>Return to the projects available in your current workspace.</p>
              <button
                className="button primary"
                onClick={() => navigate("/projects")}
              >
                Back to my projects
              </button>
            </div>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {form && (
        <ProjectForm
          school={school}
          project={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
          onSave={saveDraft}
        />
      )}
      {help && (
        <Modal title="A quick guide to BuildZ" onClose={() => setHelp(false)}>
          <p className="modal-intro">
            BuildZ is a home for student ideas and the people who bring them to
            life.
          </p>
          <div className="guide-section">
            <h3>Try it in this preview</h3>
            <p>
              Browse sample projects, search and filter, switch schools, and
              save or edit your own local idea drafts. Sample people and
              institutions are fictional.
            </p>
          </div>
          <div className="guide-section">
            <h3>Your drafts stay here</h3>
            <p>
              Drafts are saved in this browser. Reopen the sample workspace to
              continue after a refresh. They are not sent to a school or shared
              with teammates.
            </p>
          </div>
          <div className="guide-section">
            <h3>Coming with the connected workspace</h3>
            <p>
              Real projects, team invitations, proposals, bookings, calendars,
              messages, and public discovery need the backend service. They are
              unavailable in this preview.
            </p>
          </div>
          <div className="notice">
            <Info size={18} />
            <span>
              The sample workspace is separate from your school account. Leave
              the preview to sign in or connect to the local demo.
            </span>
          </div>
          <div className="modal-actions">
            <button className="button primary" onClick={() => setHelp(false)}>
              Got it
              <Check size={17} />
            </button>
          </div>
        </Modal>
      )}
      {exitDialog && (
        <Modal title="Sample account" onClose={() => setExitDialog(false)}>
          <div className="account-summary">
            <span className="avatar mint">MT</span>
            <div>
              <h3>Mina Tan</h3>
              <p>Fictional student · Development preview</p>
            </div>
          </div>
          <p className="modal-intro">
            Leaving the preview clears the workspace from view. Your local
            drafts remain in this browser unless you choose to delete them.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => {
                try {
                  clearDrafts();
                  exitPreview();
                } catch {
                  setStorageError(
                    "Browser storage could not be cleared. Try again before using a shared device.",
                  );
                  setExitDialog(false);
                }
              }}
            >
              Delete drafts & leave
            </button>
            <button className="button primary" onClick={exitPreview}>
              Leave preview
              <LogOut size={17} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
