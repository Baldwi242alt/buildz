import { sql, type RawBuilder } from 'kysely';
import { type Context, pagination, page, record } from './context.js';
import { ApiError, forbidden, missing } from './errors.js';

export function camel(value: unknown): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(camel);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        camel(v),
      ]),
    );
  return value;
}
export async function one(ctx: Context, query: RawBuilder<any>): Promise<any> {
  const { rows } = await query.execute(ctx.tx);
  if (!rows[0]) throw missing();
  return camel(rows[0]);
}
export async function many(
  ctx: Context,
  query: RawBuilder<any>,
): Promise<any[]> {
  return (await query.execute(ctx.tx)).rows.map(camel);
}
export function listClause(ctx: Context, alias = '') {
  const { limit, after } = pagination(ctx.query);
  const c = sql.ref(alias ? alias + '.created_at' : 'created_at');
  const id = sql.ref(alias ? alias + '.id' : 'id');
  return {
    limit,
    clause: after
      ? sql`and (${c},${id})<(${after.createdAt}::timestamptz,${after.id}::uuid)`
      : sql``,
  };
}
export async function listed(ctx: Context, query: RawBuilder<any>) {
  return page(await many(ctx, query), pagination(ctx.query).limit);
}
export async function permitted(ctx: Context, predicate: RawBuilder<boolean>) {
  const { rows } = await sql<{
    ok: boolean;
  }>`select ${predicate} as ok`.execute(ctx.tx);
  if (!rows[0]?.ok) throw forbidden();
}
export function interval(start: unknown, end: unknown, maxHours = 24 * 31) {
  const from = new Date(String(start)),
    to = new Date(String(end));
  if (
    !Number.isFinite(+from) ||
    !Number.isFinite(+to) ||
    +to <= +from ||
    +to - +from > maxHours * 3600000
  )
    throw new ApiError(
      422,
      'INVALID_INTERVAL',
      `Choose a positive interval no longer than ${maxHours} hours.`,
    );
  return { from, to };
}
export async function activity(
  ctx: Context,
  project: string,
  kind: string,
  subject = project,
) {
  await record(ctx, kind, subject);
  await sql`select app.notify_project(${project}::uuid,${kind},${subject}::uuid)`.execute(
    ctx.tx,
  );
}
export async function editableProject(ctx: Context, id: string, edit = false) {
  const p = await one(
    ctx,
    sql`select id,owner_id,lifecycle,lead_institution_id,version from app.projects where id=${id}::uuid`,
  );
  if (p.lifecycle === 'archived')
    throw new ApiError(
      409,
      'PROJECT_ARCHIVED',
      'Restore the project before making changes.',
    );
  await permitted(
    ctx,
    edit
      ? sql<boolean>`app.can_edit_project(${id}::uuid)`
      : sql<boolean>`app.is_project_member(${id}::uuid)`,
  );
  return p;
}
