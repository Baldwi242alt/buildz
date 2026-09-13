import { useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { api, unwrap, ServiceError, type Schemas } from "../lib/api";
import type { ActionField } from "../components/ActionDialog";
import {
  dateTime,
  EmptyState,
  integer,
  LoadState,
  money,
  SectionHeading,
  StateLabel,
  useRemote,
} from "./common";
import { PageControls } from "./Support";
import { useWorkflowAction } from "./useWorkflowAction";
import { ScheduleEditor } from "./ScheduleEditor";

export function manages(me: Schemas["Me"], institutionId: string) {
  return me.roles.some(
    (role) =>
      role.institutionId === institutionId &&
      ["institution_admin", "resource_manager"].includes(role.role),
  );
}
export function period(days = 30) {
  const now = new Date();
  return {
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + days * 86400000).toISOString(),
  };
}
export function ResourceBrowser({
  me,
  institutions,
  resourceId,
}: {
  me: Schemas["Me"];
  institutions: Schemas["Institution"][];
  resourceId?: string;
}) {
  const [category, setCategory] = useState("");
  const [school, setSchool] = useState("");
  const [sort, setSort] = useState<"newest" | "cheapest" | "nearest">("newest");
  const [currency, setCurrency] = useState("SGD");
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  }>();
  const [locationError, setLocationError] = useState("");
  const [cursor, setCursor] = useState<string>();
  const data = useRemote(
    async (signal) => {
      if (resourceId)
        return {
          items: [
            await unwrap(
              api!.GET("/v1/resources/{id}", {
                params: { path: { id: resourceId } },
                signal,
              }),
            ),
          ],
          next: null,
        };
      const result = await api!.GET("/v1/resources", {
        params: {
          query: {
            limit: 24,
            cursor,
            sort,
            ...(school ? { institutionId: school } : {}),
            ...(category
              ? { category: category as Schemas["Resource"]["category"] }
              : {}),
            ...(sort === "cheapest" ? { currency } : {}),
            ...(location || {}),
          },
        },
        signal,
      });
      return {
        items: await unwrap(Promise.resolve(result)),
        next: result.data?.meta.nextCursor,
      };
    },
    `${resourceId}:${category}:${school}:${sort}:${currency}:${JSON.stringify(location)}:${cursor}`,
  );
  const action = useWorkflowAction(data.reload);
  const eligible = institutions.filter((item) => manages(me, item.id));
  const create = () =>
    action.open(
      {
        title: "Add a campus resource",
        description:
          "Publish accurate resource details. Rates are entered in the currency’s minor units (for SGD, cents). Add opening windows after creating the resource; it cannot be booked outside those windows.",
        label: "Create resource",
        fields: [
          {
            name: "institutionId",
            label: "Managing institution",
            type: "select",
            options: eligible.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          },
          ...resourceFields(),
        ],
        run: async (values, key) => {
          const resource = await unwrap(
            api!.POST("/v1/resources", {
              params: { header: { "Idempotency-Key": key } },
              body: {
                institutionId: values.institutionId,
                ...resourceValues(values),
              },
            }),
          );
          window.location.hash = `/resources/${resource.id}`;
        },
      },
      "Resource created. Add its opening schedule next.",
    );
  function locate() {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("Location is unavailable in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setSort("nearest");
        setCursor(undefined);
      },
      () =>
        setLocationError(
          "Location wasn’t available. You can still browse by school, category, or price.",
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }
  return (
    <>
      {resourceId ? (
        <a className="workflow-inline-link" href="#/resources">
          ← All campus resources
        </a>
      ) : (
        <SectionHeading
          eyebrow="MAKE ROOM FOR YOUR NEXT IDEA"
          title="Spaces & equipment"
          action={
            eligible.length > 0 && (
              <button className="button primary" onClick={create}>
                <Plus size={17} />
                Add resource
              </button>
            )
          }
        >
          Find the right place and tools. Book through a project so the right
          people, permissions, and price stay together.
        </SectionHeading>
      )}
      {!resourceId && (
        <div className="workflow-toolbar">
          <label>
            Institution
            <select
              value={school}
              onChange={(event) => {
                setSchool(event.target.value);
                setCursor(undefined);
              }}
            >
              <option value="">All accessible institutions</option>
              {institutions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setCursor(undefined);
              }}
            >
              <option value="">All categories</option>
              {["room", "studio", "equipment", "workshop", "other"].map(
                (value) => (
                  <option key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Sort by
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as typeof sort);
                setCursor(undefined);
              }}
            >
              <option value="newest">Recently added</option>
              <option value="cheapest">Lowest hourly rate</option>
              {location && <option value="nearest">Nearest to you</option>}
            </select>
          </label>
          {sort === "cheapest" && (
            <label>
              Currency
              <select
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  setCursor(undefined);
                }}
              >
                {[
                  ...new Set([
                    "SGD",
                    ...institutions.map((item) => item.currency),
                  ]),
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
          <button className="button secondary" onClick={locate}>
            <MapPin size={16} />
            Use my location
          </button>
        </div>
      )}
      {locationError && (
        <p role="status" className="workflow-caption">
          {locationError}
        </p>
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
            <EmptyState title="No resources match">
              Try a different institution or category. Only resources you’re
              permitted to see are listed.
            </EmptyState>
          )}
          {resourceId ? (
            data.data.items.map((item) => (
              <ResourceDetails
                key={item.id}
                resource={item}
                me={me}
                institution={institutions.find(
                  (school) => school.id === item.institutionId,
                )}
                refresh={data.reload}
              />
            ))
          ) : (
            <div className="resource-grid">
              {data.data.items.map((item) => (
                <article className="resource-tile" key={item.id}>
                  <div
                    className={`resource-visual resource-${item.category}`}
                    aria-hidden="true"
                  >
                    <span>{item.category}</span>
                    <span className="resource-drawing">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                  <div className="resource-tile-body">
                    <StateLabel
                      state={item.active ? "available" : "inactive"}
                    />
                    <h3>
                      <a href={`#/resources/${item.id}`}>{item.name}</a>
                    </h3>
                    <p>{item.location}</p>
                    <div className="record-meta">
                      <span>Up to {item.capacity} people</span>
                      {item.distanceKm !== null && (
                        <span>{item.distanceKm.toFixed(1)} km away</span>
                      )}
                    </div>
                    <p className="resource-price">
                      {money(resourceRate(item, me), item.currency)}
                      <span>/ hour</span>
                    </p>
                    <p className="workflow-caption">
                      {item.requiresApproval
                        ? "Staff approval required"
                        : "Instant confirmation if eligible"}
                      {item.safetyCode ? ` · Safety: ${item.safetyCode}` : ""}
                    </p>
                    <a
                      className="workflow-inline-link"
                      href={`#/resources/${item.id}`}
                    >
                      View resource →
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
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
export function resourceRate(resource: Schemas["Resource"], me: Schemas["Me"]) {
  return me.memberships.some(
    (item) =>
      item.institutionId === resource.institutionId &&
      item.status === "verified" &&
      (!item.validUntil || Date.parse(item.validUntil) > Date.now()),
  )
    ? resource.hourlyRate
    : resource.externalHourlyRate;
}
function resourceFields(resource?: Schemas["Resource"]): ActionField[] {
  return [
    {
      name: "name",
      label: "Resource name",
      initial: resource?.name,
      maxLength: 150,
    },
    {
      name: "description",
      label: "Description and usage guidance",
      type: "textarea",
      initial: resource?.description,
      maxLength: 3000,
    },
    {
      name: "category",
      label: "Category",
      type: "select",
      initial: resource?.category,
      options: ["room", "studio", "equipment", "workshop", "other"].map(
        (value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }),
      ),
    },
    {
      name: "location",
      label: "Location / room directions",
      initial: resource?.location,
      maxLength: 300,
    },
    {
      name: "latitude",
      label: "Latitude",
      type: "number",
      initial: String(resource?.latitude ?? 1.3521),
      min: -90,
      max: 90,
      step: 0.000001,
    },
    {
      name: "longitude",
      label: "Longitude",
      type: "number",
      initial: String(resource?.longitude ?? 103.8198),
      min: -180,
      max: 180,
      step: 0.000001,
    },
    {
      name: "currency",
      label: "Currency (3-letter code)",
      initial: resource?.currency || "SGD",
      maxLength: 3,
    },
    {
      name: "hourlyRate",
      label: "Own-school hourly rate (minor units)",
      type: "number",
      initial: String(resource?.hourlyRate ?? 0),
      min: 0,
      max: 10000000,
      hint: "SGD 100 minor units = S$1.00.",
    },
    {
      name: "externalHourlyRate",
      label: "Other-school hourly rate (minor units)",
      type: "number",
      initial: String(resource?.externalHourlyRate ?? 0),
      min: 0,
      max: 10000000,
    },
    {
      name: "capacity",
      label: "Maximum attendees",
      type: "number",
      initial: String(resource?.capacity ?? 1),
      min: 1,
      max: 1000,
    },
    {
      name: "safetyCode",
      label: "Required safety credential (optional)",
      initial: resource?.safetyCode || "",
      optional: true,
      maxLength: 100,
    },
    {
      name: "crossSchool",
      label: "Allow eligible students from other schools",
      type: "checkbox",
      initial: String(resource?.crossSchool ?? false),
      optional: true,
    },
    {
      name: "requiresApproval",
      label: "Require staff approval for reservations",
      type: "checkbox",
      initial: String(resource?.requiresApproval ?? false),
      optional: true,
    },
  ];
}
function resourceValues(
  values: Record<string, string>,
): Omit<Schemas["ResourceInput"], "institutionId"> {
  const currency = values.currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new ServiceError(
      "Enter a 3-letter currency code.",
      "VALIDATION_ERROR",
    );
  const latitude = Number(values.latitude),
    longitude = Number(values.longitude);
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    throw new ServiceError(
      "Enter valid latitude and longitude coordinates.",
      "VALIDATION_ERROR",
    );
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    category: values.category as Schemas["Resource"]["category"],
    location: values.location.trim(),
    latitude,
    longitude,
    currency,
    hourlyRate: integer(values.hourlyRate, "Own-school rate", 0, 10000000),
    externalHourlyRate: integer(
      values.externalHourlyRate,
      "Other-school rate",
      0,
      10000000,
    ),
    capacity: integer(values.capacity, "Capacity", 1, 1000),
    safetyCode: values.safetyCode.trim() || null,
    crossSchool: values.crossSchool === "true",
    requiresApproval: values.requiresApproval === "true",
  };
}

function ResourceDetails({
  resource,
  me,
  institution,
  refresh,
}: {
  resource: Schemas["Resource"];
  me: Schemas["Me"];
  institution?: Schemas["Institution"];
  refresh: () => void;
}) {
  const [range] = useState(() => period());
  const [editing, setEditing] = useState(false);
  const manager = manages(me, resource.institutionId);
  const schedule = useRemote(
    (signal) =>
      unwrap(
        api!.GET("/v1/resources/{id}/windows", {
          params: {
            path: { id: resource.id },
            query: manager ? { all: true } : range,
          },
          signal,
        }),
      ),
    `${resource.id}:${resource.version}`,
  );
  const action = useWorkflowAction(refresh);
  return (
    <>
      <SectionHeading
        title={resource.name}
        eyebrow={`${resource.category} · ${institution?.name || "Campus resource"}`}
      >
        {resource.description}
      </SectionHeading>
      <div className="workflow-layout">
        <div>
          <p className="workflow-notice">
            <MapPin size={18} />
            {resource.location}
          </p>
          <div className="record-actions">
            <a className="button primary" href="#/projects">
              Choose a project to book
            </a>
            {manager && (
              <>
                <button
                  className="button secondary"
                  onClick={() =>
                    action.open(
                      {
                        title: "Edit resource details",
                        description:
                          "Price and policy changes affect future quotes. Existing booking receipts remain unchanged.",
                        label: "Save resource",
                        fields: resourceFields(resource),
                        versioned: true,
                        run: async (values) => {
                          await unwrap(
                            api!.PATCH("/v1/resources/{id}", {
                              params: { path: { id: resource.id } },
                              body: {
                                version: resource.version,
                                ...resourceValues(values),
                              },
                            }),
                          );
                        },
                      },
                      "Resource details saved.",
                    )
                  }
                >
                  Edit resource
                </button>
                <button
                  className="button secondary"
                  disabled={!schedule.data}
                  onClick={() => setEditing(true)}
                >
                  Replace opening schedule
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    action.open(
                      {
                        title: resource.active
                          ? "Pause new bookings?"
                          : "Reopen this resource?",
                        description:
                          "This changes availability for future bookings. Existing reservations remain in the booking list.",
                        label: resource.active
                          ? "Pause resource"
                          : "Reopen resource",
                        fields: [],
                        versioned: true,
                        run: async () => {
                          await unwrap(
                            api!.PATCH("/v1/resources/{id}", {
                              params: { path: { id: resource.id } },
                              body: {
                                version: resource.version,
                                active: !resource.active,
                              },
                            }),
                          );
                        },
                      },
                      "Resource availability updated.",
                    )
                  }
                >
                  {resource.active ? "Pause resource" : "Reopen resource"}
                </button>
              </>
            )}
          </div>
          {action.notice}
          <h3 className="section-subtitle">
            Opening windows · {manager ? "complete schedule" : "next 30 days"}
          </h3>
          <LoadState
            loading={schedule.loading && !schedule.data}
            error={schedule.error}
            retry={schedule.reload}
          />
          {schedule.data?.length === 0 && (
            <EmptyState title="No opening windows in this period">
              This resource cannot be reserved outside its published opening
              windows.
            </EmptyState>
          )}
          {schedule.data?.map((window) => (
            <div className="workflow-record" key={window.id}>
              <p>
                {dateTime(window.startsAt, me.timezone)} →{" "}
                {dateTime(window.endsAt, me.timezone)}
              </p>
              <span className="workflow-caption">{me.timezone}</span>
            </div>
          ))}
        </div>
        <aside className="workflow-aside">
          <h3>Before you book</h3>
          <dl>
            <dt>Your estimated hourly rate</dt>
            <dd>{money(resourceRate(resource, me), resource.currency)}</dd>
            <dt>Capacity</dt>
            <dd>{resource.capacity} people</dd>
            <dt>Access</dt>
            <dd>
              {resource.crossSchool
                ? "Eligible students across schools"
                : "Verified members of this institution"}
            </dd>
            <dt>Approval</dt>
            <dd>
              {resource.requiresApproval
                ? "Staff review required"
                : "Confirmed when eligible and available"}
            </dd>
            <dt>Safety</dt>
            <dd>{resource.safetyCode || "No additional credential listed"}</dd>
          </dl>
          <p className="workflow-caption">
            Your final quote may include a voucher. BuildZ does not charge a
            payment card; payment is managed by the school.
          </p>
        </aside>
      </div>
      {editing && (
        <ScheduleEditor
          title="Replace the complete opening schedule"
          initial={schedule.data || []}
          onClose={() => setEditing(false)}
          onSave={async (windows, key) => {
            await unwrap(
              api!.POST("/v1/resources/{id}/windows", {
                params: {
                  path: { id: resource.id },
                  header: { "Idempotency-Key": key },
                },
                body: { windows },
              }),
            );
            schedule.reload();
            refresh();
          }}
        />
      )}
      {action.dialog}
    </>
  );
}

export function Availability({ me }: { me: Schemas["Me"] }) {
  const [editing, setEditing] = useState(false);
  const data = useRemote(
    (signal) =>
      unwrap(
        api!.GET("/v1/me/availability", {
          params: { query: { all: true } },
          signal,
        }),
      ),
    me.id,
  );
  return (
    <>
      <SectionHeading
        eyebrow="MAKE TIME TO BUILD"
        title="Your availability"
        action={
          <button
            className="button primary"
            disabled={!data.data}
            onClick={() => setEditing(true)}
          >
            <Plus size={17} />
            Replace full schedule
          </button>
        }
      >
        Share when you can work. Teammates can use these windows for matching;
        your private calendar details are not exposed.
      </SectionHeading>
      <p className="workflow-caption">
        Showing your complete schedule in {me.timezone}. Booking conflicts are
        checked separately by the server.
      </p>
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data?.length === 0 && (
        <EmptyState title="When do ideas fit into your week?">
          Add your available windows so project members can find a time that
          works together.
        </EmptyState>
      )}
      {data.data?.map((window) => (
        <article className="workflow-record" key={window.id}>
          <h3>{dateTime(window.startsAt, me.timezone)}</h3>
          <p>Until {dateTime(window.endsAt, me.timezone)}</p>
        </article>
      ))}
      {editing && (
        <ScheduleEditor
          title="Replace your complete availability"
          initial={data.data || []}
          onClose={() => setEditing(false)}
          onSave={async (windows, key) => {
            await unwrap(
              api!.POST("/v1/me/availability", {
                params: { header: { "Idempotency-Key": key } },
                body: { windows },
              }),
            );
            data.reload();
          }}
        />
      )}
      <SafetyCredentials me={me} />
    </>
  );
}
export function SafetyCredentials({ me }: { me: Schemas["Me"] }) {
  const data = useRemote(
    (signal) =>
      unwrap(
        api!.GET("/v1/me/safety-credentials", {
          params: { query: { limit: 100 } },
          signal,
        }),
      ),
    me.id,
  );
  return (
    <section>
      <SectionHeading title="Your safety credentials">
        Some equipment needs current training. Only an authorized resource
        manager can verify a credential.
      </SectionHeading>
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data?.length === 0 && (
        <p className="workflow-caption">
          No safety credentials are recorded for this account.
        </p>
      )}
      {data.data?.map((item) => (
        <article className="workflow-record" key={item.id}>
          <StateLabel
            state={
              item.revokedAt
                ? "revoked"
                : Date.parse(item.validUntil) < Date.now()
                  ? "expired"
                  : "active"
            }
          />
          <h3>{item.safetyCode}</h3>
          <p>Valid until {dateTime(item.validUntil, me.timezone)}</p>
        </article>
      ))}
    </section>
  );
}
