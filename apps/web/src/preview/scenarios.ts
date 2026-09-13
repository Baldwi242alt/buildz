import type { Project, School } from "../lib/model";

// Fictional, frontend-only visual scenarios. These are not API fixtures.
// Replace with packages/fixtures after canonical schema validation is available.
export const schools: School[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Northbridge Polytechnic",
    initials: "NP",
    canCreate: true,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Harbour Arts Institute",
    initials: "HA",
    canCreate: false,
  },
];
const mina = { name: "Mina Tan", initials: "MT", color: "mint" };
const kai = { name: "Kai Lim", initials: "KL", color: "peach" };
const ari = { name: "Ari Lee", initials: "AL", color: "lavender" };
export const projects: Project[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    schoolId: schools[0].id,
    title: "Accessible Campus Guide",
    summary:
      "Making the everyday journey across campus a little easier for everyone. We’re mapping accessible routes, one pathway at a time.",
    projectType: "community",
    lifecycle: "in_progress",
    publicationAudience: "private",
    version: 1,
    updatedAt: "2026-09-13T08:00:00Z",
    cover: "routes",
    members: [mina, kai, ari],
    capabilities: {
      canEdit: false,
      canInvite: false,
      canSubmitProposal: false,
      canPublish: false,
    },
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    schoolId: schools[0].id,
    title: "The Repair Café",
    summary:
      "A student-led space to fix what we love. Bringing practical repair skills and a little more circular thinking to campus.",
    projectType: "community",
    lifecycle: "idea",
    publicationAudience: "private",
    version: 1,
    updatedAt: "2026-09-12T09:00:00Z",
    cover: "repair",
    members: [mina, ari],
    capabilities: {
      canEdit: false,
      canInvite: false,
      canSubmitProposal: false,
      canPublish: false,
    },
  },
  {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    schoolId: schools[0].id,
    title: "Sounds Between Classes",
    summary:
      "An audio portrait of campus life, made from the small sounds and shared stories we usually walk past.",
    projectType: "creative",
    lifecycle: "in_progress",
    publicationAudience: "private",
    version: 1,
    updatedAt: "2026-09-11T07:00:00Z",
    cover: "sound",
    members: [mina, kai],
    capabilities: {
      canEdit: false,
      canInvite: false,
      canSubmitProposal: false,
      canPublish: false,
    },
  },
  {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    schoolId: schools[1].id,
    title: "Neighbourhood in Print",
    summary:
      "Collecting everyday neighbourhood stories through student-made prints and a shared exhibition.",
    projectType: "creative",
    lifecycle: "idea",
    publicationAudience: "private",
    version: 1,
    updatedAt: "2026-09-10T07:00:00Z",
    cover: "idea",
    members: [ari],
    capabilities: {
      canEdit: false,
      canInvite: false,
      canSubmitProposal: false,
      canPublish: false,
    },
  },
];
