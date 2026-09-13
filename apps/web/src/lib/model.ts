// Frontend view models, NOT contract types or generated SDK exports.
export type Stage = "idea" | "in_progress" | "completed" | "archived";
export type ProjectType =
  | "community"
  | "creative"
  | "technology"
  | "engineering"
  | "business"
  | "other";
export type Cover = "routes" | "repair" | "sound" | "idea";
export interface Project {
  id: string;
  schoolId: string;
  title: string;
  summary: string;
  projectType: ProjectType;
  lifecycle: Stage;
  publicationAudience: "private" | "public";
  version: number;
  updatedAt: string;
  cover: Cover;
  members: { name: string; initials: string; color: string }[];
  capabilities: {
    canEdit: boolean;
    canInvite: boolean;
    canSubmitProposal: boolean;
    canPublish: boolean;
  };
  localDraft?: boolean;
}
export interface School {
  id: string;
  name: string;
  initials: string;
  canCreate: boolean;
}
export const stageLabels: Record<Stage, string> = {
  idea: "Idea",
  in_progress: "In progress",
  completed: "Completed",
  archived: "Archived",
};
export const typeLabels: Record<ProjectType, string> = {
  community: "Community",
  creative: "Creative",
  technology: "Technology",
  engineering: "Engineering",
  business: "Business",
  other: "Other",
};
