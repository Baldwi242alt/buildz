const sections = [
  ["", "Overview"],
  ["support", "Support"],
  ["progress", "Progress"],
  ["planning", "Plan & book"],
  ["messages", "Team chat"],
  ["showcase", "Showcase"],
] as const;

export function ProjectNavigation({
  id,
  active,
  available,
}: {
  id: string;
  active: string;
  available: string[];
}) {
  return (
    <nav className="workflow-tabs" aria-label="Project sections">
      {sections
        .filter(([key]) => !key || available.includes(key))
        .map(([key, label]) => (
          <a
            key={key}
            href={`#/projects/${id}${key ? `/${key}` : ""}`}
            aria-current={active === key ? "page" : undefined}
          >
            {label}
          </a>
        ))}
    </nav>
  );
}
