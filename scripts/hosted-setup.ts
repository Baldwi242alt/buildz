import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { parse } from 'dotenv';
import pg from 'pg';

// Operator-only helper. Never import this into a deployed application or print its configuration.
const mode = process.argv[2] ?? 'check';
if (!['check', 'migrate', 'provision', 'cron', 'cron-status', 'demo-bootstrap', 'demo-check', 'demo-content', 'demo-tour-check'].includes(mode)) throw new Error('Use check, migrate, provision, cron, cron-status, demo-bootstrap, demo-check, demo-content or demo-tour-check.');
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
    if(mode==='demo-content') await (await import('./seed-hosted-demo.js')).seedHostedDemo(client);
    if (mode === 'demo-bootstrap' || mode === 'demo-check' || mode === 'demo-tour-check') {
      // Auth identity is created through the provider's supported admin flow,
      // never by inserting into its managed auth schema. This shared account
      // must not acquire access to a real campus or privileged application role.
      const email = 'demo@buildz.example';
      const identity = await client.query('select id,email_confirmed_at from auth.users where email=$1 and deleted_at is null', [email]);
      if (identity.rowCount !== 1 || !identity.rows[0].email_confirmed_at) throw new Error('Create and confirm the reserved demo identity in Supabase first.');
      const id = identity.rows[0].id as string;
      if (mode === 'demo-bootstrap') {
        await client.query('BEGIN');
        try {
          await client.query('select pg_advisory_xact_lock(873511210)');
          const existing = await client.query('select id,is_demo from app.institutions where slug=$1', ['buildz-demo-campus']);
          if (existing.rowCount && !existing.rows[0].is_demo) throw new Error('Demo slug is occupied by a non-demo institution.');
          const school = existing.rows[0]?.id ?? (await client.query(`insert into app.institutions(name,slug,timezone,currency,is_demo)
            values('BuildZ Demo Campus','buildz-demo-campus','Asia/Singapore','SGD',true) returning id`)).rows[0].id;
          const access = await client.query(`select 1 from app.role_assignments where user_id=$1 and revoked_at is null
            union all select 1 from app.institution_memberships where user_id=$1 and (institution_id<>$2 or affiliation<>'student')`, [id, school]);
          if (access.rowCount) throw new Error('Demo identity has unexpected access; review manually before continuing.');
          await client.query(`insert into app.profiles(id,email,display_name) values($1,$2,'BuildZ Demo Student') on conflict(id) do nothing`, [id,email]);
          await client.query(`insert into app.institution_memberships(institution_id,user_id,affiliation,status)
            values($1,$2,'student','verified') on conflict(institution_id,user_id,affiliation) do update set status='verified'`, [school,id]);
          await client.query("insert into app.audit_events(actor_id,action,subject_id) values(null,'operator.demo_student_bootstrap',$1)", [id]);
          await client.query('COMMIT');
          console.log('Reserved demo student bootstrapped in BuildZ Demo Campus; no administrator role granted.');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      } else {
        const demoPassword = process.env.BUILDZ_DEMO_PASSWORD;
        if (!demoPassword) throw new Error('Set BUILDZ_DEMO_PASSWORD for the one-time login check.');
        const login = await fetch(`${project.origin}/auth/v1/token?grant_type=password`, {
          method:'POST', headers:{apikey:config.AUTH_PUBLISHABLE_KEY ?? '', 'Content-Type':'application/json'},
          body:JSON.stringify({email,password:demoPassword}), signal:AbortSignal.timeout(15000)
        });
        if (!login.ok) throw new Error(`Demo sign-in failed (HTTP ${login.status}); response and credentials withheld.`);
        const session = await login.json() as {access_token:string;user:{id:string}};
        if (session.user.id !== id) throw new Error('Unexpected signed-in identity.');
        const response = await fetch('https://buildz-api.onrender.com/v1/me', {
          headers:{Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(75000)
        });
        if (!response.ok) throw new Error(`Live demo profile failed (HTTP ${response.status}).`);
        const {data:me} = await response.json() as {data:{roles:unknown[];memberships:{affiliation:string;status:string}[];capabilities:{canCreateProject:boolean}}};
        if (me.roles.length || me.memberships.length !== 1 || me.memberships[0]?.affiliation !== 'student' || !me.capabilities.canCreateProject) throw new Error('Unexpected demo permissions.');
        console.log('Live password sign-in and /v1/me verified: student-only, one demo membership, canCreateProject=true. Tokens withheld.');
        if(mode==='demo-tour-check')await (await import('./check-hosted-demo.js')).checkHostedDemo(session.access_token);
      }
    }
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
