import { useState, type FormEvent } from "react";
import { ArrowRight, Leaf, Palette, Cpu, Info } from "lucide-react";
import type { Project, ProjectType, School } from "../lib/model";
import { Modal } from "./ui";

export function ProjectForm({
  school,
  project,
  onClose,
  onSave,
}: {
  school: School;
  project?: Project;
  onClose: () => void;
  onSave: (input: {
    title: string;
    summary: string;
    projectType: ProjectType;
  }) => void;
}) {
  const [title, setTitle] = useState(project?.title || "");
  const [summary, setSummary] = useState(project?.summary || "");
  const [projectType, setProjectType] = useState<ProjectType>(
    project?.projectType || "community",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (title.trim().length < 3) {
      setError("Give your project a name with at least 3 characters.");
      return;
    }
    if (summary.trim().length < 20) {
      setError("Add at least 20 characters to explain your idea.");
      return;
    }
    setSaving(true);
    try {
      onSave({ title: title.trim(), summary: summary.trim(), projectType });
    } catch {
      setError(
        "This browser could not save your draft. Your text is still here. Check available storage and try again.",
      );
      setSaving(false);
    }
  }
  return (
    <Modal
      title={project ? "Edit your draft" : "Every project starts somewhere."}
      onClose={onClose}
      wide
    >
      <p className="modal-intro">
        A name, an idea, and a little curiosity. That’s enough to begin.
      </p>
      <div className="notice">
        <Info size={18} />
        <span>
          Preview mode · This saves a local draft in this browser. It won’t
          create a project at your school.
        </span>
      </div>
      <form onSubmit={submit} className="project-form">
        <label htmlFor="project-title">
          Project name <span>Required</span>
        </label>
        <input
          autoFocus
          id="project-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          required
          placeholder="What are you working on?"
          aria-describedby={error ? "form-error" : undefined}
        />
        <fieldset>
          <legend>What kind of project?</legend>
          <div className="type-options">
            {(
              [
                { value: "community", label: "Community", icon: Leaf },
                { value: "creative", label: "Creative", icon: Palette },
                { value: "technology", label: "Technology", icon: Cpu },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <label
                key={value}
                className={`type-option ${projectType === value ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="project-type"
                  value={value}
                  checked={projectType === value}
                  onChange={() => setProjectType(value)}
                />
                <Icon size={22} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="project-summary">
          The idea <span>{summary.length}/600</span>
        </label>
        <textarea
          id="project-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={600}
          required
          rows={4}
          placeholder="What would you like to make, change, or explore?"
          aria-describedby={error ? "form-error" : undefined}
        />
        <div className="form-school">
          <span>Lead institution</span>
          <strong>{school.name}</strong>
          <small>
            Private to your project. Publishing will need a separate review.
          </small>
        </div>
        {error && (
          <p className="error-message" role="alert" id="form-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? "Saving…" : "Save local draft"}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
