import { sql } from 'kysely';
import { type Context, record, pagination, page } from './context.js';
import { ApiError, conflict, forbidden, missing } from './errors.js';
export type ProjectRow={id:string;lead_institution_id:string;owner_id:string;title:string;project_type:string;summary:string;lifecycle:string;version:number;created_at:Date;updated_at:Date};
export async function lockProject(ctx:Context,id=ctx.params.id!) {
  const {rows}=await sql<ProjectRow>`select * from app.projects where id=${id}::uuid for update`.execute(ctx.tx);
  if(!rows[0]) throw missing(); return rows[0];
}
async function present(ctx:Context,p:ProjectRow) {
  const {rows}=await sql<{role:string}>`select role from app.project_memberships where project_id=${p.id}::uuid and user_id=${ctx.actor.id}::uuid`.execute(ctx.tx);
  const owner=p.owner_id===ctx.actor.id; const editable=p.lifecycle!=='archived';
  const flags=await sql<{published:boolean;review:boolean;supervisor:boolean}>`select exists(select 1 from app.public_projects where id=${p.id}::uuid and published) as published,
    app.can_review_project(${p.id}::uuid) as review,app.supervises_project(${p.id}::uuid) as supervisor`.execute(ctx.tx);
  return {id:p.id,title:p.title,summary:p.summary,projectType:p.project_type,leadInstitutionId:p.lead_institution_id,
    ownerId:p.owner_id,lifecycle:p.lifecycle,publicationAudience:flags.rows[0]?.published?'public':'private',version:p.version,
    createdAt:p.created_at.toISOString(),updatedAt:p.updated_at.toISOString(),
    capabilities:{canEdit:editable&&(owner||rows[0]?.role==='editor'),canInvite:editable&&owner,canManageMembers:owner,
      canArchive:owner,canTransferOwnership:owner,canPublish:editable&&owner,canSubmitProposal:editable&&(owner||rows[0]?.role==='editor'),
      canReviewProgress:!!flags.rows[0]?.review,canMessage:editable&&(!!rows[0]||!!flags.rows[0]?.supervisor)}};
}
export async function getProject(ctx:Context) {
  const {rows}=await sql<ProjectRow>`select * from app.projects where id=${ctx.params.id}::uuid`.execute(ctx.tx);
  if(!rows[0]) throw missing(); return present(ctx,rows[0]);
}
export async function listProjects(ctx:Context) {
  const {limit,after}=pagination(ctx.query);
  const clause=after?sql`and (created_at,id)<(${after.createdAt}::timestamptz,${after.id}::uuid)`:sql``;
  const {rows}=await sql<ProjectRow>`select * from app.projects where true ${clause} order by created_at desc,id desc limit ${limit+1}`.execute(ctx.tx);
  return page(await Promise.all(rows.map(row=>present(ctx,row))),limit);
}
export async function reviewProjects(ctx:Context) {
  const {limit,after}=pagination(ctx.query);const clause=after?sql`and (created_at,id)<(${after.createdAt}::timestamptz,${after.id}::uuid)`:sql``;
  const {rows}=await sql<ProjectRow>`select * from app.projects where app.review_project_visible(id) ${clause} order by created_at desc,id desc limit ${limit+1}`.execute(ctx.tx);
  return page(await Promise.all(rows.map(row=>present(ctx,row))),limit);
}
export async function createProject(ctx:Context) {
  const {rows}=await sql<ProjectRow>`insert into app.projects(lead_institution_id,owner_id,title,project_type,summary)
    values(${ctx.body.leadInstitutionId as string}::uuid,${ctx.actor.id}::uuid,${ctx.body.title as string},${ctx.body.projectType as string},${ctx.body.summary as string}) returning *`.execute(ctx.tx);
  const p=rows[0]!;
  await sql`insert into app.project_memberships(project_id,user_id,role) values(${p.id}::uuid,${ctx.actor.id}::uuid,'editor')`.execute(ctx.tx);
  await record(ctx,'project.created',p.id); return present(ctx,p);
}
export async function updateProject(ctx:Context) {
  const p=await lockProject(ctx); if(p.version!==ctx.body.version) throw conflict();
  if(p.lifecycle==='archived') throw conflict('PROJECT_ARCHIVED','Restore this project before editing it.');
  const permission=await sql<{ok:boolean}>`select app.can_edit_project(${p.id}::uuid) as ok`.execute(ctx.tx);
  if(!permission.rows[0]?.ok) throw forbidden();
  const {rows}=await sql<ProjectRow>`update app.projects set title=coalesce(${ctx.body.title as string??null},title),
    summary=coalesce(${ctx.body.summary as string??null},summary),version=version+1,updated_at=now() where id=${p.id}::uuid returning *`.execute(ctx.tx);
  await record(ctx,'project.updated',p.id); return present(ctx,rows[0]!);
}
export async function transitionProject(ctx:Context) {
  const p=await lockProject(ctx); if(p.owner_id!==ctx.actor.id) throw forbidden();
  if(p.version!==ctx.body.version) throw conflict();
  const next=ctx.body.lifecycle as string;
  const allowed:Record<string,string[]>={idea:['active','archived'],active:['completed','archived'],completed:['active','archived'],archived:['idea']};
  if(!allowed[p.lifecycle]?.includes(next)) throw new ApiError(422,'INVALID_TRANSITION','This lifecycle transition is not allowed.');
  const {rows}=await sql<ProjectRow>`update app.projects set lifecycle=${next},version=version+1,updated_at=now() where id=${p.id}::uuid returning *`.execute(ctx.tx);
  if(next==='archived') {
    const active=await sql<{ok:boolean}>`select app.has_active_reservations(${p.id}::uuid,null) as ok`.execute(ctx.tx);
    if(active.rows[0]?.ok)throw conflict('ACTIVE_RESERVATIONS','Cancel upcoming bookings and consultations before archiving.');
    await sql`update app.project_invitations set state='revoked' where project_id=${p.id}::uuid and state='pending'`.execute(ctx.tx);
    await sql`update app.public_projects set published=false,version=version+1,updated_at=now() where id=${p.id}::uuid`.execute(ctx.tx);
    await sql`update app.collaboration_requests set state='declined',response='Project archived',version=version+1 where project_id=${p.id}::uuid and state='pending'`.execute(ctx.tx);
  }
  await record(ctx,'project.lifecycle_changed',p.id); return present(ctx,rows[0]!);
}
export async function listMembers(ctx:Context) {
  await getProject(ctx);
  const {rows}=await sql`select m.user_id as "userId",p.display_name as "displayName",
    case when j.owner_id=m.user_id then 'owner' else m.role end as role,m.joined_at as "joinedAt"
    from app.project_memberships m join app.profiles p on p.id=m.user_id join app.projects j on j.id=m.project_id
    where m.project_id=${ctx.params.id}::uuid order by m.joined_at,m.user_id`.execute(ctx.tx);
  return rows;
}
export async function removeMember(ctx:Context) {
  const reservations=await sql<{ok:boolean}>`select app.has_active_reservations(${ctx.params.id}::uuid,${ctx.params.userId}::uuid) as ok`.execute(ctx.tx);
  if(reservations.rows[0]?.ok)throw conflict('ACTIVE_RESERVATIONS','Cancel this member’s upcoming reservations before removing them or leaving.');
  if(ctx.params.userId===ctx.actor.id){
    const current=await getProject(ctx);
    if(current.ownerId===ctx.actor.id)throw conflict('OWNER_REQUIRED','Transfer ownership before the owner leaves.');
    const left=await sql<{ok:boolean}>`select app.leave_project(${ctx.params.id}::uuid,${ctx.body.version as number}) as ok`.execute(ctx.tx);
    if(!left.rows[0]?.ok)throw conflict();
    return {removed:true};
  }
  const p=await lockProject(ctx); const target=ctx.params.userId!;
  const active=await sql<{ok:boolean}>`select app.has_active_reservations(${p.id}::uuid,${target}::uuid) as ok`.execute(ctx.tx);
  if(active.rows[0]?.ok)throw conflict('ACTIVE_RESERVATIONS','Cancel this member’s upcoming reservations before removing them.');
  if(ctx.actor.id!==p.owner_id&&ctx.actor.id!==target) throw forbidden();
  if(p.owner_id===target) throw conflict('OWNER_REQUIRED','Transfer ownership before the owner leaves.');
  if(p.version!==ctx.body.version) throw conflict();
  const profile=await sql<{email:string}>`select email from app.profiles where id=${target}::uuid`.execute(ctx.tx);
  const removed=await sql`delete from app.project_memberships where project_id=${p.id}::uuid and user_id=${target}::uuid returning user_id`.execute(ctx.tx);
  if(!removed.rows.length) throw missing();
  // Revoke old pending offers to prevent an immediately removed member rejoining.
  await sql`update app.project_invitations set state='revoked' where project_id=${p.id}::uuid and state='pending'
    and recipient_email=${profile.rows[0]?.email??''}`.execute(ctx.tx);
  await sql`update app.projects set version=version+1,updated_at=now() where id=${p.id}::uuid`.execute(ctx.tx);
  await record(ctx,'project.member_removed',p.id,'project.member_changed'); return {removed:true};
}
export async function transferOwner(ctx:Context) {
  const p=await lockProject(ctx); if(p.owner_id!==ctx.actor.id) throw forbidden();
  if(p.version!==ctx.body.version) throw conflict();
  const target=ctx.body.newOwnerId as string;
  const member=await sql`select user_id from app.project_memberships where project_id=${p.id}::uuid and user_id=${target}::uuid`.execute(ctx.tx);
  if(!member.rows.length||target===p.owner_id) throw new ApiError(422,'INVALID_OWNER','Choose another accepted member.');
  const {rows}=await sql<ProjectRow>`update app.projects set owner_id=${target}::uuid,version=version+1,updated_at=now() where id=${p.id}::uuid returning *`.execute(ctx.tx);
  await record(ctx,'project.owner_changed',p.id,'project.member_changed'); return present(ctx,rows[0]!);
}
