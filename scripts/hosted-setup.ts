import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { parse } from 'dotenv';
import pg from 'pg';

// Operator-only helper. Never import this into a deployed application or print its configuration.
const mode = process.argv[2] ?? 'check';
if (!['check', 'migrate', 'provision', 'cron', 'cron-status'].includes(mode)) throw new Error('Use check, migrate, provision, cron or cron-status.');
let password = '';
let connectionString = '';
try {
  const config = parse(await readFile('.env.hosting.local', 'utf8'));
  password = config.SUPABASE_DATABASE_PASSWORD ?? '';
  if (!password || password === 'PASTE_DATABASE_PASSWORD_HERE') {
    throw new Error('Save the database password in .env.hosting.local first.');
  }
  const project = new URL(config.SUPABASE_PROJECT_URL ?? '');
  const ref = project.hostname.split('.')[0];
  if (project.protocol !== 'https:' || project.hostname !== `${ref}.supabase.co` ||
      config.SUPABASE_DATABASE_USER !== `postgres.${ref}` ||
      !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(config.SUPABASE_DATABASE_HOST ?? '') ||
      config.SUPABASE_DATABASE_PORT !== '5432') {
    throw new Error('Expected a matching Supabase project and owner session-pooler connection.');
  }
  const url = new URL(`postgresql://${config.SUPABASE_DATABASE_HOST}:5432/postgres`);
  url.username = config.SUPABASE_DATABASE_USER;
  url.password = password;
  connectionString = url.toString();
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const result = await client.query("select current_user as role, current_database() as database, to_regnamespace('app') is not null as app_schema_exists");
    if (result.rows[0]?.role !== 'postgres') throw new Error('Expected the migration owner role.');
    console.log('Verified TLS database connection:', JSON.stringify(result.rows[0]));
    if (mode === 'cron') {
      await client.query(await readFile('infra/supabase-cron.sql', 'utf8'));
      console.log('Scheduled hosted expiry once per minute. Verify cron-status after its first run.');
    }
    if (mode === 'cron-status') {
      const status = await client.query(`select j.jobname,j.active,d.status,d.start_time,d.end_time,d.return_message
        from cron.job j left join lateral (select * from cron.job_run_details r where r.jobid=j.jobid order by r.start_time desc limit 1) d on true
        where j.jobname='buildz-reservation-expiry'`);
      console.log('Hosted expiry status:', JSON.stringify(status.rows));
    }
    if (mode === 'provision') {
      if (!result.rows[0].app_schema_exists) throw new Error('Apply migrations before provisioning.');
      const secretFile = '.env.hosting.runtime.local';
      // Persist generated secrets before changing roles so retries never silently rotate them.
      if (!existsSync(secretFile)) {
        await writeFile(secretFile, `# PRIVATE generated runtime credentials. Never commit or paste into chat.\nBUILDZ_API_PASSWORD=${randomBytes(32).toString('hex')}\nBUILDZ_WORKER_PASSWORD=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
      }
      const runtime = parse(await readFile(secretFile, 'utf8'));
      for (const key of ['BUILDZ_API_PASSWORD', 'BUILDZ_WORKER_PASSWORD']) {
        if (!/^[a-f0-9]{64}$/.test(runtime[key] ?? '')) throw new Error('Invalid generated runtime credential file.');
      }
      await client.query('BEGIN');
      try {
        await client.query(`ALTER ROLE buildz_api LOGIN PASSWORD ${pg.escapeLiteral(runtime.BUILDZ_API_PASSWORD!)}`);
        await client.query(`ALTER ROLE buildz_worker LOGIN PASSWORD ${pg.escapeLiteral(runtime.BUILDZ_WORKER_PASSWORD!)}`);
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
        throw new Error('Runtime role provisioning failed; credentials were not printed.');
      }
      const apiUrl = new URL(url);
      apiUrl.username = `buildz_api.${ref}`;
      apiUrl.password = runtime.BUILDZ_API_PASSWORD!;
      const workerUrl = new URL(url);
      workerUrl.username = `buildz_worker.${ref}`;
      workerUrl.password = runtime.BUILDZ_WORKER_PASSWORD!;
      await writeFile(secretFile, `# PRIVATE generated runtime credentials. Never commit or paste into chat.\nBUILDZ_API_PASSWORD=${runtime.BUILDZ_API_PASSWORD}\nBUILDZ_WORKER_PASSWORD=${runtime.BUILDZ_WORKER_PASSWORD}\nDATABASE_URL=${apiUrl}\nWORKER_DATABASE_URL=${workerUrl}\n`, { mode: 0o600 });
      for (const [role, roleUrl] of [['buildz_api', apiUrl], ['buildz_worker', workerUrl]] as const) {
        const probe = new pg.Client({ connectionString: roleUrl.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
        try {
          await probe.connect();
          const actual = await probe.query('select current_user as role, rolsuper, rolbypassrls from pg_roles where rolname=current_user');
          if (actual.rows[0]?.role !== role || actual.rows[0]?.rolsuper || actual.rows[0]?.rolbypassrls) throw new Error('Role isolation check failed.');
          console.log(`Verified restricted runtime login: ${role}`);
        } catch { throw new Error(`Restricted login verification failed for ${role}; credentials were not printed.`); }
        finally { await probe.end(); }
      }
    }
  } finally {
    await client.end();
  }
  if (mode === 'migrate') {
    const { migrate } = await import('./db-tools.js');
    await migrate(connectionString, true);
    console.log('BuildZ hosted migrations applied successfully.');
  }
} catch (error) {
  let message = error instanceof Error ? error.message : 'Unknown setup error';
  for (const secret of [connectionString, password, encodeURIComponent(password)]) {
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  console.error('Hosted setup failed:', message);
  process.exitCode = 1;
}
