import { readFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import fixtures from '../packages/fixtures/identities.json' with { type:'json' };
export { fixtures };

export async function migrate(url:string,ssl=false) {
  const client=new pg.Client({connectionString:url,ssl:ssl?{rejectUnauthorized:true}:false});await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(873511209)");
    await client.query('CREATE SCHEMA IF NOT EXISTS supabase_migrations');
    await client.query('CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text)');
    await client.query('CREATE TABLE IF NOT EXISTS supabase_migrations.buildz_checksums(version text PRIMARY KEY,sha256 text NOT NULL)');
    for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
      const version=file.split('_')[0]!;const source=await readFile(resolve('supabase/migrations',file),'utf8');
      const hash=createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
      const applied=await client.query('select version from supabase_migrations.schema_migrations where version=$1',[version]);
      const checksum=await client.query<{sha256:string}>('select sha256 from supabase_migrations.buildz_checksums where version=$1',[version]);
      if(applied.rowCount){if(checksum.rows[0]&&checksum.rows[0].sha256!==hash)throw new Error(`Applied migration changed: ${file}`);continue;}
      await client.query(source);
      await client.query('insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2,$3)',[version,[source],file]);
      await client.query('insert into supabase_migrations.buildz_checksums(version,sha256) values($1,$2)',[version,hash]);
    }
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
}
export async function seed(url:string) {
  const client=new pg.Client({connectionString:url});await client.connect();
  try {
    await client.query('BEGIN');
    for(const school of fixtures.institutions)await client.query(`insert into app.institutions(id,name,slug,timezone,currency,is_demo)
      values($1,$2,$3,$4,$5,true) on conflict(id) do nothing`,[school.id,school.name,school.slug,school.timezone,school.currency]);
    for(const u of fixtures.users){
      await client.query('insert into app.profiles(id,email,display_name) values($1,$2,$3) on conflict(id) do nothing',[u.id,u.email,u.displayName]);
      if(u.school===null)continue;
      const school=fixtures.institutions[u.school]!.id;
      await client.query(`insert into app.institution_memberships(institution_id,user_id,affiliation,status)
        values($1,$2,$3,'verified') on conflict(institution_id,user_id,affiliation) do nothing`,[school,u.id,u.role==='student'?'student':'staff']);
      if(u.role==='institution_admin')await client.query(`insert into app.role_assignments(institution_id,user_id,role)
        values($1,$2,'institution_admin') on conflict(institution_id,user_id,role) where revoked_at is null do nothing`,[school,u.id]);
    }
    await client.query('COMMIT');
  } catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
}
export async function freePort():Promise<number> {
  const server=createServer();await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Could not assign local port');
  await new Promise<void>(ok=>server.close(()=>ok()));return address.port;
}
export async function localDatabase(persistent=false) {
  await mkdir('work',{recursive:true});
  const directory=persistent?resolve('work/local-postgres'):await mkdtemp(resolve('work/test-postgres-'));
  if(existsSync(resolve(directory,'postmaster.pid'))){
    const pid=Number((await readFile(resolve(directory,'postmaster.pid'),'utf8')).split(/\r?\n/)[0]);
    if(Number.isInteger(pid)&&pid>0){
      let active=true;
      try{process.kill(pid,0);}catch(error){active=(error as NodeJS.ErrnoException).code!=='ESRCH';}
      if(active)throw new Error('The local PostgreSQL directory is already in use. Use the running backend or stop its owning dev process before restarting.');
    }
  }
  const port=await freePort();
  // Persistent local-only superuser credential. Never used in a hosted environment.
  const adminPassword='buildz-local-development-only';
  const instance=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:adminPassword,port,persistent:true,
    authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  if(!existsSync(resolve(directory,'PG_VERSION')))await instance.initialise();
  try{await instance.start();}catch(error){throw new Error('Local PostgreSQL failed to start. Check for an existing instance or unavailable native binaries.',{cause:error});}
  const adminUrl=`postgresql://postgres:${adminPassword}@127.0.0.1:${port}/postgres`;
  try {
    await migrate(adminUrl);
    const apiPassword=randomBytes(24).toString('hex');const workerPassword=randomBytes(24).toString('hex');
    const client=new pg.Client({connectionString:adminUrl});await client.connect();
    try {
      await client.query(`ALTER ROLE buildz_api LOGIN PASSWORD ${pg.escapeLiteral(apiPassword)}`);
      await client.query(`ALTER ROLE buildz_worker LOGIN PASSWORD ${pg.escapeLiteral(workerPassword)}`);
    }finally{await client.end();}
    return {adminUrl,apiUrl:`postgresql://buildz_api:${apiPassword}@127.0.0.1:${port}/postgres`,
      workerUrl:`postgresql://buildz_worker:${workerPassword}@127.0.0.1:${port}/postgres`,stop:()=>instance.stop()};
  }catch(e){await instance.stop();throw e;}
}
