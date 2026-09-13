/** Reproducible mechanical expansion of the canonical OpenAPI document. */
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
const file = 'packages/contracts/openapi.yaml';
const doc = parse(readFileSync(file, 'utf8'), { maxAliasCount: -1 });
type S = Record<string, any>;
const str = (max = 2000, min = 1): S => ({
  type: 'string',
  minLength: min,
  maxLength: max,
  ...(min ? { pattern: '.*\\S.*' } : {}),
});
const en = (...values: string[]): S => ({ type: 'string', enum: values });
const uuid: S = { type: 'string', format: 'uuid' },
  date: S = { type: 'string', format: 'date-time' },
  bool: S = { type: 'boolean' };
const int = (min = 0, max = 10000000): S => ({
  type: 'integer',
  minimum: min,
  maximum: max,
});
const nullable = (s: S): S => ({ ...s, nullable: true });
const arr = (items: S, max = 100): S => ({
  type: 'array',
  items,
  maxItems: max,
});
const obj = (properties: S, required = Object.keys(properties)): S => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const ref = (name: string): S => ({ $ref: '#/components/schemas/' + name });
const version = int(1),
  stamp = { id: uuid, createdAt: date };
const school = { institutionId: uuid };
const span = { startsAt: date, endsAt: date };
const money = {
  currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  subtotalMinor: int(),
  discountMinor: int(),
  totalMinor: int(),
};
const S = doc.components.schemas;
Object.assign(S, {
  Proposal: obj({
    ...stamp,
    projectId: uuid,
    authorId: uuid,
    objectives: str(5000),
    supportRequested: str(3000),
    minutesRequested: int(0, 100000),
    state: en('submitted', 'approved', 'changes_requested', 'rejected'),
    decisionReason: nullable(str()),
    decidedBy: nullable(uuid),
    supervisorId: nullable(uuid),
    minutesGranted: int(0, 100000),
    version,
  }),
  SubmitProposal: obj({
    objectives: str(5000),
    supportRequested: str(3000),
    minutesRequested: int(0, 100000),
  }),
  DecideProposal: obj(
    {
      version,
      decision: en('approved', 'changes_requested', 'rejected'),
      reason: str(),
      supervisorId: uuid,
      minutesGranted: int(0, 100000),
    },
    ['version', 'decision', 'reason'],
  ),
  Evidence: {
    ...obj(
      {
        url: {
          type: 'string',
          format: 'uri',
          pattern: '^https://',
          maxLength: 2048,
        },
        fileId: uuid,
        label: str(150),
        kind: en('photo', 'document', 'video', 'link'),
      },
      ['label', 'kind'],
    ),
    oneOf: [{ required: ['url'] }, { required: ['fileId'] }],
  },
  Progress: obj({
    ...stamp,
    projectId: uuid,
    authorId: uuid,
    summary: str(5000),
    minutesSpent: int(0, 100000),
    evidence: arr(ref('Evidence'), 10),
  }),
  SubmitProgress: obj(
    {
      summary: str(5000),
      minutesSpent: int(0, 100000),
      evidence: arr(ref('Evidence'), 10),
    },
    ['summary', 'minutesSpent'],
  ),
  ProgressReview: obj({
    ...stamp,
    progressId: uuid,
    projectId: uuid,
    reviewerId: uuid,
    feedback: str(3000),
    outcome: en('acknowledged', 'needs_attention'),
  }),
  ReviewProgress: obj({
    feedback: str(3000),
    outcome: en('acknowledged', 'needs_attention'),
  }),
  ResourceInput: obj({
    ...school,
    name: str(150),
    description: str(3000),
    category: en('room', 'studio', 'equipment', 'workshop', 'other'),
    location: str(300),
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    currency: money.currency,
    hourlyRate: int(),
    externalHourlyRate: int(),
    crossSchool: bool,
    requiresApproval: bool,
    safetyCode: nullable(str(100)),
    capacity: int(1, 1000),
  }),
  Window: obj(span),
  ResourceWindow: obj({ ...stamp, resourceId: uuid, ...span }),
  SetWindows: obj({ windows: arr(ref('Window'), 100) }),
  Availability: obj({ ...stamp, userId: uuid, ...span }),
  SafetyCredential: obj({
    ...stamp,
    ...school,
    userId: uuid,
    safetyCode: str(100),
    verifiedBy: uuid,
    validUntil: date,
    revokedAt: nullable(date),
  }),
  GrantSafety: obj({
    ...school,
    userId: uuid,
    safetyCode: str(100),
    validUntil: date,
  }),
  SlotSearch: obj(
    {
      participantIds: { ...arr(uuid, 20), minItems: 1, uniqueItems: true },
      requiredParticipantIds: { ...arr(uuid, 20), uniqueItems: true },
      minimumAttendees: int(1, 20),
      resourceId: uuid,
      ...span,
      durationMinutes: int(5, 480),
    },
    ['participantIds', 'resourceId', 'startsAt', 'endsAt', 'durationMinutes'],
  ),
  BuildSlot: obj({
    ...span,
    resourceId: uuid,
    availableParticipantIds: arr(uuid, 20),
    estimatedTotalMinor: int(),
    currency: money.currency,
  }),
  BookingInput: obj(
    {
      resourceId: uuid,
      projectId: uuid,
      ...span,
      attendees: { ...arr(uuid, 20), minItems: 1, uniqueItems: true },
      voucherCode: str(64),
    },
    ['resourceId', 'projectId', 'startsAt', 'endsAt', 'attendees'],
  ),
  BookingQuote: obj({
    resourceId: uuid,
    resourceVersion: version,
    ...span,
    ...money,
    requiresApproval: bool,
    voucherId: nullable(uuid),
    validUntil: date,
    paymentMode: en('school_managed'),
  }),
  Booking: obj({
    ...stamp,
    resourceId: uuid,
    projectId: uuid,
    bookedBy: uuid,
    ...span,
    attendees: arr(uuid, 20),
    ...money,
    voucherId: nullable(uuid),
    expiresAt: nullable(date),
    state: en(
      'pending',
      'confirmed',
      'cancelled',
      'rejected',
      'expired',
      'completed',
      'no_show',
    ),
    decisionReason: nullable(str()),
    version,
  }),
  BookingDecision: obj(
    {
      version,
      decision: en(
        'confirmed',
        'cancelled',
        'rejected',
        'completed',
        'no_show',
      ),
      reason: str(),
    },
    ['version', 'decision', 'reason'],
  ),
  ConsultationSlot: obj({
    ...stamp,
    ...school,
    hostId: uuid,
    ...span,
    location: str(300),
    crossSchool: bool,
    active: bool,
  }),
  CreateConsultationSlot: obj({
    ...school,
    ...span,
    location: str(300),
    crossSchool: bool,
  }),
  Consultation: obj({
    ...stamp,
    slotId: uuid,
    projectId: uuid,
    bookedBy: uuid,
    topic: str(2000),
    state: en('booked', 'cancelled', 'completed'),
    version,
    ...span,
    location: str(300),
    hostId: uuid,
    hostDisplayName: str(100),
    ...school,
  }),
  BookConsultation: obj({ slotId: uuid, projectId: uuid, topic: str(2000) }),
  ConsultationDecision: obj({
    version,
    decision: en('cancelled', 'completed'),
  }),
  Message: obj({ ...stamp, projectId: uuid, senderId: uuid, body: str(4000) }),
  SendMessage: obj({ body: str(4000) }),
  Notification: obj({
    ...stamp,
    recipientId: uuid,
    type: str(100),
    subjectId: uuid,
    readAt: nullable(date),
  }),
  PublicProject: obj({
    ...stamp,
    title: str(150),
    summary: str(2000),
    projectType: en(
      'business',
      'engineering',
      'creative',
      'community',
      'other',
    ),
    tags: arr(str(40), 10),
    seeking: str(1000, 0),
    published: bool,
    version,
    updatedAt: date,
    shareUrl: { type: 'string', format: 'uri' },
  }),
  PublishProject: obj(
    {
      version,
      title: str(150),
      summary: str(2000),
      tags: { ...arr(str(40), 10), uniqueItems: true },
      seeking: str(1000, 0),
    },
    ['version', 'title', 'summary', 'tags', 'seeking'],
  ),
  CollaborationRequest: obj({
    ...stamp,
    projectId: uuid,
    requesterId: uuid,
    message: str(2000),
    kind: en('advice', 'join'),
    state: en('pending', 'accepted', 'declined', 'withdrawn'),
    response: nullable(str(2000)),
    version,
  }),
  RequestCollaboration: obj({ message: str(2000), kind: en('advice', 'join') }),
  DecideCollaboration: obj(
    {
      version,
      decision: en('accepted', 'declined', 'withdrawn'),
      response: str(2000),
    },
    ['version', 'decision'],
  ),
  ContentReport: obj({
    ...stamp,
    projectId: uuid,
    reporterId: uuid,
    reason: str(2000),
    state: en('pending', 'dismissed', 'removed'),
  }),
  ReportContent: obj({ reason: str(2000) }),
  ModerateReport: obj({ decision: en('dismissed', 'removed') }),
  Voucher: obj({
    ...stamp,
    ...school,
    code: str(64),
    currency: money.currency,
    discountMinor: int(1),
    budgetMinor: int(1),
    maxRedemptions: int(1),
    validUntil: date,
    active: bool,
  }),
  CreateVoucher: obj({
    ...school,
    code: { ...str(64), pattern: '^[A-Z0-9_-]{3,64}$' },
    currency: money.currency,
    discountMinor: int(1),
    budgetMinor: int(1),
    maxRedemptions: int(1),
    validUntil: date,
  }),
  CreditEntry: obj({
    ...stamp,
    voucherId: uuid,
    bookingId: uuid,
    amountMinor: { type: 'integer' },
    kind: en('redeem', 'release'),
  }),
});
S.Resource = obj({
  ...stamp,
  ...S.ResourceInput.properties,
  active: bool,
  version,
  distanceKm: nullable({ type: 'number', minimum: 0 }),
});
S.UpdateResource = obj(
  {
    version,
    ...Object.fromEntries(
      Object.entries(S.ResourceInput.properties).filter(
        ([k]) => k !== 'institutionId',
      ),
    ),
    active: bool,
  },
  ['version'],
);
S.CreateBooking = obj(
  {
    ...S.BookingInput.properties,
    resourceVersion: version,
    expectedTotalMinor: int(),
  },
  [...S.BookingInput.required, 'resourceVersion', 'expectedTotalMinor'],
);
S.Project.properties.publicationAudience.enum = ['private', 'public'];
S.ProjectCapabilities.properties.canReviewProgress = bool;
S.ProjectCapabilities.properties.canMessage = bool;
S.StaffMember = obj({ userId: uuid, displayName: str(100) });
S.ProjectFile = obj({
  ...stamp,
  projectId: uuid,
  uploadedBy: uuid,
  name: str(150),
  mimeType: en('image/jpeg', 'image/png', 'image/webp', 'application/pdf'),
  sizeBytes: int(1, 2097152),
  sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
});
S.UploadFile = obj({
  name: str(150),
  mimeType: S.ProjectFile.properties.mimeType,
  contentBase64: {
    type: 'string',
    minLength: 4,
    maxLength: 2796204,
    pattern: '^[A-Za-z0-9+/]+={0,2}$',
  },
});
S.FileContent = obj({
  ...S.ProjectFile.properties,
  contentBase64: { type: 'string', maxLength: 2796204 },
});
for (const key of [
  'proposals',
  'progress',
  'resources',
  'availability',
  'consultations',
  'messages',
  'notifications',
  'vouchers',
  'files',
])
  S.ServiceMeta.properties.features.properties[key] = bool;
const param = (name: string, schema: S, required = false) => ({
  name,
  in: 'query',
  required,
  schema,
});
const paging = [param('limit', int(1, 100)), param('cursor', str(500))];
function route(
  method: string,
  path: string,
  id: string,
  response: string | S,
  body?: string,
  {
    paged = false,
    list = false,
    anonymous = false,
    query = [] as S[],
    status = method === 'post' ? 201 : 200,
    idempotent = method === 'post',
  } = {},
) {
  const parameters: S[] = [
    ...[...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: uuid,
    })),
    ...query,
    ...(paged ? paging : []),
  ];
  if (idempotent)
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      schema: {
        type: 'string',
        minLength: 8,
        maxLength: 128,
        pattern: '^[A-Za-z0-9_-]+$',
      },
    });
  const data = typeof response === 'string' ? ref(response) : response;
  const operation: S = {
    operationId: id,
    summary: id,
    parameters,
    responses: {
      [status]: {
        description: 'Success',
        content: {
          'application/json': {
            schema: obj({
              data: paged || list ? arr(data, 101) : data,
              meta: ref(paged ? 'PageMeta' : 'Meta'),
            }),
          },
        },
      },
      default: {
        description: 'Structured error; 401, 403, 404, 409, 422 or 429.',
        content: { 'application/json': { schema: ref('Error') } },
      },
    },
  };
  if (body)
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: ref(body) } },
    };
  if (paged) operation['x-paginated'] = true;
  if (idempotent) operation['x-idempotent'] = true;
  if (anonymous) operation.security = [];
  (doc.paths[path] ??= {})[method] = operation;
}
route(
  'get',
  '/v1/projects/{id}/proposals',
  'listProposals',
  'Proposal',
  undefined,
  { paged: true },
);
route(
  'post',
  '/v1/projects/{id}/proposals',
  'submitProposal',
  'Proposal',
  'SubmitProposal',
);
route('get', '/v1/review/proposals', 'reviewQueue', 'Proposal', undefined, {
  paged: true,
});
route(
  'post',
  '/v1/proposals/{id}/decisions',
  'decideProposal',
  'Proposal',
  'DecideProposal',
  { status: 200 },
);
route(
  'get',
  '/v1/projects/{id}/progress',
  'listProgress',
  'Progress',
  undefined,
  { paged: true },
);
route(
  'post',
  '/v1/projects/{id}/progress',
  'submitProgress',
  'Progress',
  'SubmitProgress',
);
route(
  'get',
  '/v1/progress/{id}/reviews',
  'listProgressReviews',
  'ProgressReview',
  undefined,
  { list: true },
);
route(
  'post',
  '/v1/progress/{id}/reviews',
  'reviewProgress',
  'ProgressReview',
  'ReviewProgress',
);
route('get', '/v1/resources', 'listResources', 'Resource', undefined, {
  paged: true,
  query: [
    param('institutionId', uuid),
    param('category', S.ResourceInput.properties.category),
    param('latitude', { type: 'number', minimum: -90, maximum: 90 }),
    param('longitude', { type: 'number', minimum: -180, maximum: 180 }),
    param('sort', en('nearest', 'cheapest', 'newest')),
    param('currency', money.currency),
  ],
});
route('post', '/v1/resources', 'createResource', 'Resource', 'ResourceInput');
route('get', '/v1/resources/{id}', 'getResource', 'Resource');
route(
  'patch',
  '/v1/resources/{id}',
  'updateResource',
  'Resource',
  'UpdateResource',
);
route(
  'get',
  '/v1/resources/{id}/windows',
  'listResourceWindows',
  'ResourceWindow',
  undefined,
  {
    list: true,
    query: [param('startsAt', date), param('endsAt', date), param('all', bool)],
  },
);
route(
  'post',
  '/v1/resources/{id}/windows',
  'setResourceWindows',
  'ResourceWindow',
  'SetWindows',
  { list: true, status: 200 },
);
route(
  'get',
  '/v1/me/availability',
  'listAvailability',
  'Availability',
  undefined,
  {
    list: true,
    query: [param('startsAt', date), param('endsAt', date), param('all', bool)],
  },
);
route(
  'post',
  '/v1/me/availability',
  'setAvailability',
  'Availability',
  'SetWindows',
  { list: true, status: 200 },
);
route(
  'post',
  '/v1/projects/{id}/build-slots/search',
  'searchBuildSlots',
  'BuildSlot',
  'SlotSearch',
  { list: true, status: 200, idempotent: false },
);
route(
  'get',
  '/v1/me/safety-credentials',
  'listSafety',
  'SafetyCredential',
  undefined,
  { paged: true },
);
route(
  'post',
  '/v1/safety-credentials',
  'grantSafety',
  'SafetyCredential',
  'GrantSafety',
);
route(
  'post',
  '/v1/safety-credentials/{id}/revoke',
  'revokeSafety',
  'SafetyCredential',
  undefined,
  { status: 200 },
);
route(
  'post',
  '/v1/booking-quotes',
  'quoteBooking',
  'BookingQuote',
  'BookingInput',
  { status: 200, idempotent: false },
);
route('post', '/v1/bookings', 'createBooking', 'Booking', 'CreateBooking');
route('get', '/v1/bookings', 'listBookings', 'Booking', undefined, {
  paged: true,
  query: [param('projectId', uuid), param('resourceId', uuid)],
});
route('get', '/v1/bookings/{id}', 'getBooking', 'Booking');
route(
  'post',
  '/v1/bookings/{id}/decisions',
  'decideBooking',
  'Booking',
  'BookingDecision',
  { status: 200 },
);
route(
  'get',
  '/v1/consultation-slots',
  'listConsultationSlots',
  'ConsultationSlot',
  undefined,
  { paged: true, query: [param('institutionId', uuid)] },
);
route(
  'post',
  '/v1/consultation-slots',
  'createConsultationSlot',
  'ConsultationSlot',
  'CreateConsultationSlot',
);
route(
  'post',
  '/v1/consultation-slots/{id}/close',
  'closeConsultationSlot',
  'ConsultationSlot',
  undefined,
  { status: 200 },
);
route(
  'get',
  '/v1/consultations',
  'listConsultations',
  'Consultation',
  undefined,
  { paged: true, query: [param('projectId', uuid)] },
);
route(
  'post',
  '/v1/consultations',
  'bookConsultation',
  'Consultation',
  'BookConsultation',
);
route(
  'post',
  '/v1/consultations/{id}/decisions',
  'decideConsultation',
  'Consultation',
  'ConsultationDecision',
  { status: 200 },
);
route(
  'get',
  '/v1/projects/{id}/messages',
  'listMessages',
  'Message',
  undefined,
  { paged: true },
);
route(
  'post',
  '/v1/projects/{id}/messages',
  'sendMessage',
  'Message',
  'SendMessage',
);
route(
  'get',
  '/v1/me/notifications',
  'listNotifications',
  'Notification',
  undefined,
  { paged: true, query: [param('unread', bool)] },
);
route(
  'post',
  '/v1/notifications/{id}/read',
  'readNotification',
  'Notification',
  undefined,
  { status: 200 },
);
route(
  'get',
  '/v1/public/projects',
  'discoverProjects',
  'PublicProject',
  undefined,
  {
    paged: true,
    anonymous: true,
    query: [
      param('search', str(100)),
      param('tag', str(40)),
      param('projectType', S.PublicProject.properties.projectType),
    ],
  },
);
route(
  'get',
  '/v1/public/projects/{id}',
  'getPublicProject',
  'PublicProject',
  undefined,
  { anonymous: true },
);
route(
  'post',
  '/v1/projects/{id}/publication',
  'publishProject',
  'PublicProject',
  'PublishProject',
  { status: 200 },
);
route(
  'post',
  '/v1/projects/{id}/unpublish',
  'unpublishProject',
  'PublicProject',
  'VersionCommand',
  { status: 200 },
);
route(
  'post',
  '/v1/public/projects/{id}/collaboration-requests',
  'requestCollaboration',
  'CollaborationRequest',
  'RequestCollaboration',
);
route(
  'get',
  '/v1/projects/{id}/collaboration-requests',
  'listProjectRequests',
  'CollaborationRequest',
  undefined,
  { paged: true },
);
route(
  'get',
  '/v1/me/collaboration-requests',
  'listMyRequests',
  'CollaborationRequest',
  undefined,
  { paged: true },
);
route(
  'post',
  '/v1/collaboration-requests/{id}/decisions',
  'decideCollaboration',
  'CollaborationRequest',
  'DecideCollaboration',
  { status: 200 },
);
route(
  'post',
  '/v1/public/projects/{id}/reports',
  'reportContent',
  'ContentReport',
  'ReportContent',
);
route('get', '/v1/review/reports', 'listReports', 'ContentReport', undefined, {
  paged: true,
});
route(
  'post',
  '/v1/reports/{id}/decisions',
  'moderateReport',
  'ContentReport',
  'ModerateReport',
  { status: 200 },
);
route('get', '/v1/vouchers', 'listVouchers', 'Voucher', undefined, {
  paged: true,
  query: [param('institutionId', uuid)],
});
route('post', '/v1/vouchers', 'createVoucher', 'Voucher', 'CreateVoucher');
route(
  'post',
  '/v1/vouchers/{id}/deactivate',
  'deactivateVoucher',
  'Voucher',
  undefined,
  { status: 200 },
);
route(
  'get',
  '/v1/vouchers/{id}/ledger',
  'voucherLedger',
  'CreditEntry',
  undefined,
  { paged: true },
);
route('get', '/v1/review/projects', 'reviewProjects', 'Project', undefined, {
  paged: true,
});
route(
  'get',
  '/v1/institutions/{id}/staff',
  'listStaff',
  'StaffMember',
  undefined,
  { list: true },
);
route('get', '/v1/projects/{id}/files', 'listFiles', 'ProjectFile', undefined, {
  paged: true,
});
route(
  'post',
  '/v1/projects/{id}/files',
  'uploadFile',
  'ProjectFile',
  'UploadFile',
);
route('get', '/v1/files/{id}/content', 'downloadFile', 'FileContent');
doc.info = {
  title: 'BuildZ API',
  version: '0.2.1',
  description:
    'M0-M6 hackathon backend. Private authenticated workflows and explicit anonymous public projections. All times are UTC ISO-8601. Monetary amounts are integer minor units. Notifications use authenticated polling; payments are school-managed, not charged by BuildZ. Private file uploads are synchronous, at most 2 MiB per file/50 MiB per project, with signature checks but no malware-scan guarantee.',
};
writeFileSync(
  file,
  stringify(JSON.parse(JSON.stringify(doc)), { lineWidth: 120 }),
);
console.log(
  'Expanded BuildZ contract to',
  Object.values(doc.paths).reduce(
    (n: number, x: any) => n + Object.keys(x).length,
    0,
  ),
  'operations.',
);
