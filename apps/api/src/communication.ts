import { sql } from 'kysely';
import type { Context } from './context.js';
import { ApiError, conflict, forbidden } from './errors.js';
import {
  one,
  many,
  listClause,
  listed,
  permitted,
  interval,
  activity,
  editableProject,
} from './workflow-utils.js';
import { record } from './context.js';

async function consultationView(ctx: Context, c: any) {
  return {
    ...c,
    ...(await one(
      ctx,
      sql`select * from app.consultation_receipt(${c.id}::uuid)`,
    )),
  };
}

export async function createConsultationSlot(ctx: Context) {
  const b = ctx.body;
  const { from, to } = interval(b.startsAt, b.endsAt, 8);
  if (+from <= Date.now())
    throw new ApiError(
      422,
      'INVALID_SLOT',
      'Publish a future consultation slot.',
    );
  const r = await one(
    ctx,
    sql`insert into app.consultation_slots(institution_id,host_id,starts_at,ends_at,location,cross_school)
    values(${b.institutionId as string}::uuid,${ctx.actor.id}::uuid,${from},${to},${b.location as string},${b.crossSchool as boolean}) returning *`,
  );
  await record(ctx, 'consultation_slot.created', r.id);
  return r;
}
export async function listConsultationSlots(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.consultation_slots where active and starts_at>now() ${clause}
  ${ctx.query.institutionId ? sql`and institution_id=${ctx.query.institutionId as string}::uuid` : sql``}
  and not app.consultation_slot_taken(id) order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function closeConsultationSlot(ctx: Context) {
  const s = await one(
    ctx,
    sql`select * from app.consultation_slots where id=${ctx.params.id}::uuid for update`,
  );
  if (s.hostId !== ctx.actor.id) throw forbidden();
  if (
    (
      await one(
        ctx,
        sql`select app.consultation_slot_taken(${s.id}::uuid) as ok`,
      )
    ).ok
  )
    throw conflict(
      'SLOT_BOOKED',
      'Cancel the consultation before closing its slot.',
    );
  const r = await one(
    ctx,
    sql`update app.consultation_slots set active=false where id=${s.id}::uuid returning *`,
  );
  await record(ctx, 'consultation_slot.closed', r.id);
  return r;
}
export async function bookConsultation(ctx: Context) {
  await editableProject(ctx, String(ctx.body.projectId));
  await permitted(
    ctx,
    sql<boolean>`app.lock_member_project(${ctx.body.projectId as string}::uuid)`,
  );
  await permitted(
    ctx,
    sql<boolean>`app.lock_consultation_slot(${ctx.body.slotId as string}::uuid)`,
  );
  const s = await one(
    ctx,
    sql`select * from app.consultation_slots where id=${ctx.body.slotId as string}::uuid`,
  );
  const accepted=await many(ctx,sql`select id from app.mentorships where project_id=${ctx.body.projectId as string}::uuid and mentor_id=${s.hostId}::uuid and state='accepted' for update`);
  if(!accepted.length) throw conflict('MENTORSHIP_REQUIRED','This mentor must accept your project’s mentorship request before you can book.');
  await permitted(ctx,sql<boolean>`app.accepted_mentor(${ctx.body.projectId as string}::uuid,${s.hostId}::uuid)`);
  if (!s.active || Date.parse(s.startsAt) <= Date.now())
    throw conflict(
      'SLOT_UNAVAILABLE',
      'This consultation slot is unavailable.',
    );
  if (s.hostId === ctx.actor.id)
    throw new ApiError(
      422,
      'SELF_CONSULTATION',
      'You cannot book a consultation with yourself.',
    );
  await sql`select pg_advisory_xact_lock(hashtextextended(${'calendar:' + ctx.actor.id},0))`.execute(
    ctx.tx,
  );
  const busy = await many(
    ctx,
    sql`select * from app.team_busy(${ctx.body.projectId as string}::uuid,${[ctx.actor.id]}::uuid[],${s.startsAt}::timestamptz,${s.endsAt}::timestamptz)`,
  );
  if (busy.length)
    throw conflict(
      'ATTENDEE_BUSY',
      'You already have a reservation at this time.',
    );
  const c = await one(
    ctx,
    sql`insert into app.consultations(slot_id,project_id,booked_by,topic)
    values(${s.id}::uuid,${ctx.body.projectId as string}::uuid,${ctx.actor.id}::uuid,${ctx.body.topic as string}) returning *`,
  );
  await activity(ctx, c.projectId, 'consultation.booked', c.id);
  await sql`select app.notify_consultation_host(${c.id}::uuid)`.execute(ctx.tx);
  return consultationView(ctx, c);
}
export async function listConsultations(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  const result = await listed(
    ctx,
    sql`select * from app.consultations where true ${clause} ${ctx.query.projectId ? sql`and project_id=${ctx.query.projectId as string}::uuid` : sql``} order by created_at desc,id desc limit ${limit + 1}`,
  );
  return {
    ...result,
    items: await Promise.all(result.items.map((c) => consultationView(ctx, c))),
  };
}
export async function decideConsultation(ctx: Context) {
  const initial = await one(
    ctx,
    sql`select * from app.consultations where id=${ctx.params.id}::uuid`,
  );
  await permitted(
    ctx,
    sql<boolean>`app.lock_consultation_slot(${initial.slotId}::uuid)`,
  );
  const s = await one(
    ctx,
    sql`select * from app.consultation_slots where id=${initial.slotId}::uuid`,
  );
  const c = await one(
    ctx,
    sql`select * from app.consultations where id=${initial.id}::uuid for update`,
  );
  if (c.version !== ctx.body.version || c.state !== 'booked') throw conflict();
  const host = s.hostId === ctx.actor.id;
  const owner = (
    await one(ctx, sql`select app.is_project_owner(${c.projectId}::uuid) as ok`)
  ).ok;
  if (
    !host &&
    (ctx.body.decision !== 'cancelled' ||
      (c.bookedBy !== ctx.actor.id && !owner))
  )
    throw forbidden();
  if (ctx.body.decision === 'completed' && Date.parse(s.endsAt) > Date.now())
    throw conflict(
      'CONSULTATION_NOT_ENDED',
      'Complete the consultation after its end time.',
    );
  const r = await one(
    ctx,
    sql`update app.consultations set state=${ctx.body.decision as string},version=version+1 where id=${c.id}::uuid returning *`,
  );
  await activity(
    ctx,
    c.projectId,
    'consultation.' + String(ctx.body.decision),
    c.id,
  );
  await sql`select app.notify_consultation_host(${c.id}::uuid)`.execute(ctx.tx);
  return consultationView(ctx, r);
}
export async function listMessages(ctx: Context) {
  await permitted(
    ctx,
    sql<boolean>`app.is_project_member(${ctx.params.id}::uuid) or app.supervises_project(${ctx.params.id}::uuid)`,
  );
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.messages where project_id=${ctx.params.id}::uuid ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function sendMessage(ctx: Context) {
  await permitted(
    ctx,
    sql<boolean>`app.is_project_member(${ctx.params.id}::uuid) or app.supervises_project(${ctx.params.id}::uuid)`,
  );
  // Supervisors can message without joining the student team.
  const status = await one(
    ctx,
    sql`select app.project_is_active(${ctx.params.id}::uuid) as ok`,
  );
  if (!status.ok)
    throw conflict(
      'PROJECT_ARCHIVED',
      'Restore the project before sending messages.',
    );
  const m = await one(
    ctx,
    sql`insert into app.messages(project_id,sender_id,body) values(${ctx.params.id}::uuid,${ctx.actor.id}::uuid,${ctx.body.body as string}) returning *`,
  );
  await activity(ctx, m.projectId, 'message.created', m.id);
  return m;
}
export async function listNotifications(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.notifications where recipient_id=${ctx.actor.id}::uuid ${clause} ${ctx.query.unread === true ? sql`and read_at is null` : sql``} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function readNotification(ctx: Context) {
  return one(
    ctx,
    sql`update app.notifications set read_at=coalesce(read_at,now()) where id=${ctx.params.id}::uuid returning *`,
  );
}

export async function listStaff(ctx: Context) {
  return many(ctx, sql`select * from app.school_staff(${ctx.params.id}::uuid)`);
}
