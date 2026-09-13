import { sql } from 'kysely';
import type { Context } from './context.js';
import { conflict, ApiError, forbidden } from './errors.js';
import {
  one,
  listed,
  listClause,
  permitted,
  activity,
  editableProject,
} from './workflow-utils.js';
import { record } from './context.js';

function publicView(ctx: Context, p: any) {
  return { ...p, shareUrl: `${ctx.config.APP_ORIGIN}/showcase/${p.id}` };
}
export async function discoverProjects(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  const q = ctx.query;
  const result = await listed(
    ctx,
    sql`select * from app.public_projects where published ${clause}
    ${q.search ? sql`and (title ilike ${'%' + String(q.search).replace(/[\\%_]/g, '\\$&') + '%'} or summary ilike ${'%' + String(q.search).replace(/[\\%_]/g, '\\$&') + '%'})` : sql``}
    ${q.tag ? sql`and ${q.tag as string}=any(tags)` : sql``}${q.projectType ? sql`and project_type=${q.projectType as string}` : sql``}
    order by created_at desc,id desc limit ${limit + 1}`,
  );
  return { ...result, items: result.items.map((p) => publicView(ctx, p)) };
}
export async function getPublicProject(ctx: Context) {
  return publicView(
    ctx,
    await one(
      ctx,
      sql`select * from app.public_projects where id=${ctx.params.id}::uuid and published`,
    ),
  );
}
export async function publishProject(ctx: Context) {
  const p = await editableProject(ctx, ctx.params.id!);
  await permitted(ctx, sql<boolean>`app.is_project_owner(${p.id}::uuid)`);
  const locked = await one(
    ctx,
    sql`select * from app.projects where id=${p.id}::uuid for update`,
  );
  if (locked.version !== ctx.body.version) throw conflict();
  if (
    (
      await one(
        ctx,
        sql`select app.publication_blocked(${p.id}::uuid) as blocked`,
      )
    ).blocked
  )
    throw new ApiError(
      403,
      'PUBLICATION_BLOCKED',
      'Ask the school reviewer to resolve the moderation report before republishing.',
    );
  const body = ctx.body;
  const published = await one(
    ctx,
    sql`insert into app.public_projects(id,title,summary,project_type,tags,seeking)
    values(${p.id}::uuid,${body.title as string},${body.summary as string},${locked.projectType},${body.tags as string[]}::text[],${body.seeking as string})
    on conflict(id) do update set title=excluded.title,summary=excluded.summary,project_type=excluded.project_type,tags=excluded.tags,seeking=excluded.seeking,published=true,version=app.public_projects.version+1,updated_at=now() returning *`,
  );
  await sql`update app.projects set version=version+1,updated_at=now() where id=${p.id}::uuid`.execute(
    ctx.tx,
  );
  await activity(ctx, p.id, 'project.published');
  return publicView(ctx, published);
}
export async function unpublishProject(ctx: Context) {
  const p = await one(
    ctx,
    sql`select * from app.projects where id=${ctx.params.id}::uuid for update`,
  );
  await permitted(ctx, sql<boolean>`app.is_project_owner(${p.id}::uuid)`);
  if (p.version !== ctx.body.version) throw conflict();
  const result = await one(
    ctx,
    sql`update app.public_projects set published=false,version=version+1,updated_at=now() where id=${p.id}::uuid returning *`,
  );
  await sql`update app.projects set version=version+1,updated_at=now() where id=${p.id}::uuid`.execute(
    ctx.tx,
  );
  await record(ctx, 'project.unpublished', p.id);
  return publicView(ctx, result);
}
export async function requestCollaboration(ctx: Context) {
  await getPublicProject(ctx);
  const member = await one(
    ctx,
    sql`select app.is_project_member(${ctx.params.id}::uuid) as ok`,
  );
  if (member.ok)
    throw conflict('ALREADY_MEMBER', 'You already belong to this project.');
  const r = await one(
    ctx,
    sql`insert into app.collaboration_requests(project_id,requester_id,message,kind)
    values(${ctx.params.id}::uuid,${ctx.actor.id}::uuid,${ctx.body.message as string},${ctx.body.kind as string}) returning *`,
  );
  await record(ctx, 'collaboration.requested', r.id);
  await sql`select app.notify_collaboration(${r.id}::uuid)`.execute(ctx.tx);
  return r;
}
export async function listProjectRequests(ctx: Context) {
  await permitted(
    ctx,
    sql<boolean>`app.is_project_owner(${ctx.params.id}::uuid)`,
  );
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.collaboration_requests where project_id=${ctx.params.id}::uuid ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function listMyRequests(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.collaboration_requests where requester_id=${ctx.actor.id}::uuid ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function decideCollaboration(ctx: Context) {
  const initial = await one(
    ctx,
    sql`select * from app.collaboration_requests where id=${ctx.params.id}::uuid`,
  );
  // Requester withdrawal does not require private-project read access.
  if (ctx.body.decision !== 'withdrawn')
    await one(
      ctx,
      sql`select id from app.projects where id=${initial.projectId}::uuid for update`,
    );
  const r = await one(
    ctx,
    sql`select * from app.collaboration_requests where id=${initial.id}::uuid for update`,
  );
  if (r.version !== ctx.body.version || r.state !== 'pending') throw conflict();
  if (ctx.body.decision === 'withdrawn') {
    if (r.requesterId !== ctx.actor.id) throw forbidden();
  } else {
    await permitted(
      ctx,
      sql<boolean>`app.is_project_owner(${r.projectId}::uuid)`,
    );
    await editableProject(ctx, r.projectId);
    if (ctx.body.decision === 'accepted' && r.kind === 'join')
      await sql`insert into app.project_memberships(project_id,user_id,role) values(${r.projectId}::uuid,${r.requesterId}::uuid,'member') on conflict do nothing`.execute(
        ctx.tx,
      );
    await sql`update app.projects set version=version+1,updated_at=now() where id=${r.projectId}::uuid`.execute(
      ctx.tx,
    );
  }
  const updated = await one(
    ctx,
    sql`update app.collaboration_requests set state=${ctx.body.decision as string},response=${(ctx.body.response as string) ?? null},version=version+1 where id=${r.id}::uuid returning *`,
  );
  await record(ctx, 'collaboration.decided', r.id);
  await sql`select app.notify_collaboration(${r.id}::uuid)`.execute(ctx.tx);
  return updated;
}
export async function reportContent(ctx: Context) {
  await getPublicProject(ctx);
  const r = await one(
    ctx,
    sql`insert into app.content_reports(project_id,reporter_id,reason) values(${ctx.params.id}::uuid,${ctx.actor.id}::uuid,${ctx.body.reason as string}) returning *`,
  );
  await record(ctx, 'content.reported', r.id);
  return r;
}
export async function listReports(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.content_reports where state='pending' and app.reviews_project(project_id) ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function moderateReport(ctx: Context) {
  const r = await one(
    ctx,
    sql`select * from app.content_reports where id=${ctx.params.id}::uuid for update`,
  );
  await permitted(ctx, sql<boolean>`app.reviews_project(${r.projectId}::uuid)`);
  if (
    r.state !== 'pending' &&
    !(r.state === 'removed' && ctx.body.decision === 'dismissed')
  )
    throw conflict();
  if (ctx.body.decision === 'removed')
    await sql`update app.public_projects set published=false,version=version+1,updated_at=now() where id=${r.projectId}::uuid`.execute(
      ctx.tx,
    );
  const updated = await one(
    ctx,
    sql`update app.content_reports set state=${ctx.body.decision as string} where id=${r.id}::uuid returning *`,
  );
  await record(ctx, 'content.moderated', r.id);
  return updated;
}
