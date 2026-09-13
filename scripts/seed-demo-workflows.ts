import pg from 'pg';
import { fixtures } from './db-tools.js';

/** Explicitly fictional local examples; fixed IDs make repeated seeding non-destructive. */
export async function seedDemoWorkflows(url: string) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('Demo workflow seeding is local-only.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const id = (n: number) =>
    `b0120000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const school = fixtures.institutions[0]!.id,
    otherSchool = fixtures.institutions[1]!.id;
  const alice = fixtures.users[0]!.id,
    bob = fixtures.users[1]!.id,
    staff = fixtures.users[3]!.id;
  const start = new Date(
      Math.ceil(Date.now() / 3600000) * 3600000 + 24 * 3600000,
    ),
    end = new Date(+start + 8 * 3600000);
  try {
    await client.query('BEGIN');
    for (const [pid, owner, sid, title, summary, type] of [
      [
        id(1),
        alice,
        school,
        'SolarCycle — campus charging station',
        'Turning discarded bicycle parts into a solar phone-charging station.',
        'engineering',
      ],
      [
        id(2),
        bob,
        otherSchool,
        'Campus Voices — student stories',
        'A student-led podcast connecting makers across campuses.',
        'creative',
      ],
    ]) {
      await client.query(
        `insert into app.projects(id,lead_institution_id,owner_id,title,summary,project_type,lifecycle) values($1,$2,$3,$4,$5,$6,'active') on conflict(id) do nothing`,
        [pid, sid, owner, title, summary, type],
      );
      await client.query(
        `insert into app.project_memberships(project_id,user_id,role) values($1,$2,'editor') on conflict do nothing`,
        [pid, owner],
      );
    }
    await client.query(
      `insert into app.project_memberships(project_id,user_id,role) values($1,$2,'member') on conflict do nothing`,
      [id(1), bob],
    );
    await client.query(
      `insert into app.public_projects(id,title,summary,project_type,tags,seeking) values($1,'SolarCycle — build a greener campus','We are prototyping a solar-powered campus charging station using reclaimed bicycle parts.','engineering',ARRAY['sustainability','hardware'],'Looking for electronics advice and a product designer.') on conflict(id) do nothing`,
      [id(1)],
    );
    await client.query(
      `insert into app.proposals(id,project_id,author_id,objectives,support_requested,minutes_requested,state,decision_reason,decided_by,supervisor_id,minutes_granted)
   values($1,$2,$3,'Build and test a safe charging prototype','Weekly maker-space access and engineering supervision',240,'approved','Approved for a supervised prototype pilot',$4,$4,180) on conflict(id) do nothing`,
      [id(3), id(1), alice, staff],
    );
    await client.query(
      `insert into app.progress_updates(id,project_id,author_id,summary,minutes_spent) values($1,$2,$3,'Completed the first frame sketch and tested a small solar panel. Next: assemble the charging circuit.',45) on conflict(id) do nothing`,
      [id(4), id(1), alice],
    );
    await client.query(
      `insert into app.progress_reviews(id,progress_id,project_id,reviewer_id,feedback,outcome) values($1,$2,$3,$4,'Good first test. Add a fuse and document the voltage measurements before connecting a phone.','acknowledged') on conflict(id) do nothing`,
      [id(5), id(4), id(1), staff],
    );
    const resources = [
      [
        'Collaborative Maker Room',
        'room',
        'Northstar Campus, Level 2',
        1.3,
        103.8,
        0,
        500,
        null,
        8,
      ],
      [
        'Photo Studio',
        'studio',
        'Northstar Arts Block',
        1.305,
        103.81,
        1000,
        1500,
        null,
        6,
      ],
      [
        'Recording Studio',
        'studio',
        'Northstar Media Hub',
        1.31,
        103.815,
        1500,
        2000,
        null,
        4,
      ],
      [
        '3D Printer — supervised',
        'equipment',
        'Northstar FabLab',
        1.3,
        103.801,
        500,
        800,
        'FABLAB-INTRO',
        3,
      ],
    ];
    for (const [i, r] of resources.entries()) {
      await client.query(
        `insert into app.resources(id,institution_id,name,description,category,location,latitude,longitude,currency,hourly_rate,external_hourly_rate,cross_school,requires_approval,safety_code,capacity)
    values($1,$2,$3,'Fictional BuildZ demonstration resource.',$4,$5,$6,$7,'SGD',$8,$9,true,$10,$11,$12) on conflict(id) do nothing`,
        [
          id(10 + i),
          school,
          r[0],
          r[1],
          r[2],
          r[3],
          r[4],
          r[5],
          r[6],
          i === 3,
          r[7],
          r[8],
        ],
      );
      await client.query(
        `insert into app.resource_windows(id,resource_id,starts_at,ends_at) values($1,$2,$3,$4) on conflict(id) do nothing`,
        [id(20 + i), id(10 + i), start, end],
      );
    }
    for (const [i, user] of [alice, bob].entries())
      await client.query(
        `insert into app.availability(id,user_id,starts_at,ends_at) values($1,$2,$3,$4) on conflict(id) do nothing`,
        [id(30 + i), user, start, end],
      );
    await client.query(
      `insert into app.safety_credentials(id,institution_id,user_id,safety_code,verified_by,valid_until) values($1,$2,$3,'FABLAB-INTRO',$4,$5) on conflict(id) do nothing`,
      [id(35), school, alice, staff, new Date(+start + 30 * 86400000)],
    );
    await client.query(
      `insert into app.consultation_slots(id,institution_id,host_id,starts_at,ends_at,location,cross_school) values($1,$2,$3,$4,$5,'Northstar innovation office',true) on conflict(id) do nothing`,
      [
        id(40),
        school,
        staff,
        new Date(+end + 3600000),
        new Date(+end + 5400000),
      ],
    );
    await client.query(
      `insert into app.messages(id,project_id,sender_id,body) values($1,$2,$3,'Welcome to SolarCycle! The maker room and team availability are ready for tomorrow. Use Find a build slot to choose a time.') on conflict(id) do nothing`,
      [id(50), id(1), alice],
    );
    await client.query(
      `insert into app.vouchers(id,institution_id,code,currency,discount_minor,budget_minor,max_redemptions,valid_until)
   values($1,$2,'BUILDZ-DEMO','SGD',500,25000,50,$3) on conflict(id) do nothing`,
      [id(60), school, new Date(+start + 30 * 86400000)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
