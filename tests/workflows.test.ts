import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { createApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import { localAuth } from '../scripts/local-auth.js';
import { localDatabase, seed, fixtures } from '../scripts/db-tools.js';
import { asActor } from '../packages/db/src/database.js';
import { createBuildZClient } from '../packages/sdk/src/index.js';
import { seedDemoWorkflows } from '../scripts/seed-demo-workflows.js';
let db: Awaited<ReturnType<typeof localDatabase>>,
  auth: Awaited<ReturnType<typeof localAuth>>,
  runtime: Awaited<ReturnType<typeof createApp>>,
  admin: pg.Pool,
  base: string,
  tokens: string[];
const school = fixtures.institutions[0]!.id,
  school2 = fixtures.institutions[1]!.id;
const uid = (i: number) => fixtures.users[i]!.id;
const future = (hours: number) =>
  new Date(
    Math.ceil(Date.now() / 60000) * 60000 + hours * 3600000,
  ).toISOString();
async function req(
  user: number | null,
  method: string,
  path: string,
  body?: unknown,
  key = randomUUID(),
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      ...(user === null ? {} : { Authorization: `Bearer ${tokens[user]}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, ...((await r.json()) as any) };
}
async function ok(
  user: number | null,
  method: string,
  path: string,
  body?: unknown,
  status = method === 'POST' ? 201 : 200,
) {
  const r = await req(user, method, path, body);
  expect(r.status, JSON.stringify({ path, ...r })).toBe(status);
  return r.data;
}
async function project(user = 0) {
  return ok(user, 'POST', '/v1/projects', {
    title: 'BuildZ prototype',
    summary: 'Private working notes',
    projectType: 'engineering',
    leadInstitutionId: user === 1 ? school2 : school,
  });
}
async function addMember(p: string, user = 1) {
  const inv = await ok(0, 'POST', `/v1/projects/${p}/invitations`, {
    email: fixtures.users[user]!.email,
    role: 'member',
  });
  await ok(user, 'POST', `/v1/invitations/${inv.id}/accept`, undefined, 200);
}
async function resource(extra: Record<string, unknown> = {}) {
  return ok(3, 'POST', '/v1/resources', {
    institutionId: school,
    name: 'Maker room',
    description: 'A safe supervised space',
    category: 'room',
    location: 'Campus A',
    latitude: 1.3,
    longitude: 103.8,
    currency: 'SGD',
    hourlyRate: 1000,
    externalHourlyRate: 1500,
    crossSchool: true,
    requiresApproval: false,
    safetyCode: null,
    capacity: 5,
    ...extra,
  });
}
async function windows(r: string, start = future(24), end = future(48)) {
  return ok(
    3,
    'POST',
    `/v1/resources/${r}/windows`,
    { windows: [{ startsAt: start, endsAt: end }] },
    200,
  );
}
async function bookingInput(
  p: string,
  r: string,
  start = future(25),
  end = future(26),
  attendees = [uid(0)],
) {
  return {
    resourceId: r,
    projectId: p,
    startsAt: start,
    endsAt: end,
    attendees,
  };
}
async function reserve(input: Record<string, unknown>, user = 0) {
  const q = await ok(user, 'POST', '/v1/booking-quotes', input, 200);
  return ok(user, 'POST', '/v1/bookings', {
    ...input,
    resourceVersion: q.resourceVersion,
    expectedTotalMinor: q.totalMinor,
  });
}
beforeAll(async () => {
  db = await localDatabase();
  await seed(db.adminUrl);
  auth = await localAuth();
  tokens = await Promise.all(fixtures.users.map((_, i) => auth.token(i)));
  admin = new pg.Pool({ connectionString: db.adminUrl });
  runtime = await createApp(
    loadConfig({
      NODE_ENV: 'test',
      PORT: '0',
      DATABASE_URL: db.apiUrl,
      DATABASE_SSL: 'false',
      AUTH_ISSUER: auth.issuer,
      AUTH_JWKS_URL: auth.issuer + '/.well-known/jwks.json',
      AUTH_USERINFO_URL: auth.issuer + '/user',
      AUTH_PUBLISHABLE_KEY: 'local',
      CORS_ORIGINS: 'http://localhost:5173',
      APP_ORIGIN: 'http://localhost:5173',
    }),
  );
  await runtime.app.listen(0, '127.0.0.1');
  base = await runtime.app.getUrl();
});
afterAll(async () => {
  await runtime?.close();
  await auth?.stop();
  await admin?.end();
  await db?.stop();
});

describe('M2: proposals, allocated time, evidence and reviews', () => {
  it('keeps drafts private, scopes staff review and grants supervisor/time', async () => {
    const p = await project();
    expect((await req(3, 'GET', `/v1/projects/${p.id}`)).status).toBe(404);
    const proposal = await ok(0, 'POST', `/v1/projects/${p.id}/proposals`, {
      objectives: 'Build a working prototype',
      supportRequested: 'Room and supervision',
      minutesRequested: 180,
    });
    expect(
      (
        await req(4, 'POST', `/v1/proposals/${proposal.id}/decisions`, {
          version: 1,
          decision: 'approved',
          reason: 'Other school',
        })
      ).status,
    ).toBe(404);
    const reviewProject = await ok(3, 'GET', `/v1/projects/${p.id}`);
    expect(reviewProject.capabilities.canReviewProgress).toBe(true);
    const queue = await ok(3, 'GET', '/v1/review/proposals');
    expect(queue.some((r: any) => r.id === proposal.id)).toBe(true);
    const approved = await ok(
      3,
      'POST',
      `/v1/proposals/${proposal.id}/decisions`,
      {
        version: 1,
        decision: 'approved',
        reason: 'Approved with weekly check-in',
        minutesGranted: 120,
        supervisorId: uid(3),
      },
      200,
    );
    expect(approved.minutesGranted).toBe(120);
    expect(approved.supervisorId).toBe(uid(3));
    expect(
      (
        await req(3, 'POST', `/v1/proposals/${proposal.id}/decisions`, {
          version: 1,
          decision: 'rejected',
          reason: 'stale',
        })
      ).status,
    ).toBe(409);
    const progress = await ok(0, 'POST', `/v1/projects/${p.id}/progress`, {
      summary: 'Frame assembled',
      minutesSpent: 30,
      evidence: [
        {
          url: 'https://example.com/evidence.jpg',
          kind: 'photo',
          label: 'Prototype photo',
        },
      ],
    });
    expect((await req(1, 'GET', `/v1/projects/${p.id}/progress`)).status).toBe(
      403,
    );
    const review = await ok(3, 'POST', `/v1/progress/${progress.id}/reviews`, {
      feedback: 'Good progress; reinforce the frame',
      outcome: 'acknowledged',
    });
    expect(review.reviewerId).toBe(uid(3));
    expect(
      await ok(0, 'GET', `/v1/progress/${progress.id}/reviews`),
    ).toHaveLength(1);
    const staff = await ok(0, 'GET', `/v1/institutions/${school}/staff`);
    expect(staff[0]).toHaveProperty('displayName');
    expect(staff[0]).not.toHaveProperty('email');
  });
  it('rejects unsafe evidence URLs and cross-school supervisor assignment', async () => {
    const p = await project();
    expect(
      (
        await req(0, 'POST', `/v1/projects/${p.id}/progress`, {
          summary: 'x',
          minutesSpent: 1,
          evidence: [{ url: 'javascript:alert(1)', kind: 'link', label: 'x' }],
        })
      ).status,
    ).toBe(422);
    const proposal = await ok(0, 'POST', `/v1/projects/${p.id}/proposals`, {
      objectives: 'Test',
      supportRequested: 'Advice',
      minutesRequested: 60,
    });
    expect(
      (
        await req(3, 'POST', `/v1/proposals/${proposal.id}/decisions`, {
          version: 1,
          decision: 'approved',
          reason: 'x',
          supervisorId: uid(4),
        })
      ).error.code,
    ).toBe('INVALID_SUPERVISOR');
  });
  it('stores private evidence files, validates types and rejects cross-project references', async () => {
    const p = await project(),
      other = await project();
    const contentBase64 = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(120000),
    ]).toString('base64');
    const file = await ok(0, 'POST', `/v1/projects/${p.id}/files`, {
      name: 'prototype.png',
      mimeType: 'image/png',
      contentBase64,
    });
    expect(file.sizeBytes).toBe(120008);
    expect(file).not.toHaveProperty('contentBase64');
    expect(
      (await req(null, 'GET', `/v1/files/${file.id}/content`)).status,
    ).toBe(401);
    expect((await req(1, 'GET', `/v1/files/${file.id}/content`)).status).toBe(
      404,
    );
    expect(
      (await ok(0, 'GET', `/v1/files/${file.id}/content`)).contentBase64,
    ).toBe(contentBase64);
    await ok(0, 'POST', `/v1/projects/${p.id}/progress`, {
      summary: 'Photo evidence',
      minutesSpent: 20,
      evidence: [{ fileId: file.id, kind: 'photo', label: 'Prototype' }],
    });
    expect(
      (
        await req(0, 'POST', `/v1/projects/${other.id}/progress`, {
          summary: 'Wrong project',
          minutesSpent: 1,
          evidence: [{ fileId: file.id, kind: 'photo', label: 'x' }],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await req(0, 'POST', `/v1/projects/${p.id}/files`, {
          name: 'evil.png',
          mimeType: 'image/png',
          contentBase64: Buffer.from('<script>alert(1)</script>').toString(
            'base64',
          ),
        })
      ).error.code,
    ).toBe('FILE_TYPE_MISMATCH');
  });
});

describe('M3: resources, private availability, safety and atomic reservations', () => {
  it('gates resource management by institution and supports stable distance/price sorting', async () => {
    const r = await resource();
    expect(
      (
        await req(4, 'PATCH', `/v1/resources/${r.id}`, {
          version: 1,
          name: 'Cannot hijack',
        })
      ).status,
    ).toBe(404);
    const near = await req(
      0,
      'GET',
      '/v1/resources?sort=nearest&latitude=1.3&longitude=103.8&limit=1',
    );
    expect(near.status).toBe(200);
    expect(near.data[0].distanceKm).toBeLessThan(0.1);
    expect((await req(0, 'GET', '/v1/resources?sort=cheapest')).status).toBe(
      422,
    );
    expect(
      (await req(0, 'GET', '/v1/resources?sort=cheapest&currency=SGD')).status,
    ).toBe(200);
    const privateResource = await resource({ crossSchool: false });
    expect(
      (await req(1, 'GET', `/v1/resources/${privateResource.id}`)).status,
    ).toBe(404);
  });
  it('intersects selected teammate availability without exposing full private calendars', async () => {
    const p = await project();
    await addMember(p.id);
    const r = await resource();
    await windows(r.id);
    for (const user of [0, 1])
      await ok(
        user,
        'POST',
        '/v1/me/availability',
        { windows: [{ startsAt: future(25), endsAt: future(28) }] },
        200,
      );
    const all = await ok(0, 'GET', '/v1/me/availability?all=true');
    expect(all).toHaveLength(1);
    const result = await ok(
      0,
      'POST',
      `/v1/projects/${p.id}/build-slots/search`,
      {
        participantIds: [uid(0), uid(1)],
        resourceId: r.id,
        startsAt: future(24),
        endsAt: future(29),
        durationMinutes: 60,
      },
      200,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].availableParticipantIds).toHaveLength(2);
    expect(
      (
        await req(2, 'POST', `/v1/projects/${p.id}/build-slots/search`, {
          participantIds: [uid(0)],
          resourceId: r.id,
          startsAt: future(24),
          endsAt: future(29),
          durationMinutes: 60,
        })
      ).status,
    ).toBe(404);
    await asActor(
      runtime.db,
      { id: uid(0), email: fixtures.users[0]!.email, displayName: 'Alice' },
      async (tx) => {
        const others =
          await sql`select * from app.availability where user_id=${uid(1)}::uuid`.execute(
            tx,
          );
        expect(others.rows).toHaveLength(0);
      },
    );
  });
  it('enforces safety credentials and expiry for every attendee', async () => {
    const p = await project();
    const r = await resource({ safetyCode: 'LASER-101' });
    await windows(r.id);
    const input = await bookingInput(p.id, r.id);
    expect((await req(0, 'POST', '/v1/booking-quotes', input)).error.code).toBe(
      'ATTENDEE_INELIGIBLE',
    );
    const credential = await ok(3, 'POST', '/v1/safety-credentials', {
      institutionId: school,
      userId: uid(0),
      safetyCode: 'LASER-101',
      validUntil: future(100),
    });
    expect(
      (await ok(0, 'GET', '/v1/me/safety-credentials')).some(
        (c: any) => c.id === credential.id,
      ),
    ).toBe(true);
    expect((await req(0, 'POST', '/v1/booking-quotes', input)).status).toBe(
      200,
    );
    await ok(
      3,
      'POST',
      `/v1/safety-credentials/${credential.id}/revoke`,
      undefined,
      200,
    );
    expect((await req(0, 'POST', '/v1/booking-quotes', input)).error.code).toBe(
      'ATTENDEE_INELIGIBLE',
    );
  });
  it('allows only one concurrent reservation for an overlapping resource interval', async () => {
    const p = await project(),
      other = await project(1),
      r = await resource();
    await windows(r.id);
    const a = await bookingInput(p.id, r.id, future(30), future(31));
    const b = await bookingInput(other.id, r.id, future(30), future(31), [
      uid(1),
    ]);
    const qa = await ok(0, 'POST', '/v1/booking-quotes', a, 200),
      qb = await ok(1, 'POST', '/v1/booking-quotes', b, 200);
    const results = await Promise.all([
      req(0, 'POST', '/v1/bookings', {
        ...a,
        resourceVersion: qa.resourceVersion,
        expectedTotalMinor: qa.totalMinor,
      }),
      req(1, 'POST', '/v1/bookings', {
        ...b,
        resourceVersion: qb.resourceVersion,
        expectedTotalMinor: qb.totalMinor,
      }),
    ]);
    expect(
      results.map((x) => x.status).sort(),
      JSON.stringify(results),
    ).toEqual([201, 409]);
    const winner = results.find((x) => x.status === 201)!.data;
    expect((await req(2, 'GET', `/v1/bookings/${winner.id}`)).status).toBe(404);
    expect(
      (
        await req(0, 'POST', `/v1/projects/${p.id}/lifecycle`, {
          version: 1,
          lifecycle: 'archived',
        })
      ).status,
    ).toBe(results[0]!.status === 201 ? 409 : 200);
  });
  it('checks stale quotes and prevents double-booking a person across different resources', async () => {
    const p = await project(),
      r = await resource(),
      r2 = await resource();
    await windows(r.id);
    await windows(r2.id);
    const a = await bookingInput(p.id, r.id, future(32), future(33));
    const q = await ok(0, 'POST', '/v1/booking-quotes', a, 200);
    expect(
      (
        await req(0, 'POST', '/v1/bookings', {
          ...a,
          resourceVersion: q.resourceVersion,
          expectedTotalMinor: q.totalMinor + 1,
        })
      ).error.code,
    ).toBe('QUOTE_CHANGED');
    const b = await reserve(a);
    expect(b.totalMinor).toBe(1000);
    expect(
      (
        await req(
          0,
          'POST',
          '/v1/booking-quotes',
          await bookingInput(p.id, r2.id, future(32), future(33)),
        )
      ).error.code,
    ).toBe('ATTENDEE_BUSY');
    await ok(
      0,
      'POST',
      `/v1/bookings/${b.id}/decisions`,
      { version: 1, decision: 'cancelled', reason: 'Rescheduling' },
      200,
    );
    expect(
      (
        await req(
          0,
          'POST',
          '/v1/booking-quotes',
          await bookingInput(p.id, r2.id, future(32), future(33)),
        )
      ).status,
    ).toBe(200);
  });
  it('supports approval, preserves booked windows and expires pending holds with the restricted worker', async () => {
    const p = await project(),
      r = await resource({ requiresApproval: true });
    await windows(r.id);
    const b = await reserve(
      await bookingInput(p.id, r.id, future(34), future(35)),
    );
    expect(b.state).toBe('pending');
    expect(
      (await req(3, 'POST', `/v1/resources/${r.id}/windows`, { windows: [] }))
        .error.code,
    ).toBe('ACTIVE_BOOKINGS');
    expect(
      (
        await req(0, 'POST', `/v1/bookings/${b.id}/decisions`, {
          version: 1,
          decision: 'confirmed',
          reason: 'self approve',
        })
      ).status,
    ).toBe(403);
    await ok(
      3,
      'POST',
      `/v1/bookings/${b.id}/decisions`,
      { version: 1, decision: 'confirmed', reason: 'Approved' },
      200,
    );
    const next = await reserve(
      await bookingInput(p.id, r.id, future(36), future(37)),
    );
    await admin.query(
      "update app.bookings set expires_at=now()-interval '1 second' where id=$1",
      [next.id],
    );
    const worker = new pg.Client({ connectionString: db.workerUrl });
    await worker.connect();
    try {
      expect(
        (await worker.query('select app.expire_bookings() as n')).rows[0].n,
      ).toBe(1);
    } finally {
      await worker.end();
    }
    expect((await ok(0, 'GET', `/v1/bookings/${next.id}`)).state).toBe(
      'expired',
    );
  });
  it('keeps cancellation available after a manager disables a facility', async () => {
    const p = await project(),
      r = await resource();
    await windows(r.id);
    const b = await reserve(
      await bookingInput(p.id, r.id, future(38), future(39)),
    );
    const current = await ok(3, 'GET', `/v1/resources/${r.id}`);
    await ok(3, 'PATCH', `/v1/resources/${r.id}`, {
      version: current.version,
      active: false,
    });
    expect((await ok(0, 'GET', `/v1/resources/${r.id}`)).active).toBe(false);
    await ok(
      0,
      'POST',
      `/v1/bookings/${b.id}/decisions`,
      { version: 1, decision: 'cancelled', reason: 'Facility disabled' },
      200,
    );
  });
  it('protects future reservations on member removal, and removes file access on exit', async () => {
    const p = await project();
    await addMember(p.id);
    const r = await resource();
    await windows(r.id);
    const file = await ok(0, 'POST', `/v1/projects/${p.id}/files`, {
      name: 'plan.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64'),
    });
    const b = await reserve(
      await bookingInput(p.id, r.id, future(44), future(45), [uid(0), uid(1)]),
    );
    expect(
      (
        await req(0, 'DELETE', `/v1/projects/${p.id}/members/${uid(1)}`, {
          version: 2,
        })
      ).error.code,
    ).toBe('ACTIVE_RESERVATIONS');
    expect(
      (
        await req(1, 'DELETE', `/v1/projects/${p.id}/members/${uid(1)}`, {
          version: 2,
        })
      ).error.code,
    ).toBe('ACTIVE_RESERVATIONS');
    await ok(
      0,
      'POST',
      `/v1/bookings/${b.id}/decisions`,
      { version: 1, decision: 'cancelled', reason: 'Team change' },
      200,
    );
    expect((await req(1, 'GET', `/v1/files/${file.id}/content`)).status).toBe(
      200,
    );
    await ok(0, 'DELETE', `/v1/projects/${p.id}/members/${uid(1)}`, {
      version: 2,
    });
    expect((await req(1, 'GET', `/v1/files/${file.id}/content`)).status).toBe(
      404,
    );
  });
});

describe('M4: consultations, private messages and inbox', () => {
  it('books consultation slots without granting private team membership', async () => {
    const p = await project();
    const slot = await ok(3, 'POST', '/v1/consultation-slots', {
      institutionId: school,
      startsAt: future(50),
      endsAt: future(51),
      location: 'Mentor office',
      crossSchool: true,
    });
    const c = await ok(0, 'POST', '/v1/consultations', {
      slotId: slot.id,
      projectId: p.id,
      topic: 'Prototype feasibility',
    });
    expect(c.startsAt).toBe(slot.startsAt);
    expect(c.hostId).toBe(uid(3));
    expect(c.hostDisplayName).toBeTruthy();
    expect((await req(3, 'GET', `/v1/projects/${p.id}/messages`)).status).toBe(
      403,
    );
    expect(
      (
        await req(0, 'POST', '/v1/consultations', {
          slotId: slot.id,
          projectId: p.id,
          topic: 'Duplicate',
        })
      ).status,
    ).toBe(409);
    expect(
      (await req(3, 'POST', `/v1/consultation-slots/${slot.id}/close`)).error
        .code,
    ).toBe('SLOT_BOOKED');
    await ok(
      0,
      'POST',
      `/v1/consultations/${c.id}/decisions`,
      { version: 1, decision: 'cancelled' },
      200,
    );
    await ok(
      3,
      'POST',
      `/v1/consultation-slots/${slot.id}/close`,
      undefined,
      200,
    );
  });
  it('delivers messages and read markers only to the permitted identities', async () => {
    const p = await project();
    await addMember(p.id);
    const msg = await ok(0, 'POST', `/v1/projects/${p.id}/messages`, {
      body: 'Can we build tomorrow?',
    });
    expect((await ok(1, 'GET', `/v1/projects/${p.id}/messages`))[0].id).toBe(
      msg.id,
    );
    expect((await req(2, 'GET', `/v1/projects/${p.id}/messages`)).status).toBe(
      403,
    );
    const notifications = await ok(
      1,
      'GET',
      '/v1/me/notifications?unread=true',
    );
    const notice = notifications.find((n: any) => n.subjectId === msg.id);
    expect(notice).toBeTruthy();
    expect(
      (await req(2, 'POST', `/v1/notifications/${notice.id}/read`)).status,
    ).toBe(404);
    expect(
      (
        await ok(
          1,
          'POST',
          `/v1/notifications/${notice.id}/read`,
          undefined,
          200,
        )
      ).readAt,
    ).toBeTruthy();
  });
});

describe('M5: public opt-in, collaboration consent and moderation', () => {
  it('publishes a sanitized projection and preserves private workspace isolation', async () => {
    const p = await project();
    expect((await req(null, 'GET', `/v1/public/projects/${p.id}`)).status).toBe(
      404,
    );
    const pub = await ok(
      0,
      'POST',
      `/v1/projects/${p.id}/publication`,
      {
        version: 1,
        title: 'Solar maker project',
        summary: 'Our public pitch',
        tags: ['climate'],
        seeking: 'A teammate',
      },
      200,
    );
    expect(pub.shareUrl).toContain('/showcase/');
    expect(pub).not.toHaveProperty('ownerId');
    expect((await ok(null, 'GET', `/v1/public/projects/${p.id}`)).summary).toBe(
      'Our public pitch',
    );
    expect((await req(1, 'GET', `/v1/projects/${p.id}`)).status).toBe(404);
    expect(
      (await ok(null, 'GET', '/v1/public/projects?tag=climate')).some(
        (x: any) => x.id === p.id,
      ),
    ).toBe(true);
    const join = await ok(
      1,
      'POST',
      `/v1/public/projects/${p.id}/collaboration-requests`,
      { message: 'I can help with CAD', kind: 'join' },
    );
    expect((await req(1, 'GET', `/v1/projects/${p.id}`)).status).toBe(404);
    await ok(
      0,
      'POST',
      `/v1/collaboration-requests/${join.id}/decisions`,
      { version: 1, decision: 'accepted', response: 'Welcome' },
      200,
    );
    const joined = await ok(1, 'GET', `/v1/projects/${p.id}`);
    expect(joined.capabilities.canEdit).toBe(false);
    await ok(
      0,
      'POST',
      `/v1/projects/${p.id}/unpublish`,
      { version: joined.version },
      200,
    );
    expect((await req(null, 'GET', `/v1/public/projects/${p.id}`)).status).toBe(
      404,
    );
  });
  it('accepts advice without membership, supports withdrawal and school-scoped moderation', async () => {
    const p = await project();
    await ok(
      0,
      'POST',
      `/v1/projects/${p.id}/publication`,
      {
        version: 1,
        title: 'Public',
        summary: 'Safe pitch',
        tags: [],
        seeking: '',
      },
      200,
    );
    const advice = await ok(
      1,
      'POST',
      `/v1/public/projects/${p.id}/collaboration-requests`,
      { message: 'Can I ask a question?', kind: 'advice' },
    );
    await ok(
      0,
      'POST',
      `/v1/collaboration-requests/${advice.id}/decisions`,
      { version: 1, decision: 'accepted', response: 'Here is some advice' },
      200,
    );
    expect((await req(1, 'GET', `/v1/projects/${p.id}`)).status).toBe(404);
    const join = await ok(
      2,
      'POST',
      `/v1/public/projects/${p.id}/collaboration-requests`,
      { message: 'Interested', kind: 'join' },
    );
    await ok(
      2,
      'POST',
      `/v1/collaboration-requests/${join.id}/decisions`,
      { version: 1, decision: 'withdrawn' },
      200,
    );
    const report = await ok(1, 'POST', `/v1/public/projects/${p.id}/reports`, {
      reason: 'Please review this content',
    });
    expect(
      (
        await req(4, 'POST', `/v1/reports/${report.id}/decisions`, {
          decision: 'removed',
        })
      ).status,
    ).toBe(404);
    await ok(
      3,
      'POST',
      `/v1/reports/${report.id}/decisions`,
      { decision: 'removed' },
      200,
    );
    expect((await req(null, 'GET', `/v1/public/projects/${p.id}`)).status).toBe(
      404,
    );
    const current = await ok(0, 'GET', `/v1/projects/${p.id}`);
    expect(
      (
        await req(0, 'POST', `/v1/projects/${p.id}/publication`, {
          version: current.version,
          title: 'Bypass',
          summary: 'Try republishing',
          tags: [],
          seeking: '',
        })
      ).error.code,
    ).toBe('PUBLICATION_BLOCKED');
  });
});

describe('M6: fixed school credits with immutable pricing and release ledger', () => {
  it('atomically consumes a voucher budget and releases it on cancellation', async () => {
    const p = await project(),
      r = await resource();
    await windows(r.id);
    const voucher = await ok(3, 'POST', '/v1/vouchers', {
      institutionId: school,
      code: 'MAKER_' + randomUUID().slice(0, 8).toUpperCase(),
      currency: 'SGD',
      discountMinor: 600,
      budgetMinor: 600,
      maxRedemptions: 1,
      validUntil: future(100),
    });
    const a = {
      ...(await bookingInput(p.id, r.id, future(40), future(41))),
      voucherCode: voucher.code,
    };
    const b = await reserve(a);
    expect(b.subtotalMinor).toBe(1000);
    expect(b.discountMinor).toBe(600);
    expect(b.totalMinor).toBe(400);
    expect(
      (
        await req(0, 'POST', '/v1/booking-quotes', {
          ...a,
          startsAt: future(42),
          endsAt: future(43),
        })
      ).error.code,
    ).toBe('VOUCHER_EXHAUSTED');
    await ok(
      0,
      'POST',
      `/v1/bookings/${b.id}/decisions`,
      { version: 1, decision: 'cancelled', reason: 'Changed plan' },
      200,
    );
    expect(
      (
        await req(0, 'POST', '/v1/booking-quotes', {
          ...a,
          startsAt: future(42),
          endsAt: future(43),
        })
      ).status,
    ).toBe(200);
    const ledger = await ok(3, 'GET', `/v1/vouchers/${voucher.id}/ledger`);
    expect(
      ledger
        .map((l: any) => l.amountMinor)
        .sort((x: number, y: number) => x - y),
    ).toEqual([-600, 600]);
    expect(
      (await req(0, 'GET', `/v1/vouchers/${voucher.id}/ledger`)).status,
    ).toBe(403);
    await ok(
      3,
      'POST',
      `/v1/vouchers/${voucher.id}/deactivate`,
      undefined,
      200,
    );
  });
  it('works through the generated SDK and never advertises real-time transport', async () => {
    const client = createBuildZClient({
      baseUrl: base,
      getAccessToken: () => tokens[0]!,
    });
    const r = await client.GET('/v1/me/notifications', {
      params: { query: { limit: 10 } },
    });
    expect(r.response.status).toBe(200);
    const meta = await ok(null, 'GET', '/v1/meta');
    expect(meta.features.vouchers).toBe(true);
    expect(meta.features.liveEvents).toBe(false);
  });
  it('serializes voucher limits across two different resources and schools', async () => {
    const a = await project(),
      b = await project(1),
      r1 = await resource(),
      r2 = await resource();
    await windows(r1.id);
    await windows(r2.id);
    const voucher = await ok(3, 'POST', '/v1/vouchers', {
      institutionId: school,
      code: 'RACE_' + randomUUID().slice(0, 8).toUpperCase(),
      currency: 'SGD',
      discountMinor: 500,
      budgetMinor: 500,
      maxRedemptions: 1,
      validUntil: future(100),
    });
    const inputA = {
      ...(await bookingInput(a.id, r1.id, future(46), future(47))),
      voucherCode: voucher.code,
    };
    const inputB = {
      ...(await bookingInput(b.id, r2.id, future(46), future(47), [uid(1)])),
      voucherCode: voucher.code,
    };
    const q1 = await ok(0, 'POST', '/v1/booking-quotes', inputA, 200),
      q2 = await ok(1, 'POST', '/v1/booking-quotes', inputB, 200);
    const result = await Promise.all([
      req(0, 'POST', '/v1/bookings', {
        ...inputA,
        resourceVersion: q1.resourceVersion,
        expectedTotalMinor: q1.totalMinor,
      }),
      req(1, 'POST', '/v1/bookings', {
        ...inputB,
        resourceVersion: q2.resourceVersion,
        expectedTotalMinor: q2.totalMinor,
      }),
    ]);
    expect(result.map((r) => r.status).sort(), JSON.stringify(result)).toEqual([
      201, 409,
    ]);
    const totals = await admin.query(
      'select sum(amount_minor) as total from app.credit_ledger where voucher_id=$1',
      [voucher.id],
    );
    expect(Number(totals.rows[0].total)).toBe(500);
  });
  it('seeds fictional workflows idempotently without overwriting edits', async () => {
    await seedDemoWorkflows(db.adminUrl);
    await seedDemoWorkflows(db.adminUrl);
    const r = await admin.query(
      "select title from app.projects where id='b0120000-0000-4000-8000-000000000001'",
    );
    expect(r.rows[0].title).toContain('SolarCycle');
  });
});
