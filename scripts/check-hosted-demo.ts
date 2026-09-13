import {routes} from '../apps/api/src/contract.js';

/** Read-only authenticated tour: no bookings, emails or public edits. */
export async function checkHostedDemo(token:string) {
 const origin='https://buildz-api.onrender.com';
 const id=(n:number)=>`bd130000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 async function read(path:string,authenticated=true){
  const result=await fetch(origin+path,{headers:authenticated?{Authorization:`Bearer ${token}`}:{},signal:AbortSignal.timeout(75000)});
  if(!result.ok)throw new Error(`Demo tour ${path.split('?')[0]} returned HTTP ${result.status}.`);
  const json=await result.json();
  const contract=routes.find(r=>r.method==='GET'&&r.regex.test(path.split('?')[0]!));
  if(!contract?.response(json))throw new Error('Hosted demo response did not match its contract.');
  return (json as {data:any}).data;
 }
 const meta=await read('/v1/meta',false);if(meta.apiVersion!=='0.3.0')throw new Error('Wait for API 0.3.0 deployment.');
 const projects=await read('/v1/projects?limit=100');
 if(![10,11,12,13].every(n=>projects.some((p:any)=>p.id===id(n))))throw new Error('A seeded demo project is missing.');
 const publicProjects=await read('/v1/public/projects?limit=100',false);
 if(![10,11,12].every(n=>publicProjects.some((p:any)=>p.id===id(n)))||publicProjects.some((p:any)=>p.id===id(13)))throw new Error('Unexpected demo publication state.');
 const privateRead=await fetch(origin+'/v1/public/projects/'+id(13),{signal:AbortSignal.timeout(15000)});
 if(privateRead.status!==404)throw new Error('Private demo leaked through public detail.');
 console.log('PASS hosted demo: 3 discoverable public projects; fourth remains private.');
 const start=new Date(),end=new Date(+start+7*86400000);
 const query=new URLSearchParams({startsAt:start.toISOString(),endsAt:end.toISOString()});
 const team=await read(`/v1/projects/${id(10)}/team-calendar?${query}`);
 if(team.members.length!==3 || !team.members.some((m:any)=>m.windows.length && m.busy.length))throw new Error('Expected populated member free/busy calendar.');
 const venue=await read(`/v1/resources/${id(100)}/calendar?${query}`);
 if(!venue.windows.length||!venue.busy.length)throw new Error('Expected demo venue opening/busy times.');
 const mentorships=await read(`/v1/projects/${id(10)}/mentorships`);
 if(!mentorships.some((m:any)=>m.state==='accepted'))throw new Error('Missing accepted demonstration mentor.');
 console.log('PASS hosted demo: team free/busy, venue availability and accepted mentorship.');
 for(const path of ['/v1/mentors','/v1/mentorships','/v1/resources','/v1/bookings','/v1/consultation-slots','/v1/consultations','/v1/vouchers','/v1/me/notifications','/v1/me/invitations',`/v1/projects/${id(10)}/collaboration-requests`,`/v1/projects/${id(10)}/messages`,`/v1/projects/${id(10)}/proposals`,`/v1/projects/${id(10)}/progress`,`/v1/projects/${id(10)}/files`]){
  const items=await read(path);
  if(!Array.isArray(items)||!items.length)throw new Error(`Expected demo examples in ${path}.`);
  console.log(`PASS ${path}: ${items.length} examples/records`);
 }
}
