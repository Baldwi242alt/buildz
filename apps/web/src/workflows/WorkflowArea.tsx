import type { Schemas } from "../lib/api";
import { Support, Progress } from "./Support";
import { Planning, BookingList } from "./Booking";
import { Discover, Showcase, CollaborationHub } from "./Discovery";
import { Messages, Notifications } from "./Messages";
import { ResourceBrowser, Availability } from "./Resources";
import { Credits } from "./Credits";
import { Review } from "./Review";
import { Consultations } from "./Consultations";
import { Calendar } from "./Calendar";
import { VenueCalendar } from "./VenueCalendar";
import { api, unwrap } from "../lib/api";
import { LoadState, useRemote } from "./common";

export function WorkflowArea({
  route,
  project,
  projects,
  me,
  members,
  institutions,
  meta,
  onChanged,
}: {
  route: string;
  project?: Schemas["Project"];
  projects: Schemas["Project"][];
  me: Schemas["Me"];
  members: Schemas["Member"][];
  institutions: Schemas["Institution"][];
  meta: Schemas["ServiceMeta"];
  onChanged: () => void;
}) {
  const tab = route.split("/")[3];
  if (project) {
    if (tab === "support" && meta.features.proposals)
      return <Support project={project} me={me} />;
    if (tab === "progress" && meta.features.progress)
      return (
        <Progress
          project={project}
          me={me}
          members={members}
          filesAvailable={meta.features.files}
        />
      );
    if (tab === "planning" && meta.features.bookings)
      return (
        <Planning
          project={project}
          me={me}
          members={members}
          initialSlot={route.split("/").slice(4)}
        />
      );
    if (tab === "messages" && meta.features.messages)
      return <Messages project={project} me={me} members={members} />;
    if (tab === "showcase" && meta.features.publicProjects)
      return <Showcase project={project} me={me} onChanged={onChanged} />;
  } else {
    if (route.startsWith("/resources") && meta.features.resources)
      return (
        <ResourceBrowser
          me={me}
          institutions={institutions}
          resourceId={route.split("/")[2]}
        />
      );
    if (route === "/availability" && meta.features.availability)
      return <Availability me={me} />;
    if (route === "/bookings" && meta.features.bookings)
      return <AllBookings me={me} projects={projects} />;
    if (
      route === "/calendar" &&
      meta.features.bookings &&
      meta.features.consultations
    )
      return <Calendar me={me} projects={projects} />;
    if (route === "/consultations" && meta.features.consultations)
      return (
        <Consultations
          me={me}
          institutions={institutions}
          projects={projects}
        />
      );
    if (
      (route === "/discover" || route.startsWith("/showcase/")) &&
      meta.features.publicProjects
    )
      return <Discover me={me} projectId={route.split("/")[2]} />;
    if (route === "/collaboration" && meta.features.publicProjects)
      return (
        <CollaborationHub me={me} projects={projects} onChanged={onChanged} />
      );
    if (route === "/notifications" && meta.features.notifications)
      return <Notifications me={me} />;
    if (route === "/credits" && meta.features.vouchers)
      return <Credits me={me} institutions={institutions} />;
    if (route === "/review" && meta.features.proposals)
      return <Review me={me} />;
  }
  return (
    <div className="workflow-notice">
      <h2>This section isn’t available.</h2>
      <p>
        The connected service does not currently expose this workflow. Your
        saved data has not changed.
      </p>
      <a className="workflow-inline-link" href="#/projects">
        Back to projects
      </a>
    </div>
  );
}
function AllBookings({
  me,
  projects,
}: {
  me: Schemas["Me"];
  projects: Schemas["Project"][];
}) {
  const resources = useRemote(
    (signal) =>
      unwrap(
        api!.GET("/v1/resources", {
          params: { query: { limit: 100 } },
          signal,
        }),
      ),
    me.id,
  );
  return (
    <>
      <LoadState
        loading={resources.loading && !resources.data}
        error={resources.error}
        retry={resources.reload}
      />
      {resources.data && (
        <>
          <VenueCalendar resources={resources.data} projects={projects} />
          <BookingList me={me} resources={resources.data} />
        </>
      )}
    </>
  );
}
