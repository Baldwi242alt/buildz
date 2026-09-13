import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import type { Context } from './context.js';
import { record } from './context.js';
import { ApiError, conflict } from './errors.js';
import {
  one,
  many,
  permitted,
  interval,
  listClause,
  listed,
  editableProject,
} from './workflow-utils.js';

export async function getResource(ctx: Context) {
  return one(
    ctx,
    sql`select *,null::float8 as distance_km from app.resources where id=${ctx.params.id}::uuid`,
  );
}
export async function getResourceCalendar(ctx: Context) {
  await getResource(ctx);
  const {from,to}=interval(ctx.query.startsAt,ctx.query.endsAt,24*42);
  const windows=await many(ctx,sql`select greatest(starts_at,${from}::timestamptz) as starts_at,least(ends_at,${to}::timestamptz) as ends_at from app.resource_windows where resource_id=${ctx.params.id}::uuid and starts_at<${to} and ends_at>${from} order by starts_at`);
  const busy=await many(ctx,sql`select greatest(starts_at,${from}::timestamptz) as starts_at,least(ends_at,${to}::timestamptz) as ends_at from app.resource_busy(${ctx.params.id}::uuid,${from},${to}) order by starts_at`);
  return {windows,busy};
}
export async function getTeamCalendar(ctx: Context) {
  await permitted(ctx,sql<boolean>`app.is_project_member(${ctx.params.id}::uuid)`);
  const {from,to}=interval(ctx.query.startsAt,ctx.query.endsAt,24*42);
  const members=await many(ctx,sql`select m.user_id,p.display_name from app.project_memberships m join app.profiles p on p.id=m.user_id where m.project_id=${ctx.params.id}::uuid order by p.display_name,m.user_id`);
  const ids=members.map(m=>m.userId);
  const windows=await many(ctx,sql`select user_id,greatest(starts_at,${from}::timestamptz) as starts_at,least(ends_at,${to}::timestamptz) as ends_at from app.team_windows(${ctx.params.id}::uuid,${ids}::uuid[],${from},${to}) order by starts_at`);
  const busy=await many(ctx,sql`select user_id,greatest(starts_at,${from}::timestamptz) as starts_at,least(ends_at,${to}::timestamptz) as ends_at from app.team_busy(${ctx.params.id}::uuid,${ids}::uuid[],${from},${to}) order by starts_at`);
  return {members:members.map(m=>({...m,windows:windows.filter(w=>w.userId===m.userId).map(({userId,...w})=>w),busy:busy.filter(w=>w.userId===m.userId).map(({userId,...w})=>w)}))};
}
export async function createResource(ctx: Context) {
  const b = ctx.body;
  const r = await one(
    ctx,
    sql`insert into app.resources(institution_id,name,description,category,location,latitude,longitude,currency,hourly_rate,external_hourly_rate,cross_school,requires_approval,safety_code,capacity)
    values(${b.institutionId as string}::uuid,${b.name as string},${b.description as string},${b.category as string},${b.location as string},${b.latitude as number},${b.longitude as number},
      ${b.currency as string},${b.hourlyRate as number},${b.externalHourlyRate as number},${b.crossSchool as boolean},${b.requiresApproval as boolean},${b.safetyCode as string | null},${b.capacity as number}) returning *,null::float8 as distance_km`,
  );
  await record(ctx, 'resource.created', r.id);
  return r;
}
export async function updateResource(ctx: Context) {
  const r = await one(
    ctx,
    sql`select * from app.resources where id=${ctx.params.id}::uuid for update`,
  );
  await permitted(ctx, sql<boolean>`app.manages_resource(${r.id}::uuid)`);
  if (r.version !== ctx.body.version) throw conflict();
  const fields: Record<string, string> = {
    name: 'name',
    description: 'description',
    category: 'category',
    location: 'location',
    latitude: 'latitude',
    longitude: 'longitude',
    currency: 'currency',
    hourlyRate: 'hourly_rate',
    externalHourlyRate: 'external_hourly_rate',
    crossSchool: 'cross_school',
    requiresApproval: 'requires_approval',
    safetyCode: 'safety_code',
    capacity: 'capacity',
    active: 'active',
  };
  const sets = Object.entries(ctx.body)
    .filter(([k]) => fields[k])
    .map(([k, v]) => sql`${sql.ref(fields[k]!)}=${v}`);
  if (!sets.length)
    throw new ApiError(
      422,
      'NO_CHANGES',
      'Provide at least one field to update.',
    );
  const updated = await one(
    ctx,
    sql`update app.resources set ${sql.join(sets)},version=version+1 where id=${r.id}::uuid returning *,null::float8 as distance_km`,
  );
  await record(ctx, 'resource.updated', r.id);
  return updated;
}
export async function listResources(ctx: Context) {
  const q = ctx.query;
  const limit = Number(q.limit ?? 20);
  const sort = String(q.sort ?? 'newest');
  if (
    (q.latitude === undefined) !== (q.longitude === undefined) ||
    (sort === 'nearest' && q.latitude === undefined)
  )
    throw new ApiError(
      422,
      'LOCATION_REQUIRED',
      'Provide both latitude and longitude for distance sorting.',
    );
  if (sort === 'cheapest' && !q.currency)
    throw new ApiError(
      422,
      'CURRENCY_REQUIRED',
      'Choose one currency to compare prices.',
    );
  const dist =
    q.latitude === undefined
      ? sql`null::float8`
      : sql`6371*acos(least(1.0,greatest(-1.0,sin(radians(latitude))*sin(radians(${q.latitude as number}::float8))+cos(radians(latitude))*cos(radians(${q.latitude as number}::float8))*cos(radians(longitude-${q.longitude as number}::float8)))))`;
  const price = sql`case when app.verified_at(${ctx.actor.id}::uuid,institution_id) then hourly_rate else external_hourly_rate end`;
  const key =
    sort === 'nearest'
      ? dist
      : sort === 'cheapest'
        ? price
        : sql`-extract(epoch from created_at)::float8`;
  const signature = createHash('sha256')
    .update(
      JSON.stringify({
        sort,
        latitude: q.latitude,
        longitude: q.longitude,
        institutionId: q.institutionId,
        category: q.category,
        currency: q.currency,
      }),
    )
    .digest('hex');
  let after = sql``;
  if (q.cursor) {
    try {
      const p = JSON.parse(
        Buffer.from(String(q.cursor), 'base64url').toString(),
      );
      if (
        p.signature !== signature ||
        !Number.isFinite(p.key) ||
        !Number.isFinite(p.price) ||
        typeof p.currency !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(p.id)
      )
        throw new Error();
      after = sql`and (sort_key,currency,price_key,id)>(${p.key}::float8,${p.currency},${p.price},${p.id}::uuid)`;
    } catch {
      throw new ApiError(
        400,
        'INVALID_CURSOR',
        'Cursor must match the resource filters.',
      );
    }
  }
  const result = await many(
    ctx,
    sql`select * from (select *,${dist} as distance_km,${key} as sort_key,${price} as price_key from app.resources where true
    ${q.institutionId ? sql`and institution_id=${q.institutionId as string}::uuid` : sql``}
    ${q.category ? sql`and category=${q.category as string}` : sql``}${q.currency ? sql`and currency=${q.currency as string}` : sql``}) r where true ${after} order by sort_key,currency,price_key,id limit ${limit + 1}`,
  );
  const items = result.slice(0, limit),
    last = items.at(-1);
  const nextCursor =
    result.length > limit && last
      ? Buffer.from(
          JSON.stringify({
            signature,
            key: Number(last.sortKey),
            currency: last.currency,
            price: Number(last.priceKey),
            id: last.id,
          }),
        ).toString('base64url')
      : null;
  return { items: items.map(({ sortKey, priceKey, ...r }) => r), nextCursor };
}
export async function listResourceWindows(ctx: Context) {
  await getResource(ctx);
  if (ctx.query.all === true) {
    await permitted(
      ctx,
      sql<boolean>`app.manages_resource(${ctx.params.id}::uuid)`,
    );
    return many(
      ctx,
      sql`select * from app.resource_windows where resource_id=${ctx.params.id}::uuid order by starts_at,id limit 100`,
    );
  }
  const { from, to } = interval(ctx.query.startsAt, ctx.query.endsAt);
  return many(
    ctx,
    sql`select * from app.resource_windows where resource_id=${ctx.params.id}::uuid and starts_at<${to} and ends_at>${from} order by starts_at,id limit 100`,
  );
}
export async function setResourceWindows(ctx: Context) {
  const r = await one(
    ctx,
    sql`select * from app.resources where id=${ctx.params.id}::uuid for update`,
  );
  await permitted(ctx, sql<boolean>`app.manages_resource(${r.id}::uuid)`);
  const spans = (
    ctx.body.windows as { startsAt: string; endsAt: string }[]
  ).map((w) => interval(w.startsAt, w.endsAt));
  const booked = await many(
    ctx,
    sql`select starts_at,ends_at from app.bookings where resource_id=${r.id}::uuid and state in ('pending','confirmed') and ends_at>now()`,
  );
  if (
    booked.some(
      (b) =>
        !spans.some(
          (w) =>
            +w.from <= Date.parse(b.startsAt) && +w.to >= Date.parse(b.endsAt),
        ),
    )
  )
    throw conflict(
      'ACTIVE_BOOKINGS',
      'The new opening windows must preserve existing reservations.',
    );
  await sql`delete from app.resource_windows where resource_id=${r.id}::uuid`.execute(
    ctx.tx,
  );
  for (const w of spans)
    await sql`insert into app.resource_windows(resource_id,starts_at,ends_at) values(${r.id}::uuid,${w.from},${w.to})`.execute(
      ctx.tx,
    );
  await sql`update app.resources set version=version+1 where id=${r.id}::uuid`.execute(
    ctx.tx,
  );
  await record(ctx, 'resource.windows_changed', r.id);
  return many(
    ctx,
    sql`select * from app.resource_windows where resource_id=${r.id}::uuid order by starts_at,id`,
  );
}
export async function listAvailability(ctx: Context) {
  if (ctx.query.all === true)
    return many(
      ctx,
      sql`select * from app.availability where user_id=${ctx.actor.id}::uuid order by starts_at,id limit 100`,
    );
  const { from, to } = interval(ctx.query.startsAt, ctx.query.endsAt);
  return many(
    ctx,
    sql`select * from app.availability where user_id=${ctx.actor.id}::uuid and starts_at<${to} and ends_at>${from} order by starts_at,id limit 100`,
  );
}
export async function setAvailability(ctx: Context) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${'availability:' + ctx.actor.id},0))`.execute(
    ctx.tx,
  );
  const spans = (
    ctx.body.windows as { startsAt: string; endsAt: string }[]
  ).map((w) => interval(w.startsAt, w.endsAt));
  await sql`delete from app.availability where user_id=${ctx.actor.id}::uuid`.execute(
    ctx.tx,
  );
  for (const w of spans)
    await sql`insert into app.availability(user_id,starts_at,ends_at) values(${ctx.actor.id}::uuid,${w.from},${w.to})`.execute(
      ctx.tx,
    );
  await record(ctx, 'availability.updated', ctx.actor.id);
  return many(
    ctx,
    sql`select * from app.availability where user_id=${ctx.actor.id}::uuid order by starts_at,id`,
  );
}
export async function grantSafety(ctx: Context) {
  if (Date.parse(String(ctx.body.validUntil)) <= Date.now())
    throw new ApiError(
      422,
      'INVALID_EXPIRY',
      'A credential must expire in the future.',
    );
  const b = ctx.body;
  const r = await one(
    ctx,
    sql`insert into app.safety_credentials(institution_id,user_id,safety_code,verified_by,valid_until)
    values(${b.institutionId as string}::uuid,${b.userId as string}::uuid,${b.safetyCode as string},${ctx.actor.id}::uuid,${b.validUntil as string}::timestamptz) returning *`,
  );
  await record(ctx, 'safety.granted', r.id);
  return r;
}
export async function revokeSafety(ctx: Context) {
  const r = await one(
    ctx,
    sql`update app.safety_credentials set revoked_at=now() where id=${ctx.params.id}::uuid returning *`,
  );
  await record(ctx, 'safety.revoked', r.id);
  return r;
}
export async function listSafety(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.safety_credentials where user_id=${ctx.actor.id}::uuid ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}

export async function searchBuildSlots(ctx: Context) {
  await editableProject(ctx, ctx.params.id!);
  const b = ctx.body;
  const { from, to } = interval(b.startsAt, b.endsAt, 24 * 14);
  const people = b.participantIds as string[],
    required =
      (b.requiredParticipantIds as string[]) ??
      (b.minimumAttendees === undefined ? people : []);
  const minimum = Number(b.minimumAttendees ?? people.length);
  if (required.some((id) => !people.includes(id)) || minimum > people.length)
    throw new ApiError(
      422,
      'INVALID_PARTICIPANTS',
      'Required people must be selected project members.',
    );
  const members = await many(
    ctx,
    sql`select user_id from app.project_memberships where project_id=${ctx.params.id}::uuid`,
  );
  if (people.some((id) => !members.some((m) => m.userId === id)))
    throw new ApiError(
      422,
      'INVALID_PARTICIPANTS',
      'Choose accepted project members only.',
    );
  const r = await one(
    ctx,
    sql`select * from app.resources where id=${b.resourceId as string}::uuid and active`,
  );
  const windows = await many(
    ctx,
    sql`select * from app.resource_windows where resource_id=${r.id}::uuid and starts_at<${to} and ends_at>${from}`,
  );
  const personal = await many(
    ctx,
    sql`select * from app.team_windows(${ctx.params.id}::uuid,${people}::uuid[],${from},${to})`,
  );
  const busy = await many(
    ctx,
    sql`select * from app.resource_busy(${r.id}::uuid,${from},${to})`,
  );
  const personBusy = await many(
    ctx,
    sql`select * from app.team_busy(${ctx.params.id}::uuid,${people}::uuid[],${from},${to})`,
  );
  const duration = Number(b.durationMinutes) * 60000;
  const result: any[] = [];
  const eligible = await many(
    ctx,
    sql`select * from app.participant_eligibility(${ctx.params.id}::uuid,${r.id}::uuid,${people}::uuid[],${to})`,
  );
  for (
    let start = Math.ceil(Math.max(+from, Date.now()) / 300000) * 300000;
    start + duration <= +to && result.length < 100;
    start += 900000
  ) {
    const end = start + duration;
    if (
      !windows.some(
        (w) => Date.parse(w.startsAt) <= start && Date.parse(w.endsAt) >= end,
      ) ||
      busy.some(
        (w) => Date.parse(w.startsAt) < end && Date.parse(w.endsAt) > start,
      )
    )
      continue;
    const available = people.filter(
      (id) =>
        eligible.some((e) => e.userId === id && e.eligible) &&
        personal.some(
          (w) =>
            w.userId === id &&
            Date.parse(w.startsAt) <= start &&
            Date.parse(w.endsAt) >= end,
        ) &&
        !personBusy.some(
          (w) =>
            w.userId === id &&
            Date.parse(w.startsAt) < end &&
            Date.parse(w.endsAt) > start,
        ),
    );
    if (
      available.length < minimum ||
      required.some((id) => !available.includes(id)) ||
      minimum > r.capacity
    )
      continue;
    const internal = await one(
      ctx,
      sql`select app.verified_at(${ctx.actor.id}::uuid,${r.institutionId}::uuid) as ok`,
    );
    result.push({
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
      resourceId: r.id,
      availableParticipantIds: available,
      estimatedTotalMinor: Math.ceil(
        ((internal.ok ? r.hourlyRate : r.externalHourlyRate) * duration) /
          3600000,
      ),
      currency: r.currency,
    });
  }
  return result;
}
