import { sql } from 'kysely';
import type { Context } from './context.js';
import { conflict, ApiError } from './errors.js';
import {
  one,
  listed,
  listClause,
  permitted,
  activity,
  editableProject,
  many,
} from './workflow-utils.js';

export async function submitProposal(ctx: Context) {
  await editableProject(ctx, ctx.params.id!, true);
  await permitted(
    ctx,
    sql<boolean>`app.lock_member_project(${ctx.params.id}::uuid)`,
  );
  const p = await one(
    ctx,
    sql`insert into app.proposals(project_id,author_id,objectives,support_requested,minutes_requested)
    values(${ctx.params.id}::uuid,${ctx.actor.id}::uuid,${ctx.body.objectives as string},${ctx.body.supportRequested as string},${ctx.body.minutesRequested as number}) returning *`,
  );
  await activity(ctx, p.projectId, 'proposal.submitted', p.id);
  return p;
}
export async function listProposals(ctx: Context) {
  await permitted(
    ctx,
    sql<boolean>`app.workflow_access(${ctx.params.id}::uuid)`,
  );
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.proposals where project_id=${ctx.params.id}::uuid ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function reviewQueue(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.proposals where state='submitted' and app.reviews_project(project_id) ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function decideProposal(ctx: Context) {
  const p = await one(
    ctx,
    sql`select * from app.proposals where id=${ctx.params.id}::uuid for update`,
  );
  await permitted(ctx, sql<boolean>`app.reviews_project(${p.projectId}::uuid)`);
  if (p.version !== ctx.body.version || p.state !== 'submitted')
    throw conflict();
  if (p.authorId === ctx.actor.id)
    throw new ApiError(
      403,
      'SELF_REVIEW_DENIED',
      'Another staff member must review your proposal.',
    );
  const supervisor = ctx.body.supervisorId as string | undefined;
  if (supervisor) {
    const valid = await one(
      ctx,
      sql`select app.valid_supervisor(${p.projectId}::uuid,${supervisor}::uuid) as ok`,
    );
    if (!valid.ok)
      throw new ApiError(
        422,
        'INVALID_SUPERVISOR',
        'Choose a verified staff member of the lead institution.',
      );
  }
  if (
    ctx.body.decision !== 'approved' &&
    (supervisor || ctx.body.minutesGranted)
  )
    throw new ApiError(
      422,
      'INVALID_GRANT',
      'Only approved proposals can grant time or a supervisor.',
    );
  const updated = await one(
    ctx,
    sql`update app.proposals set state=${ctx.body.decision as string},decision_reason=${ctx.body.reason as string},
    decided_by=${ctx.actor.id}::uuid,supervisor_id=${supervisor ?? null}::uuid,minutes_granted=${(ctx.body.minutesGranted as number) ?? 0},version=version+1 where id=${p.id}::uuid returning *`,
  );
  await activity(ctx, p.projectId, 'proposal.decided', p.id);
  return updated;
}
export async function submitProgress(ctx: Context) {
  await editableProject(ctx, ctx.params.id!);
  await permitted(
    ctx,
    sql<boolean>`app.lock_member_project(${ctx.params.id}::uuid)`,
  );
  for (const evidence of (ctx.body.evidence ?? []) as {
    fileId?: string;
    kind: string;
  }[]) {
    if (!evidence.fileId) continue;
    const f = await one(
      ctx,
      sql`select id,mime_type from app.project_files where id=${evidence.fileId}::uuid and project_id=${ctx.params.id}::uuid`,
    );
    if (
      (evidence.kind === 'photo' && !f.mimeType.startsWith('image/')) ||
      (evidence.kind === 'document' && f.mimeType !== 'application/pdf')
    )
      throw new ApiError(
        422,
        'EVIDENCE_TYPE_MISMATCH',
        'The evidence kind does not match the uploaded file.',
      );
  }
  const p = await one(
    ctx,
    sql`insert into app.progress_updates(project_id,author_id,summary,minutes_spent,evidence)
    values(${ctx.params.id}::uuid,${ctx.actor.id}::uuid,${ctx.body.summary as string},${ctx.body.minutesSpent as number},${JSON.stringify(ctx.body.evidence ?? [])}::jsonb) returning *`,
  );
  await activity(ctx, p.projectId, 'progress.submitted', p.id);
  return p;
}
export async function listProgress(ctx: Context) {
  await permitted(
    ctx,
    sql<boolean>`app.workflow_access(${ctx.params.id}::uuid)`,
  );
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.progress_updates where project_id=${ctx.params.id}::uuid ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function reviewProgress(ctx: Context) {
  const p = await one(
    ctx,
    sql`select * from app.progress_updates where id=${ctx.params.id}::uuid`,
  );
  await permitted(
    ctx,
    sql<boolean>`app.can_review_project(${p.projectId}::uuid)`,
  );
  if (p.authorId === ctx.actor.id)
    throw new ApiError(
      403,
      'SELF_REVIEW_DENIED',
      'Another staff member must review your progress.',
    );
  const r = await one(
    ctx,
    sql`insert into app.progress_reviews(progress_id,project_id,reviewer_id,feedback,outcome)
    values(${p.id}::uuid,${p.projectId}::uuid,${ctx.actor.id}::uuid,${ctx.body.feedback as string},${ctx.body.outcome as string}) returning *`,
  );
  await activity(ctx, p.projectId, 'progress.reviewed', p.id);
  return r;
}
export async function listProgressReviews(ctx: Context) {
  await one(
    ctx,
    sql`select id from app.progress_updates where id=${ctx.params.id}::uuid`,
  );
  return many(
    ctx,
    sql`select * from app.progress_reviews where progress_id=${ctx.params.id}::uuid order by created_at,id limit 100`,
  );
}
