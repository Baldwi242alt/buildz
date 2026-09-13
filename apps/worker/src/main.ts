import 'dotenv/config';
import pg from 'pg';
const url=process.env.WORKER_DATABASE_URL;
if(!url)throw new Error('WORKER_DATABASE_URL is required.');
if(process.env.NODE_ENV==='production'&&process.env.DATABASE_SSL!=='true')throw new Error('Worker requires database TLS in production.');
const pool=new pg.Pool({connectionString:url,max:1,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:false});
const role=await pool.query<{current_user:string}>('select current_user');
if(role.rows[0]?.current_user!=='buildz_worker')throw new Error('Worker requires the buildz_worker database role.');
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{stopping=true;});
while(!stopping){
  try{const r=await pool.query<{expired:number}>('select app.expire_invitations()+app.expire_bookings() as expired');if(r.rows[0]?.expired)console.log(JSON.stringify({event:'reservations.expired',count:r.rows[0].expired}));}
  catch{console.error(JSON.stringify({event:'worker.tick_failed'}));}
  await new Promise(r=>setTimeout(r,1000));
}
await pool.end();
