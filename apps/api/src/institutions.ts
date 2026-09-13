import { sql } from 'kysely';
import type { Context } from './context.js';
import { record } from './context.js';
import { conflict, forbidden, missing } from './errors.js';
export async function listInstitutions(ctx:Context) {
  const {rows}=await sql`select id,name,slug,timezone,currency,is_demo as "isDemo" from app.institutions order by name,id`.execute(ctx.tx);
  return rows;
}
export async function getInstitution(ctx:Context) {
  const {rows}=await sql`select id,name,slug,timezone,currency,is_demo as "isDemo" from app.institutions where id=${ctx.params.id}::uuid`.execute(ctx.tx);
  if(!rows[0]) throw missing(); return rows[0];
}
export async function requestVerification(ctx:Context) {
  await getInstitution(ctx);
  const existing=await sql`select id from app.institution_memberships where user_id=${ctx.actor.id}::uuid and institution_id=${ctx.params.id}::uuid
    and affiliation='student' and status='verified' and (valid_until is null or valid_until>now())`.execute(ctx.tx);
  if(existing.rows.length) throw conflict('ALREADY_VERIFIED','You already have an active student affiliation.');
  const {rows}=await sql<{id:string}>`insert into app.verification_requests(institution_id,user_id,statement)
    values(${ctx.params.id}::uuid,${ctx.actor.id}::uuid,${ctx.body.statement as string}) returning id,state,version`.execute(ctx.tx);
  await record(ctx,'verification.requested',rows[0]!.id); return rows[0];
}
export async function listVerifications(ctx:Context) {
  const {rows}=await sql`select id,institution_id as "institutionId",user_id as "userId",statement,state,reason,version,created_at as "createdAt"
    from app.verification_requests where institution_id=${ctx.params.id}::uuid order by created_at,id limit 100`.execute(ctx.tx);
  return rows;
}
export async function decideVerification(ctx:Context) {
  const {rows}=await sql<{id:string;institution_id:string;user_id:string;state:string;version:number}>`
    select * from app.verification_requests where id=${ctx.params.id}::uuid for update`.execute(ctx.tx);
  const request=rows[0]; if(!request) throw missing();
  const admin=await sql<{ok:boolean}>`select app.is_admin(${request.institution_id}::uuid) as ok`.execute(ctx.tx);
  if(!admin.rows[0]?.ok||request.user_id===ctx.actor.id) throw forbidden();
  if(request.state!=='pending'||request.version!==ctx.body.version) throw conflict();
  const state=ctx.body.decision as 'approved'|'rejected';
  if(state==='approved') await sql`insert into app.institution_memberships(institution_id,user_id,affiliation,status,verified_by)
    values(${request.institution_id}::uuid,${request.user_id}::uuid,'student','verified',${ctx.actor.id}::uuid)
    on conflict(institution_id,user_id,affiliation) do update set status='verified',verified_by=excluded.verified_by,valid_until=null`.execute(ctx.tx);
  const updated=await sql`update app.verification_requests set state=${state},reason=${ctx.body.reason as string},
    decided_by=${ctx.actor.id}::uuid,version=version+1 where id=${request.id}::uuid returning id,state,version`.execute(ctx.tx);
  await record(ctx,'verification.decided',request.id); return updated.rows[0];
}
