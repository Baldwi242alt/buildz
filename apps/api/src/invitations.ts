import { sql } from 'kysely';
import { type Context, record, page, pagination } from './context.js';
import { conflict, forbidden, missing } from './errors.js';
import { lockProject } from './projects.js';
type Invitation={id:string;project_id:string;recipient_email:string;role:string;state:string;expires_at:Date;created_at:Date;invited_by:string;accepted_by:string|null};
function present(ctx:Context,i:Invitation) {
  return {id:i.id,projectId:i.project_id,recipientEmail:i.recipient_email,role:i.role,
    state:i.state==='pending'&&i.expires_at.getTime()<=Date.now()?'expired':i.state,
    expiresAt:i.expires_at.toISOString(),createdAt:i.created_at.toISOString(),
    invitationUrl:new URL(`/invitations/${i.id}`,ctx.config.APP_ORIGIN).href};
}
export async function invite(ctx:Context) {
  const project=await lockProject(ctx);
  if(project.owner_id!==ctx.actor.id) throw forbidden();
  if(project.lifecycle==='archived') throw conflict('PROJECT_ARCHIVED','Restore this project before inviting members.');
  const email=(ctx.body.email as string).toLowerCase();
  const member=await sql`select 1 from app.project_memberships m join app.profiles p on p.id=m.user_id
    where m.project_id=${project.id}::uuid and p.email=${email}`.execute(ctx.tx);
  if(member.rows.length) throw conflict('ALREADY_MEMBER','This person is already a project member.');
  await sql`update app.project_invitations set state='expired' where project_id=${project.id}::uuid and recipient_email=${email}
    and state='pending' and expires_at<=now()`.execute(ctx.tx);
  const {rows}=await sql<Invitation>`insert into app.project_invitations(project_id,recipient_email,role,invited_by)
    values(${project.id}::uuid,${email},${ctx.body.role as string},${ctx.actor.id}::uuid) returning *`.execute(ctx.tx);
  await record(ctx,'invitation.created',rows[0]!.id); return present(ctx,rows[0]!);
}
export async function getInvitation(ctx:Context) {
  const {rows}=await sql<Invitation>`select * from app.project_invitations where id=${ctx.params.id}::uuid`.execute(ctx.tx);
  if(!rows[0]) throw missing(); return present(ctx,rows[0]);
}
export async function listInvitations(ctx:Context) {
  const {limit,after}=pagination(ctx.query);
  const clause=after?sql`and (created_at,id)<(${after.createdAt}::timestamptz,${after.id}::uuid)`:sql``;
  const {rows}=await sql<Invitation>`select * from app.project_invitations where recipient_email=${ctx.actor.email} ${clause}
    order by created_at desc,id desc limit ${limit+1}`.execute(ctx.tx);
  return page(rows.map(i=>present(ctx,i)),limit);
}
export async function acceptInvitation(ctx:Context) {
  const inv=await getInvitation(ctx);
  if(inv.recipientEmail!==ctx.actor.email) throw forbidden();
  if(inv.state==='expired') throw conflict('INVITATION_EXPIRED','Ask the project owner for a new invitation.');
  const {rows}=await sql<{projectId:string|null}>`select app.accept_invitation(${ctx.params.id}::uuid) as "projectId"`.execute(ctx.tx);
  if(!rows[0]?.projectId) throw conflict('INVITATION_INACTIVE','This invitation can no longer be accepted.');
  // An old accepted invitation is not a rejoin token after member removal.
  const member=await sql`select 1 from app.project_memberships where project_id=${rows[0].projectId}::uuid and user_id=${ctx.actor.id}::uuid`.execute(ctx.tx);
  if(!member.rows.length) throw conflict('MEMBERSHIP_REMOVED','Ask the project owner for a new invitation.');
  return {projectId:rows[0].projectId,state:'accepted'};
}
export async function decideInvitation(ctx:Context,decision:'declined'|'revoked') {
  const {rows}=await sql<Invitation>`select * from app.project_invitations where id=${ctx.params.id}::uuid for update`.execute(ctx.tx);
  const inv=rows[0]; if(!inv) throw missing();
  if(decision==='declined'&&inv.recipient_email!==ctx.actor.email) throw forbidden();
  if(decision==='revoked') {
    const owner=await sql<{ok:boolean}>`select app.is_project_owner(${inv.project_id}::uuid) as ok`.execute(ctx.tx);
    if(!owner.rows[0]?.ok) throw forbidden();
  }
  if(inv.state===decision) return present(ctx,inv);
  if(inv.state!=='pending'||inv.expires_at.getTime()<=Date.now()) throw conflict('INVITATION_INACTIVE','This invitation is no longer pending.');
  const updated=await sql<Invitation>`update app.project_invitations set state=${decision} where id=${inv.id}::uuid returning *`.execute(ctx.tx);
  await record(ctx,`invitation.${decision}`,inv.id); return present(ctx,updated.rows[0]!);
}
