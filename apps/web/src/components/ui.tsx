import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, Lightbulb, Route, Sprout, Waves, X } from "lucide-react";
import { stageLabels, typeLabels, type Project } from "../lib/model";

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      BuildZ
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    dialog
      .querySelector<HTMLElement>(
        "input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
      )
      ?.focus();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const box = ref.current.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ProjectCover({
  project,
  large = false,
}: {
  project: Project;
  large?: boolean;
}) {
  return (
    <div
      className={`project-cover cover-${project.cover} ${large ? "cover-large" : ""}`}
      aria-hidden="true"
    >
      {project.cover === "routes" ? (
        <>
          <div className="map-line map-line-one" />
          <div className="map-line map-line-two" />
          <div className="map-dot dot-one" />
          <div className="map-dot dot-two" />
          <span className="cover-stamp">
            A CAMPUS
            <br />
            FOR EVERYONE.
          </span>
          <span className="cover-symbol">
            <Route size={36} strokeWidth={1.5} />
          </span>
          <span className="cover-footnote">Find a better way.</span>
        </>
      ) : project.cover === "repair" ? (
        <>
          <span className="cover-stamp">
            GOOD THINGS.
            <br />
            SECOND LIVES.
          </span>
          <span className="repair-symbol">
            <Sprout size={84} strokeWidth={1.15} />
          </span>
          <span className="cover-footnote">The Repair Café ↗</span>
        </>
      ) : project.cover === "sound" ? (
        <>
          <span className="cover-stamp">
            PRESS PAUSE.
            <br />
            LISTEN IN.
          </span>
          <div className="wave-bars">
            {[
              18, 30, 48, 36, 64, 80, 55, 30, 48, 70, 44, 22, 40, 62, 32, 18,
            ].map((height, index) => (
              <i key={index} style={{ height }} />
            ))}
          </div>
          <span className="cover-footnote">
            <Waves size={16} /> Sounds between classes
          </span>
        </>
      ) : (
        <>
          <span className="cover-stamp">
            IT STARTS
            <br />
            WITH AN IDEA.
          </span>
          <Lightbulb className="idea-symbol" size={76} strokeWidth={1.1} />
          <span className="cover-footnote">
            A little spark. A new possibility.
          </span>
        </>
      )}
    </div>
  );
}

export function MemberAvatars({ members }: Pick<Project, "members">) {
  return (
    <div
      className="avatars"
      aria-label={`Team: ${members.map((member) => member.name).join(", ")}`}
    >
      {members.slice(0, 4).map((member) => (
        <span
          key={member.name}
          className={`avatar ${member.color}`}
          title={member.name}
        >
          {member.initials}
        </span>
      ))}
    </div>
  );
}

export function ProjectCard({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: () => void;
}) {
  return (
    <article className="project-card">
      <button
        className="project-link"
        onClick={onOpen}
        aria-label={`Open ${project.title}`}
      >
        <ProjectCover project={project} />
        <div className="card-content">
          <div className="card-meta">
            <span className="category">{typeLabels[project.projectType]}</span>
            <span className={`stage stage-${project.lifecycle}`}>
              <i />
              {stageLabels[project.lifecycle]}
            </span>
          </div>
          <h3>{project.title}</h3>
          <p>{project.summary}</p>
        </div>
      </button>
      <div className="card-footer">
        {project.members.length > 0 && (
          <MemberAvatars members={project.members} />
        )}
        <span>
          {project.localDraft
            ? "Local draft"
            : project.members.length
              ? `${project.members.length} teammates`
              : project.publicationAudience === "public" ? "Public showcase" : "Private project"}
        </span>
        <ArrowUpRight size={17} aria-hidden="true" />
      </div>
    </article>
  );
}
