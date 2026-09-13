import { sql } from 'kysely';
import type { Context } from './context.js';
import { record } from './context.js';
import { ApiError, conflict, forbidden } from './errors.js';
import { one, many, permitted, editableProject } from './workflow-utils.js';

async function present(ctx: Context, row: any) {
  return {...row,...await one(ctx,sql`select * from app.mentorship_labels(${row.id}::uuid)`)};
}
export async function listMentors(ctx: Context) {
  return many(ctx,sql`select * from app.mentor_directory(${ctx.query.institutionId as string ?? null}::uuid)`);
}
export async function listMentorships(ctx: Context) {
  if(ctx.params.id) await permitted(ctx,sql<boolean>`app.is_project_member(${ctx.params.id}::uuid)`);
  const rows=await many(ctx,sql`select * from app.mentorships where true ${ctx.params.id?sql`and project_id=${ctx.params.id}::uuid`:sql``} order by created_at desc,id desc limit 100`);
  return Promise.all(rows.map(row=>present(ctx,row)));
}
export const listProjectMentorships=listMentorships;
export async function requestMentorship(ctx: Context) {
  await editableProject(ctx,ctx.params.id!);
  await permitted(ctx,sql<boolean>`app.lock_member_project(${ctx.params.id}::uuid)`);
  const project=await one(ctx,sql`select * from app.projects where id=${ctx.params.id}::uuid`);
  if(ctx.body.mentorId===ctx.actor.id) throw new ApiError(422,'SELF_MENTORSHIP','Choose another person as your mentor.');
  await permitted(ctx,sql<boolean>`app.mentor_eligible(${ctx.body.mentorId as string}::uuid,${project.leadInstitutionId}::uuid)`);
  const existing=await many(ctx,sql`select id from app.mentorships where project_id=${project.id}::uuid and mentor_id=${ctx.body.mentorId as string}::uuid and state in ('pending','accepted')`);
  if(existing.length)throw conflict('MENTORSHIP_EXISTS','There is already a pending or accepted request with this mentor.');
  const row=await one(ctx,sql`insert into app.mentorships(project_id,mentor_id,requested_by,message) values(${project.id}::uuid,${ctx.body.mentorId as string}::uuid,${ctx.actor.id}::uuid,${ctx.body.message as string}) returning *`);
  await record(ctx,'mentorship.requested',row.id);
  await sql`select app.notify_mentorship(${row.id}::uuid)`.execute(ctx.tx);
  return present(ctx,row);
}
export async function decideMentorship(ctx: Context) {
  const row=await one(ctx,sql`select * from app.mentorships where id=${ctx.params.id}::uuid for update`);
  if(row.version!==ctx.body.version)throw conflict();
  const decision=String(ctx.body.decision);
  if(decision==='cancelled') {
    if(row.mentorId!==ctx.actor.id && row.requestedBy!==ctx.actor.id) await permitted(ctx,sql<boolean>`app.is_project_owner(${row.projectId}::uuid)`);
    if(!['pending','accepted'].includes(row.state))throw conflict();
    // Cancellation and reservation creation lock the same mentorship row.
    const future=await many(ctx,sql`select c.id from app.consultations c join app.consultation_slots s on s.id=c.slot_id where c.project_id=${row.projectId}::uuid and s.host_id=${row.mentorId}::uuid and c.state='booked' and s.ends_at>now()`);
    if(future.length)throw conflict('ACTIVE_CONSULTATIONS','Cancel upcoming consultations before ending mentorship.');
  } else {
    if(row.mentorId!==ctx.actor.id)throw forbidden();
    if(row.state!=='pending')throw conflict();
    if(decision==='accepted') {
      await permitted(ctx,sql<boolean>`app.project_is_active(${row.projectId}::uuid)`);
    }
  }
  const result=await one(ctx,sql`update app.mentorships set state=${decision},version=version+1 where id=${row.id}::uuid returning *`);
  if(decision==='accepted')await permitted(ctx,sql<boolean>`app.accepted_mentor(${row.projectId}::uuid,${ctx.actor.id}::uuid)`);
  await record(ctx,'mentorship.'+decision,row.id);
  await sql`select app.notify_mentorship(${row.id}::uuid)`.execute(ctx.tx);
  return present(ctx,result);
}
