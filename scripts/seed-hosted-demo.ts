import type pg from 'pg';
import {createHash} from 'node:crypto';

/** Operator-only, additive examples. Never copies real people or grants the
 * shared login staff access. Stable IDs preserve subsequent user edits. */
export async function seedHostedDemo(client:pg.Client) {
 const found=await client.query(`select p.id,m.institution_id from app.profiles p join app.institution_memberships m on m.user_id=p.id join app.institutions i on i.id=m.institution_id
 where p.email='demo@buildz.example' and m.affiliation='student' and m.status='verified' and i.slug='buildz-demo-campus' and i.is_demo`);
 if(found.rowCount!==1)throw new Error('Expected one reserved demo student in the fictional demo campus.');
 const owner=found.rows[0].id,school=found.rows[0].institution_id;
 const id=(n:number)=>`bd130000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const projects=[
  ['SolarCycle (Demo)','engineering','A solar-powered charging station made from reclaimed bicycle parts.','Prototype the charging circuit and test the frame.'],
  ['Campus Voices (Demo)','creative','A student podcast sharing stories from campus makers.','Record three interviews and edit the pilot episode.'],
  ['ShareShelf (Demo)','community','A campus exchange for surplus stationery and useful materials.','Test a collection point and a simple item-sharing catalogue.'],
  ['QuietSpace (Private Demo)','engineering','Private working notes for a study-space noise indicator.','Build a privacy-preserving sound-level prototype without recording conversations.']
 ];
 await client.query('BEGIN');
 try {
  await client.query('select pg_advisory_xact_lock(873511211)');
  const collision=await client.query('select id from app.projects where id=any($1::uuid[]) and (owner_id<>$2 or lead_institution_id<>$3)',[projects.map((_,i)=>id(10+i)),owner,school]);
  if(collision.rowCount)throw new Error('Demo IDs belong to another owner/campus; refusing to alter them.');
  for(const [n,name,staff] of [[1,'Avery Chen (Demo Mentor)',true],[2,'Riley Tan (Demo Mentor)',true],[3,'Maya Lee (Demo Teammate)',false],[4,'Noah Lim (Demo Teammate)',false],[5,'Sam Ong (Demo Collaborator)',false]] as const){
   await client.query('insert into app.profiles(id,email,display_name) values($1,$2,$3) on conflict(id) do nothing',[id(n),`demo-${n}@buildz.example`,name]);
   await client.query("insert into app.institution_memberships(institution_id,user_id,affiliation,status) values($1,$2,$3,'verified') on conflict do nothing",[school,id(n),staff?'staff':'student']);
   if(staff)await client.query("insert into app.role_assignments(institution_id,user_id,role) values($1,$2,'reviewer') on conflict(institution_id,user_id,role) where revoked_at is null do nothing",[school,id(n)]);
  }
  for(const [i,p] of projects.entries()){
   await client.query("insert into app.projects(id,lead_institution_id,owner_id,title,project_type,summary,lifecycle) values($1,$2,$3,$4,$5,$6,'active') on conflict(id) do nothing",[id(10+i),school,owner,p[0],p[1],p[2]]);
   for(const person of [owner,id(3),id(4)])await client.query("insert into app.project_memberships(project_id,user_id,role) values($1,$2,$3) on conflict do nothing",[id(10+i),person,person===owner?'editor':'member']);
   if(i<3)await client.query("insert into app.public_projects(id,title,summary,project_type,tags,seeking) values($1,$2,$3,$4,ARRAY['demo','campus-builders'],'Fictional demo: looking for collaborators and mentor feedback.') on conflict(id) do nothing",[id(10+i),p[0],p[2],p[1]]);
   await client.query("insert into app.proposals(id,project_id,author_id,objectives,support_requested,minutes_requested,state,decision_reason,decided_by,supervisor_id,minutes_granted) values($1,$2,$3,$4,'Demo request for maker-space time and guidance.',240,'approved','Fictional demo approval for the prototype stage.',$5,$5,180) on conflict(id) do nothing",[id(30+i),id(10+i),owner,p[3],id(1)]);
   await client.query("insert into app.progress_updates(id,project_id,author_id,summary,minutes_spent) values($1,$2,$3,$4,45) on conflict(id) do nothing",[id(40+i),id(10+i),owner,`Demo update: first planning session completed. Next: ${p[3]}`]);
   await client.query("insert into app.progress_reviews(id,progress_id,project_id,reviewer_id,feedback,outcome) values($1,$2,$3,$4,'Demo feedback: define one measurable test for your next session.','acknowledged') on conflict(id) do nothing",[id(50+i),id(40+i),id(10+i),id(1)]);
   await client.query("insert into app.messages(id,project_id,sender_id,body) values($1,$2,$3,'Demo teammate: I have shared my availability. Pick a date in Calendar to compare our free time.') on conflict(id) do nothing",[id(60+i),id(10+i),id(3)]);
   await client.query("insert into app.mentorships(id,project_id,mentor_id,requested_by,message,state,version) values($1,$2,$3,$4,'Fictional demo request: help us plan a useful prototype test.',$5,$6) on conflict(id) do nothing",[id(70+i),id(10+i),id(i===1||i===2?2:1),owner,i===2?'pending':'accepted',i===2?1:2]);
  }
  const anchor=await client.query('select created_at from app.projects where id=$1',[id(10)]);
  const date=new Date(+new Date(anchor.rows[0].created_at)+8*3600000).toISOString().slice(0,10);
  const at=(day:number,hour:number)=>new Date(+new Date(`${date}T00:00:00+08:00`)+(day*24+hour)*3600000);
  const venues=[['Maker Commons (Demo)','room','Innovation Block, Level 2',0,12],['Lightbox Photo Studio (Demo)','studio','Arts Block, Level 1',800,6],['SoundLab Recording Studio (Demo)','studio','Media Hub, Room 3',1000,4],['Prototype Workshop (Demo)','workshop','Innovation Block, Ground Floor',500,8]];
  for(const [i,v] of venues.entries()){
   await client.query("insert into app.resources(id,institution_id,name,description,category,location,latitude,longitude,currency,hourly_rate,external_hourly_rate,cross_school,capacity) values($1,$2,$3,'Fictional BuildZ demo venue. No real-world reservation or payment.',$4,$5,1.30,103.80,'SGD',$6,$6,false,$7) on conflict(id) do nothing",[id(100+i),school,v[0],v[1],v[2],v[3],v[4]]);
   for(let d=0;d<42;d++)await client.query('insert into app.resource_windows(id,resource_id,starts_at,ends_at) values($1,$2,$3,$4) on conflict(id) do nothing',[id(1000+i*50+d),id(100+i),at(d,9),at(d,18)]);
  }
  for(let d=0;d<42;d++)for(const [i,person] of [owner,id(3),id(4)].entries()) {
   // A teammate deliberately shares no time every third day (unknown, not busy).
   if(i===2 && d%3===0)continue;
   await client.query('insert into app.availability(id,user_id,starts_at,ends_at) values($1,$2,$3,$4) on conflict(id) do nothing',[id(2000+i*50+d),person,at(d,i===1?10:9),at(d,i===2?13:18)]);
  }
  for(let d=1;d<=10;d++)for(let i=0;i<2;i++){
   const rate=i===0?0:800;
   await client.query("insert into app.bookings(id,resource_id,project_id,booked_by,starts_at,ends_at,state,attendees,currency,subtotal_minor,discount_minor,total_minor) values($1,$2,$3,$4,$5,$6,'confirmed',$7::uuid[],'SGD',$8,0,$8) on conflict(id) do nothing",[id(3000+d*10+i),id(100+i),id(10+i),owner,at(d,11+i*3),at(d,12+i*3),[owner,id(3)],rate]);
  }
  for(let d=1;d<=14;d++)for(let i=0;i<2;i++)await client.query("insert into app.consultation_slots(id,institution_id,host_id,starts_at,ends_at,location) values($1,$2,$3,$4,$5,'Demo Campus mentor lounge — fictional appointment') on conflict(id) do nothing",[id(4000+d*10+i),school,id(1+i),at(d,16+i),at(d,16.5+i)]);
  await client.query("insert into app.consultations(id,slot_id,project_id,booked_by,topic) values($1,$2,$3,$4,'Demo consultation: prototype safety and the first user test') on conflict(id) do nothing",[id(4200),id(4020),id(10),owner]);
  await client.query("insert into app.vouchers(id,institution_id,code,currency,discount_minor,budget_minor,max_redemptions,valid_until) values($1,$2,'BUILDZ-DEMO-500','SGD',500,50000,100,$3) on conflict(id) do nothing",[id(5000),school,at(60,18)]);
  await client.query("insert into app.collaboration_requests(id,project_id,requester_id,message,kind) values($1,$2,$3,'Demo collaborator: I can help test the solar charging circuit. Could we discuss joining?','join') on conflict(id) do nothing",[id(5100),id(10),id(5)]);
  await client.query("insert into app.project_invitations(id,project_id,recipient_email,role,invited_by,expires_at) values($1,$2,'demo-5@buildz.example','member',$3,$4) on conflict(id) do nothing",[id(5200),id(11),owner,at(30,18)]);
  for(const [i,type,subject] of [[0,'mentorship.accepted',id(70)],[1,'consultation.booked',id(4200)],[2,'collaboration.requested',id(5100)],[3,'progress.reviewed',id(50)]] as const)await client.query('insert into app.notifications(id,recipient_id,type,subject_id) values($1,$2,$3,$4) on conflict(id) do nothing',[id(5300+i),owner,type,subject]);
  // A tiny valid PDF, clearly labelled as fabricated demonstration evidence.
  const stream='BT /F1 14 Tf 40 120 Td (BuildZ DEMO ONLY - prototype checklist) Tj 0 -25 Td (1. Define a test. 2. Record results. 3. Ask a mentor.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,o] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const content=Buffer.from(pdf);
  await client.query("insert into app.project_files(id,project_id,uploaded_by,name,mime_type,size_bytes,sha256,content) values($1,$2,$3,'Demo prototype checklist.pdf','application/pdf',$4,$5,$6) on conflict(id) do nothing",[id(5400),id(10),owner,content.length,createHash('sha256').update(content).digest('hex'),content]);
  await client.query("insert into app.audit_events(actor_id,action,subject_id) values(null,'operator.seed_fictional_demo', $1)",[owner]);
  await client.query('COMMIT');
  console.log('Seeded additive fictional demo: 3 public + 1 private projects, teammates, mentors, 42-day availability, 4 venues, bookings, consultation, progress, PDF, chat, collaboration, invitations, credits and notifications. Existing rows preserved.');
 } catch(error){await client.query('ROLLBACK');throw error;}
}
