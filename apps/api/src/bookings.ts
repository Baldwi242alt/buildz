import { sql } from 'kysely';
import type { Context } from './context.js';
import { ApiError, conflict, forbidden } from './errors.js';
import {
  one,
  many,
  permitted,
  interval,
  listClause,
  listed,
  editableProject,
  activity,
} from './workflow-utils.js';

/** Resource -> sorted attendee locks -> voucher is the global reservation lock order. */
async function quote(ctx: Context, locked = false) {
  const b = ctx.body;
  await editableProject(ctx, String(b.projectId));
  if (locked)
    await permitted(
      ctx,
      sql<boolean>`app.lock_member_project(${b.projectId as string}::uuid)`,
    );
  const { from, to } = interval(b.startsAt, b.endsAt, 8);
  if (
    +from <= Date.now() ||
    +from > Date.now() + 180 * 86400000 ||
    (+to - +from) % 60000
  )
    throw new ApiError(
      422,
      'INVALID_BOOKING_TIME',
      'Choose whole minutes in the next 180 days.',
    );
  if (locked)
    await permitted(
      ctx,
      sql<boolean>`app.lock_resource(${b.resourceId as string}::uuid)`,
    );
  const r = await one(
    ctx,
    sql`select * from app.resources where id=${b.resourceId as string}::uuid`,
  );
  if (!r.active)
    throw conflict(
      'RESOURCE_UNAVAILABLE',
      'This resource is not currently available.',
    );
  const people = b.attendees as string[];
  if (!people.includes(ctx.actor.id))
    throw new ApiError(
      422,
      'BOOKER_REQUIRED',
      'The booking creator must be an attendee.',
    );
  if (people.length > r.capacity)
    throw new ApiError(
      422,
      'CAPACITY_EXCEEDED',
      'Too many attendees for this resource.',
    );
  if (locked)
    for (const person of [...people].sort())
      await sql`select pg_advisory_xact_lock(hashtextextended(${'calendar:' + person},0))`.execute(
        ctx.tx,
      );
  const eligible = await many(
    ctx,
    sql`select * from app.participant_eligibility(${b.projectId as string}::uuid,${r.id}::uuid,${people}::uuid[],${to})`,
  );
  if (eligible.length !== people.length || eligible.some((e) => !e.eligible))
    throw new ApiError(
      422,
      'ATTENDEE_INELIGIBLE',
      'All attendees must be accepted members with valid school affiliation and required safety credentials through the booking end.',
    );
  const windows = await many(
    ctx,
    sql`select id from app.resource_windows where resource_id=${r.id}::uuid and starts_at<=${from} and ends_at>=${to}`,
  );
  if (!windows.length)
    throw conflict(
      'OUTSIDE_OPENING_HOURS',
      'The resource is not open for the entire selected interval.',
    );
  const busy = await many(
    ctx,
    sql`select * from app.resource_busy(${r.id}::uuid,${from},${to})`,
  );
  if (busy.length)
    throw conflict(
      'SLOT_UNAVAILABLE',
      'This resource has already been reserved.',
    );
  const personBusy = await many(
    ctx,
    sql`select * from app.team_busy(${b.projectId as string}::uuid,${people}::uuid[],${from},${to})`,
  );
  if (personBusy.length)
    throw conflict(
      'ATTENDEE_BUSY',
      'An attendee already has a reservation at this time.',
    );
  const internal = await one(
    ctx,
    sql`select app.verified_at(${ctx.actor.id}::uuid,${r.institutionId}::uuid) as ok`,
  );
  const subtotalMinor = Math.ceil(
    ((internal.ok ? r.hourlyRate : r.externalHourlyRate) * (+to - +from)) /
      3600000,
  );
  let discountMinor = 0,
    voucherId: string | null = null;
  if (b.voucherCode) {
    const initial = await one(
      ctx,
      sql`select id from app.vouchers where institution_id=${r.institutionId}::uuid and code=${String(b.voucherCode).toUpperCase()}`,
    );
    if (locked)
      await permitted(ctx, sql<boolean>`app.lock_voucher(${initial.id}::uuid)`);
    const v = await one(
      ctx,
      sql`select * from app.vouchers where id=${initial.id}::uuid`,
    );
    if (
      !v.active ||
      Date.parse(v.validUntil) <= Date.now() ||
      v.currency !== r.currency
    )
      throw new ApiError(
        422,
        'VOUCHER_INVALID',
        'This voucher is inactive, expired or uses a different currency.',
      );
    const usage = await one(
      ctx,
      sql`select * from app.voucher_usage(${v.id}::uuid)`,
    );
    discountMinor = Math.min(v.discountMinor, subtotalMinor);
    if (
      Number(usage.spent) + discountMinor > v.budgetMinor ||
      Number(usage.redemptions) >= v.maxRedemptions
    )
      throw conflict(
        'VOUCHER_EXHAUSTED',
        'This voucher has reached its redemption limit.',
      );
    voucherId = v.id;
  }
  return {
    resourceId: r.id,
    resourceVersion: r.version,
    startsAt: from.toISOString(),
    endsAt: to.toISOString(),
    currency: r.currency,
    subtotalMinor,
    discountMinor,
    totalMinor: subtotalMinor - discountMinor,
    requiresApproval: r.requiresApproval,
    voucherId,
    validUntil: new Date(Date.now() + 5 * 60000).toISOString(),
    paymentMode: 'school_managed',
  };
}
export async function quoteBooking(ctx: Context) {
  return quote(ctx);
}
export async function createBooking(ctx: Context) {
  const q = await quote(ctx, true);
  if (
    ctx.body.resourceVersion !== q.resourceVersion ||
    ctx.body.expectedTotalMinor !== q.totalMinor
  )
    throw conflict('QUOTE_CHANGED', 'Refresh the quote before confirming.');
  const state = q.requiresApproval ? 'pending' : 'confirmed';
  const expires = q.requiresApproval
    ? new Date(Math.min(Date.now() + 24 * 3600000, Date.parse(q.startsAt)))
    : null;
  const b = await one(
    ctx,
    sql`insert into app.bookings(resource_id,project_id,booked_by,starts_at,ends_at,state,attendees,currency,subtotal_minor,discount_minor,total_minor,voucher_id,expires_at)
    values(${q.resourceId}::uuid,${ctx.body.projectId as string}::uuid,${ctx.actor.id}::uuid,${q.startsAt}::timestamptz,${q.endsAt}::timestamptz,${state},${ctx.body.attendees as string[]}::uuid[],
      ${q.currency},${q.subtotalMinor},${q.discountMinor},${q.totalMinor},${q.voucherId}::uuid,${expires}) returning *`,
  );
  if (q.voucherId && q.discountMinor > 0)
    await sql`insert into app.credit_ledger(voucher_id,booking_id,amount_minor,kind) values(${q.voucherId}::uuid,${b.id}::uuid,${q.discountMinor},'redeem')`.execute(
      ctx.tx,
    );
  await activity(ctx, b.projectId, 'booking.created', b.id);
  return b;
}
export async function listBookings(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.bookings where true ${clause}
    ${ctx.query.projectId ? sql`and project_id=${ctx.query.projectId as string}::uuid` : sql``}${ctx.query.resourceId ? sql`and resource_id=${ctx.query.resourceId as string}::uuid` : sql``}
    order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function getBooking(ctx: Context) {
  return one(
    ctx,
    sql`select * from app.bookings where id=${ctx.params.id}::uuid`,
  );
}
export async function decideBooking(ctx: Context) {
  const initial = await getBooking(ctx);
  await permitted(
    ctx,
    sql<boolean>`app.lock_resource(${initial.resourceId}::uuid)`,
  );
  const b = await one(
    ctx,
    sql`select * from app.bookings where id=${initial.id}::uuid for update`,
  );
  const manager = (
    await one(
      ctx,
      sql`select app.manages_resource(${b.resourceId}::uuid) as ok`,
    )
  ).ok;
  const owner = (
    await one(ctx, sql`select app.is_project_owner(${b.projectId}::uuid) as ok`)
  ).ok;
  const next = String(ctx.body.decision);
  if (
    !manager &&
    (next !== 'cancelled' || (!owner && b.bookedBy !== ctx.actor.id))
  )
    throw forbidden();
  if (b.version !== ctx.body.version) throw conflict();
  const allowed: Record<string, string[]> = {
    pending: ['confirmed', 'cancelled', 'rejected'],
    confirmed: ['cancelled', 'completed', 'no_show'],
  };
  if (!allowed[b.state]?.includes(next))
    throw conflict(
      'INVALID_TRANSITION',
      'This booking cannot make that transition.',
    );
  if (b.state === 'pending' && Date.parse(b.expiresAt) <= Date.now())
    throw conflict(
      'BOOKING_EXPIRED',
      'The reservation approval period has expired.',
    );
  if (next === 'cancelled' && Date.parse(b.startsAt) <= Date.now() && !manager)
    throw conflict(
      'CANCELLATION_CLOSED',
      'Ask the resource manager about a booking that has started.',
    );
  if (
    ['completed', 'no_show'].includes(next) &&
    Date.parse(b.endsAt) > Date.now()
  )
    throw conflict(
      'BOOKING_NOT_ENDED',
      'Record attendance after the booking ends.',
    );
  if (next === 'confirmed') {
    // Staff cannot confirm after safety credentials or school affiliation have been revoked.
    const ok = await one(
      ctx,
      sql`select app.booking_attendees_valid(${b.id}::uuid) as ok`,
    );
    if (!ok.ok)
      throw new ApiError(
        422,
        'ATTENDEE_INELIGIBLE',
        'An attendee no longer satisfies the booking rules.',
      );
  }
  if (b.voucherId)
    await permitted(ctx, sql<boolean>`app.lock_voucher(${b.voucherId}::uuid)`);
  const updated = await one(
    ctx,
    sql`update app.bookings set state=${next},decision_reason=${ctx.body.reason as string},version=version+1 where id=${b.id}::uuid returning *`,
  );
  if (
    ['cancelled', 'rejected'].includes(next) &&
    b.voucherId &&
    b.discountMinor > 0
  )
    await sql`insert into app.credit_ledger(voucher_id,booking_id,amount_minor,kind)
    values(${b.voucherId}::uuid,${b.id}::uuid,${-b.discountMinor},'release')`.execute(
      ctx.tx,
    );
  await activity(ctx, b.projectId, 'booking.' + next, b.id);
  return updated;
}
