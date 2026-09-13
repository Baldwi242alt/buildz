import type { Project, ProjectType } from "../lib/model";

const storageKey = "buildz:preview:mina:drafts:v1";
export function makeDraft(
  input: {
    title: string;
    summary: string;
    projectType: ProjectType;
    schoolId: string;
  },
  id: string = crypto.randomUUID(),
): Project {
  return {
    ...input,
    id,
    lifecycle: "idea",
    publicationAudience: "private",
    version: 1,
    updatedAt: new Date().toISOString(),
    cover: "idea",
    members: [{ name: "Mina Tan", initials: "MT", color: "mint" }],
    capabilities: {
      canEdit: true,
      canInvite: false,
      canSubmitProposal: false,
      canPublish: false,
    },
    localDraft: true,
  };
}

export function readDrafts(): Project[] {
  const value: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (!Array.isArray(value)) throw new Error("Saved drafts could not be read.");
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const draft = item as Record<string, unknown>;
    if (
      typeof draft.id !== "string" ||
      !/^[a-f\d-]{36}$/i.test(draft.id) ||
      typeof draft.schoolId !== "string" ||
      typeof draft.title !== "string" ||
      !draft.title.trim() ||
      draft.title.length > 100 ||
      typeof draft.summary !== "string" ||
      draft.summary.length > 600 ||
      !["community", "creative", "technology"].includes(
        String(draft.projectType),
      )
    )
      return [];
    return [
      makeDraft(
        {
          title: draft.title,
          summary: draft.summary,
          schoolId: draft.schoolId,
          projectType: draft.projectType as ProjectType,
        },
        draft.id,
      ),
    ];
  });
}
export function writeDrafts(drafts: Project[]) {
  localStorage.setItem(storageKey, JSON.stringify(drafts));
}
export function clearDrafts() {
  localStorage.removeItem(storageKey);
}
