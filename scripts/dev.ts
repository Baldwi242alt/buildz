import type pg from 'pg';
import { runningBackend } from './dev-status.js';

async function main(){
  if(process.env.NODE_ENV==='production')throw new Error('Local demo mode cannot run in production.');
  const port=Number(process.env.PORT??3001);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
  const existing=await runningBackend(port);
  if(existing){
    console.log(`BuildZ backend is already running at ${existing.url}`);
    console.log(`Health: ${existing.url}/v1/health/ready`);
    console.log(`Local-only token endpoint: POST ${existing.issuer}/token with {"userIndex":0}`);
    console.log('Using the existing service. No database changes or restart were performed.');
    return;
  }
  // Do not load native database lifecycle hooks when reusing an existing service.
  const [{localDatabase,seed,fixtures},{localAuth},{createApp},{loadConfig},{default:Pg}]=await Promise.all([
    import('./db-tools.js'),import('./local-auth.js'),import('../apps/api/src/app.js'),import('../apps/api/src/config.js'),import('pg'),
  ]);
  let db:Awaited<ReturnType<typeof localDatabase>>|undefined;
  let auth:Awaited<ReturnType<typeof localAuth>>|undefined;
  let runtime:Awaited<ReturnType<typeof createApp>>|undefined;
  let worker:pg.Pool|undefined;
  let tick:ReturnType<typeof setInterval>|undefined;
  let closing=false;
  async function close(){
    if(closing)return;closing=true;if(tick)clearInterval(tick);
    await Promise.allSettled([runtime?.close(),auth?.stop(),worker?.end()]);
    await db?.stop();
  }
  try{
    db=await localDatabase(true);
    await seed(db.adminUrl);
    const {seedDemoWorkflows}=await import('./seed-demo-workflows.js');
    await seedDemoWorkflows(db.adminUrl);
    auth=await localAuth();
    const config=loadConfig({NODE_ENV:'development',PORT:String(port),DATABASE_URL:db.apiUrl,DATABASE_SSL:'false',
      AUTH_ISSUER:auth.issuer,AUTH_JWKS_URL:auth.issuer+'/.well-known/jwks.json',AUTH_USERINFO_URL:auth.issuer+'/user',
      AUTH_AUDIENCE:'authenticated',AUTH_PUBLISHABLE_KEY:'local-only',CORS_ORIGINS:'http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173',APP_ORIGIN:process.env.APP_ORIGIN??'http://localhost:5173'});
    runtime=await createApp(config);
    worker=new Pg.Pool({connectionString:db.workerUrl,max:1});
    tick=setInterval(()=>{void worker!.query('select app.expire_invitations(),app.expire_bookings()').catch(()=>console.error('Reservation expiry tick failed.'));},1000);
    await runtime.app.listen(port,'127.0.0.1');
    console.log(`BuildZ local API: http://127.0.0.1:${port}/v1/meta`);
    console.log(`Local-only token endpoint: POST ${auth.issuer}/token with {"userIndex":0}`);
    console.log(fixtures.users.map((u,i)=>`${i}: ${u.email} (${u.role})`).join('\n'));
    console.log('Fictional identities only. Data persists in work/local-postgres. This is not a public deployment.');
    for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void close().then(()=>process.exit(0)));
  }catch(error){await close();throw error;}
}
await main().catch(error=>{console.error(error instanceof Error?error.message:'Backend startup failed.');process.exitCode=1;});
