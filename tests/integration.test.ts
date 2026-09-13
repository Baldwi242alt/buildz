import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { createApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { localAuth } from '../scripts/local-auth.js';
import { localDatabase,seed,fixtures,migrate } from '../scripts/db-tools.js';
import { asActor } from '../packages/db/src/database.js';
import { createBuildZClient } from '../packages/sdk/src/index.js';
import { routes } from '../apps/api/src/contract.js';
let db:Awaited<ReturnType<typeof localDatabase>>;
let auth:Awaited<ReturnType<typeof localAuth>>;
let runtime:Awaited<ReturnType<typeof createApp>>;
let admin:pg.Pool;
let base:string;
let tokens:string[];
type Payload={data:any;meta?:{nextCursor?:string|null};error?:{code:string}};
async function request(user:number|null,method:string,path:string,body?:unknown,key=randomUUID()){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':key,...(user===null?{}:{Authorization:`Bearer ${tokens[user]}`})},body:body===undefined?undefined:JSON.stringify(body)});
  const payload=await response.json() as Payload;
  return {status:response.status,...payload};
}
async function project(owner=0){const r=await request(owner,'POST','/v1/projects',{
  title:'Campus maker project',summary:'A real persisted test project.',projectType:'engineering',leadInstitutionId:fixtures.institutions[owner===1?1:0]!.id});
  expect(r.status,JSON.stringify(r)).toBe(201);return r.data as {id:string;version:number};}

beforeAll(async()=>{
  db=await localDatabase();await seed(db.adminUrl);auth=await localAuth();
  tokens=await Promise.all(fixtures.users.map((_,i)=>auth.token(i)));
  admin=new pg.Pool({connectionString:db.adminUrl});
  runtime=await createApp(loadConfig({NODE_ENV:'test',PORT:'0',DATABASE_URL:db.apiUrl,DATABASE_SSL:'false',AUTH_ISSUER:auth.issuer,
    AUTH_JWKS_URL:auth.issuer+'/.well-known/jwks.json',AUTH_USERINFO_URL:auth.issuer+'/user',AUTH_PUBLISHABLE_KEY:'local-only',
    CORS_ORIGINS:'http://localhost:5173',APP_ORIGIN:'http://localhost:5173'}));
  await runtime.app.listen(0,'127.0.0.1');base=await runtime.app.getUrl();
});
afterAll(async()=>{await runtime?.close();await auth?.stop();await admin?.end();await db?.stop();});

describe('M0: real PostgreSQL, authentication and contract',()=>{
  it('has liveness/readiness and truthful phase feature flags',async()=>{
    expect((await request(null,'GET','/v1/health/ready')).data.status).toBe('ok');
    const r=await request(null,'GET','/v1/meta');expect(r.data.milestones).toEqual(['M0','M1','M2','M3','M4','M5','M6']);expect(r.data.features.publicProjects).toBe(true);expect(r.data.features.liveEvents).toBe(false);
  });
  it('accepts separate verified identities through the generated client',async()=>{
    for(const i of [0,1]){
      const client=createBuildZClient({baseUrl:base,getAccessToken:()=>tokens[i]!});
      const result=await client.GET('/v1/me');expect(result.response.status).toBe(200);expect(result.data?.data.id).toBe(fixtures.users[i]!.id);
    }
  });
  it('rejects absent, forged, expired and wrong-audience access tokens',async()=>{
    expect((await request(null,'GET','/v1/me')).status).toBe(401);
    for(const token of ['not-a-jwt',await auth.token(0,{aud:'wrong'}),await auth.token(0,{exp:1}),await auth.token(0,{iss:'https://wrong.example'}),await auth.token(0,{role:'service_role'})]){
      expect((await fetch(base+'/v1/me',{headers:{Authorization:`Bearer ${token}`}})).status).toBe(401);
    }
    const parts=tokens[0]!.split('.');const payload=JSON.parse(Buffer.from(parts[1]!,'base64url').toString());payload.sub=fixtures.users[3]!.id;
    parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect((await fetch(base+'/v1/me',{headers:{Authorization:`Bearer ${parts.join('.')}`}})).status).toBe(401);
  });
  it('rejects unknown writable fields and malformed IDs/cursors/timezones',async()=>{
    expect((await request(0,'PATCH','/v1/me',{displayName:'Student',isAdmin:true})).status).toBe(422);
    expect((await request(0,'PATCH','/v1/me',{timezone:'Mars/City'})).status).toBe(422);
    expect((await request(0,'GET','/v1/projects/not-a-uuid')).status).toBe(422);
    expect((await request(0,'GET','/v1/projects?cursor=invalid')).status).toBe(400);
    expect((await request(0,'GET','/v1/projects?limit=1000')).status).toBe(422);
    const malformed=await fetch(base+'/v1/me',{method:'PATCH',headers:{Authorization:`Bearer ${tokens[0]}`,'Content-Type':'application/json'},body:'{"broken":'});
    expect(malformed.status).toBe(400);
  });
  it('requires confirmed email and ignores staff roles in user-controlled metadata',async()=>{
    auth.setConfirmed(1,false);
    try{expect((await request(1,'GET','/v1/me')).error?.code).toBe('EMAIL_UNVERIFIED');}finally{auth.setConfirmed(1,true);}
    const spoof=await auth.token(5,{user_metadata:{role:'institution_admin',isAdmin:true}});
    const response=await fetch(base+'/v1/me',{headers:{Authorization:`Bearer ${spoof}`}});
    expect((await response.json() as Payload).data.roles).toEqual([]);
  });
  it('does not trust profile metadata or permit an unverified student to create school projects',async()=>{
    const r=await request(5,'POST','/v1/projects',{title:'Forbidden',summary:'No verified affiliation.',projectType:'community',leadInstitutionId:fixtures.institutions[0]!.id});
    expect(r.status).toBe(403);
    expect((await request(5,'GET','/v1/me')).data.roles).toEqual([]);
  });
  it('denies database reads without context and does not leak a pooled user context',async()=>{
    const result=await sql<{n:string}>`select count(*) as n from app.profiles`.execute(runtime.db);expect(Number(result.rows[0]?.n)).toBe(0);
    await asActor(runtime.db,{id:fixtures.users[0]!.id,email:fixtures.users[0]!.email,displayName:'Alice'},async tx=>{
      const r=await sql<{id:string}>`select id from app.profiles`.execute(tx);expect(r.rows.map(p=>p.id)).toContain(fixtures.users[0]!.id);
    });
    const leaked=await sql<{actor:string|null}>`select nullif(current_setting('app.actor_id',true),'') as actor`.execute(runtime.db);expect(leaked.rows[0]?.actor).toBeNull();
  });
  it('reruns migrations without duplicating data',async()=>{await migrate(db.adminUrl);const r=await admin.query('select count(*) from app.institutions');expect(Number(r.rows[0].count)).toBe(2);});
  it('returns a matching contract for every implemented route',()=>{expect(routes.length).toBe(79);expect(new Set(routes.map(r=>r.operation.operationId)).size).toBe(79);});
});

describe('M1: schools, project teams and consent',()=>{
  it('creates exactly one project under concurrent idempotent retries and refuses key reuse',async()=>{
    const body={title:'Idempotent build',summary:'Shared request',projectType:'creative',leadInstitutionId:fixtures.institutions[0]!.id};const key=randomUUID();
    const results=await Promise.all(Array.from({length:6},()=>request(0,'POST','/v1/projects',body,key)));
    expect(results.every(r=>r.status===201),JSON.stringify(results)).toBe(true);expect(new Set(results.map(r=>r.data.id)).size).toBe(1);
    const changed=await request(0,'POST','/v1/projects',{...body,title:'Different'},key);expect(changed.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
  it('creates projects through the generated mutation interface',async()=>{
    const client=createBuildZClient({baseUrl:base,getAccessToken:()=>tokens[0]!});
    const result=await client.POST('/v1/projects',{params:{header:{'Idempotency-Key':randomUUID()}},body:{title:'SDK integration',summary:'A typed request.',projectType:'creative',leadInstitutionId:fixtures.institutions[0]!.id}});
    expect(result.response.status).toBe(201);expect(result.data?.data.title).toBe('SDK integration');
    const changed=await client.PATCH('/v1/projects/{id}',{params:{path:{id:result.data!.data.id}},body:{version:result.data!.data.version,title:'SDK update'}});
    expect(changed.response.status).toBe(200);expect(changed.data?.data.title).toBe('SDK update');
  });
  it('keeps private projects hidden from same-school and cross-school outsiders',async()=>{
    const p=await project();for(const user of [1,2,3])expect((await request(user,'GET',`/v1/projects/${p.id}`)).status).toBe(404);
    const list=await request(2,'GET','/v1/projects');expect(list.data.some((x:{id:string})=>x.id===p.id)).toBe(false);
  });
  it('accepts a cross-school invitation only for the intended verified email and only once',async()=>{
    const p=await project();const invitation=await request(0,'POST',`/v1/projects/${p.id}/invitations`,{email:fixtures.users[1]!.email,role:'editor'});
    expect(invitation.status).toBe(201);expect(invitation.data.invitationUrl).toContain('/invitations/');
    expect((await request(1,'GET',`/v1/projects/${p.id}`)).status).toBe(404);
    expect((await request(2,'POST',`/v1/invitations/${invitation.data.id}/accept`)).status).toBe(404);
    const accepted=await Promise.all([request(1,'POST',`/v1/invitations/${invitation.data.id}/accept`),request(1,'POST',`/v1/invitations/${invitation.data.id}/accept`)]);
    expect(accepted.map(r=>r.status)).toEqual([200,200]);
    const shared=await request(1,'GET',`/v1/projects/${p.id}`);expect(shared.status).toBe(200);expect(shared.data.capabilities.canEdit).toBe(true);expect(shared.data.capabilities.canInvite).toBe(false);
    const members=await request(1,'GET',`/v1/projects/${p.id}/members`);expect(members.data).toHaveLength(2);expect(members.data[0]).not.toHaveProperty('email');
  });
  it('handles stale revisions, owner transfer, archive and last-owner protection',async()=>{
    const p=await project();const i=await request(0,'POST',`/v1/projects/${p.id}/invitations`,{email:fixtures.users[1]!.email,role:'member'});
    await request(1,'POST',`/v1/invitations/${i.data.id}/accept`);
    expect((await request(0,'PATCH',`/v1/projects/${p.id}`,{version:1,title:'Stale'})).status).toBe(409);
    expect((await request(1,'PATCH',`/v1/projects/${p.id}`,{version:2,title:'Not editor'})).status).toBeGreaterThanOrEqual(400);
    expect((await request(0,'DELETE',`/v1/projects/${p.id}/members/${fixtures.users[0]!.id}`,{version:2})).error?.code).toBe('OWNER_REQUIRED');
    const transfer=await request(0,'POST',`/v1/projects/${p.id}/ownership-transfer`,{version:2,newOwnerId:fixtures.users[1]!.id});expect(transfer.status,JSON.stringify(transfer)).toBe(200);
    expect((await request(0,'POST',`/v1/projects/${p.id}/invitations`,{email:fixtures.users[2]!.email,role:'member'})).status).toBe(403);
    const archive=await request(1,'POST',`/v1/projects/${p.id}/lifecycle`,{version:3,lifecycle:'archived'});expect(archive.status).toBe(200);
    expect((await request(1,'PATCH',`/v1/projects/${p.id}`,{version:4,title:'Cannot edit archived'})).error?.code).toBe('PROJECT_ARCHIVED');
  });
  it('revokes access after removal and prevents old accepted links from restoring membership',async()=>{
    const p=await project();const i=await request(0,'POST',`/v1/projects/${p.id}/invitations`,{email:fixtures.users[1]!.email,role:'member'});
    await request(1,'POST',`/v1/invitations/${i.data.id}/accept`);
    expect((await request(0,'DELETE',`/v1/projects/${p.id}/members/${fixtures.users[1]!.id}`,{version:2})).status).toBe(200);
    expect((await request(1,'GET',`/v1/projects/${p.id}`)).status).toBe(404);
    expect((await request(1,'POST',`/v1/invitations/${i.data.id}/accept`)).status).toBe(409);
  });
  it('lets an ordinary member leave while retaining an accepted owner',async()=>{
    const p=await project();const i=await request(0,'POST',`/v1/projects/${p.id}/invitations`,{email:fixtures.users[1]!.email,role:'member'});
    await request(1,'POST',`/v1/invitations/${i.data.id}/accept`);
    const left=await request(1,'DELETE',`/v1/projects/${p.id}/members/${fixtures.users[1]!.id}`,{version:2});
    expect(left.status,JSON.stringify(left)).toBe(200);
    expect((await request(1,'GET',`/v1/projects/${p.id}`)).status).toBe(404);
    expect((await request(0,'GET',`/v1/projects/${p.id}/members`)).data).toHaveLength(1);
  });
  it('rejects expired/revoked/declined invitations and expires records through a restricted worker',async()=>{
    const p=await project();const i=await request(0,'POST',`/v1/projects/${p.id}/invitations`,{email:fixtures.users[1]!.email,role:'member'});
    await admin.query("update app.project_invitations set expires_at=now()-interval '1 second' where id=$1",[i.data.id]);
    expect((await request(1,'POST',`/v1/invitations/${i.data.id}/accept`)).error?.code).toBe('INVITATION_EXPIRED');
    const worker=new pg.Client({connectionString:db.workerUrl});await worker.connect();
    try{await expect(worker.query('select * from app.profiles')).rejects.toThrow();const r=await worker.query('select app.expire_invitations() as count');expect(r.rows[0].count).toBeGreaterThanOrEqual(1);}finally{await worker.end();}
    for(const decision of ['decline','revoke']){
      const next=await request(0,'POST',`/v1/projects/${p.id}/invitations`,{email:fixtures.users[1]!.email,role:'member'});
      expect((await request(decision==='decline'?1:0,'POST',`/v1/invitations/${next.data.id}/${decision}`)).status).toBe(200);
      expect((await request(1,'POST',`/v1/invitations/${next.data.id}/accept`)).status).toBe(409);
    }
  });
  it('allows a school admin to verify a student but denies other-school staff',async()=>{
    const req=await request(5,'POST',`/v1/institutions/${fixtures.institutions[0]!.id}/verification-requests`,{statement:'Staff have checked my student affiliation.'});expect(req.status).toBe(201);
    const body={version:1,decision:'approved',reason:'Verified with school roster.'};
    expect((await request(4,'POST',`/v1/verification-requests/${req.data.id}/decisions`,body)).status).toBe(404);
    expect((await request(3,'POST',`/v1/verification-requests/${req.data.id}/decisions`,body)).status).toBe(200);
    expect((await request(5,'GET','/v1/me')).data.capabilities.canCreateProject).toBe(true);
    expect((await request(3,'POST',`/v1/verification-requests/${req.data.id}/decisions`,body)).status).toBe(409);
  });
  it('paginates private project lists without duplicate records',async()=>{
    const first=await request(0,'GET','/v1/projects?limit=2');expect(first.data).toHaveLength(2);expect(first.meta?.nextCursor).toBeTruthy();
    const next=await request(0,'GET','/v1/projects?limit=2&cursor='+encodeURIComponent(first.meta!.nextCursor!));
    expect(next.status).toBe(200);expect(next.data.every((p:{id:string})=>!first.data.some((q:{id:string})=>q.id===p.id))).toBe(true);
  });
});
