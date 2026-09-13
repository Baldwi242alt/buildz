import { sql } from 'kysely';
import type { Context } from './context.js';
import { record } from './context.js';
export async function ensureProfile(ctx:Context) {
  const current=await sql<{email:string}>`select email from app.profiles where id=${ctx.actor.id}::uuid`.execute(ctx.tx);
  if(current.rows[0]?.email===ctx.actor.email)return;
  await sql`insert into app.profiles(id,email,display_name) values(${ctx.actor.id}::uuid,${ctx.actor.email},${ctx.actor.displayName})
    on conflict(id) do update set email=excluded.email,updated_at=now() where app.profiles.email<>excluded.email`.execute(ctx.tx);
}
export async function me(ctx:Context) {
  const { rows }=await sql<{id:string;displayName:string;email:string;timezone:string}>`select id,display_name as "displayName",email,timezone
    from app.profiles where id=${ctx.actor.id}::uuid`.execute(ctx.tx);
  const memberships=await sql<Record<string,unknown>>`select id,institution_id as "institutionId",affiliation,status,valid_until as "validUntil"
    from app.institution_memberships where user_id=${ctx.actor.id}::uuid order by institution_id,affiliation`.execute(ctx.tx);
  const roles=await sql`select institution_id as "institutionId",role from app.role_assignments where user_id=${ctx.actor.id}::uuid and revoked_at is null order by institution_id,role`.execute(ctx.tx);
  return {...rows[0],memberships:memberships.rows,roles:roles.rows,
    capabilities:{canCreateProject:memberships.rows.some((m:Record<string,unknown>)=>m.affiliation==='student'&&m.status==='verified'&&(!m.validUntil||new Date(String(m.validUntil)).getTime()>Date.now()))}};
}
export async function updateMe(ctx:Context) {
  const display=ctx.body.displayName as string|undefined;
  const timezone=ctx.body.timezone as string|undefined;
  await sql`update app.profiles set display_name=coalesce(${display??null},display_name),timezone=coalesce(${timezone??null},timezone),updated_at=now()
    where id=${ctx.actor.id}::uuid`.execute(ctx.tx);
  await record(ctx,'profile.updated',ctx.actor.id);
  return me(ctx);
}
