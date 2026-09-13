import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
export type Db = Kysely<Record<string, never>>;
export type Tx = Transaction<Record<string, never>>;
export type Actor = { id: string; email: string; displayName: string };

export function database(url: string, ssl = false): Db {
  return new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({
    connectionString: url, max: 10, ssl: ssl ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
  }) }) });
}

export async function asActor<T>(db: Db, actor: Actor, action: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async tx => {
    await sql`select set_config('app.actor_id', ${actor.id}, true), set_config('app.actor_email', ${actor.email}, true)`.execute(tx);
    await sql`set local statement_timeout = '10s'`.execute(tx);
    return action(tx);
  });
}

export async function assertRuntimeRole(db: Db): Promise<void> {
  const { rows } = await sql<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; owns: boolean }>`
    select r.rolname,r.rolsuper,r.rolbypassrls,exists(
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relowner=r.oid
    ) as owns from pg_roles r where r.rolname=current_user`.execute(db);
  const role = rows[0];
  if (!role || role.rolname !== 'buildz_api' || role.rolsuper || role.rolbypassrls || role.owns) {
    throw new Error('API requires the non-owner buildz_api database role; refusing privileged runtime credentials.');
  }
}
