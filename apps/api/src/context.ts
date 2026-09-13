import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Actor, Tx } from '../../../packages/db/src/database.js';
import type { Config } from './config.js';
import { ApiError, conflict } from './errors.js';
export type Context = {
  actor: Actor; tx: Tx; params: Record<string,string>; query: Record<string,unknown>;
  body: Record<string,unknown>; config: Config;
};
export type Handler = (ctx:Context)=>Promise<unknown>;

export async function record(ctx:Context,action:string,subject:string,event=action) {
  await sql`insert into app.audit_events(actor_id,action,subject_id) values(${ctx.actor.id},${action},${subject}::uuid)`.execute(ctx.tx);
  await sql`insert into app.outbox_events(actor_id,type,aggregate_id) values(${ctx.actor.id},${event},${subject}::uuid)`.execute(ctx.tx);
}
export function pagination(query:Record<string,unknown>): { limit:number; after:{createdAt:string;id:string}|null } {
  const limit=Number(query.limit ?? 20);
  if (!query.cursor) return {limit,after:null};
  try {
    const value=JSON.parse(Buffer.from(String(query.cursor),'base64url').toString('utf8')) as {createdAt:unknown;id:unknown};
    if (typeof value.createdAt!=='string'||Number.isNaN(Date.parse(value.createdAt))||typeof value.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) throw new Error();
    return {limit,after:{createdAt:value.createdAt,id:value.id}};
  } catch { throw new ApiError(400,'INVALID_CURSOR','The pagination cursor is invalid.'); }
}
export function page<T extends {id:string;createdAt:string}>(rows:T[],limit:number) {
  const items=rows.slice(0,limit); const last=items.at(-1);
  return {items,nextCursor:rows.length>limit&&last?Buffer.from(JSON.stringify({createdAt:last.createdAt,id:last.id})).toString('base64url'):null};
}
export async function idempotent(ctx:Context,operation:string,key:string,handler:Handler):Promise<unknown> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new ApiError(400,'IDEMPOTENCY_KEY_REQUIRED','Supply an Idempotency-Key of 8–128 letters, digits, underscores or hyphens.');
  const hash=createHash('sha256').update(JSON.stringify({params:ctx.params,body:ctx.body})).digest('hex');
  await sql`select pg_advisory_xact_lock(hashtextextended(${ctx.actor.id+':'+operation+':'+key},0))`.execute(ctx.tx);
  const {rows}=await sql<{request_hash:string;response:unknown}>`select request_hash,response from app.idempotency_records
    where actor_id=${ctx.actor.id}::uuid and operation=${operation} and key=${key}`.execute(ctx.tx);
  if (rows[0]) {
    if(rows[0].request_hash!==hash) throw conflict('IDEMPOTENCY_KEY_REUSED','This key was already used with different input.');
    return rows[0].response;
  }
  const response=await handler(ctx);
  await sql`insert into app.idempotency_records(actor_id,operation,key,request_hash,response)
    values(${ctx.actor.id}::uuid,${operation},${key},${hash},${JSON.stringify(response)}::jsonb)`.execute(ctx.tx);
  return response;
}
