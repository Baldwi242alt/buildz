import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Context } from './context.js';
import { ApiError } from './errors.js';
import {
  one,
  permitted,
  listClause,
  listed,
  editableProject,
  activity,
} from './workflow-utils.js';
const metadata = sql`id,project_id,uploaded_by,name,mime_type,size_bytes,sha256,created_at`;
const MAX_FILE = 2 * 1024 * 1024,
  MAX_PROJECT = 50 * 1024 * 1024;
function validSignature(bytes: Buffer, mime: string) {
  if (mime === 'image/png')
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg')
    return (
      bytes.length > 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  if (mime === 'image/webp')
    return (
      bytes.subarray(0, 4).toString() === 'RIFF' &&
      bytes.subarray(8, 12).toString() === 'WEBP'
    );
  if (mime === 'application/pdf')
    return bytes.subarray(0, 5).toString() === '%PDF-';
  return false;
}
export async function uploadFile(ctx: Context) {
  await editableProject(ctx, ctx.params.id!);
  await permitted(
    ctx,
    sql<boolean>`app.lock_member_project(${ctx.params.id}::uuid)`,
  );
  const encoded = String(ctx.body.contentBase64),
    bytes = Buffer.from(encoded, 'base64');
  if (
    !bytes.length ||
    bytes.length > MAX_FILE ||
    bytes.toString('base64') !== encoded
  )
    throw new ApiError(
      422,
      'INVALID_FILE',
      'Use canonical base64 for a file of at most 2 MiB.',
    );
  const mime = String(ctx.body.mimeType);
  if (!validSignature(bytes, mime))
    throw new ApiError(
      422,
      'FILE_TYPE_MISMATCH',
      'The file bytes do not match the declared supported type.',
    );
  const name = String(ctx.body.name).replace(/[\\/\u0000-\u001f\u007f]/g, '_');
  const total = await one(
    ctx,
    sql`select coalesce(sum(size_bytes),0)::integer as bytes from app.project_files where project_id=${ctx.params.id}::uuid`,
  );
  if (total.bytes + bytes.length > MAX_PROJECT)
    throw new ApiError(
      422,
      'PROJECT_STORAGE_FULL',
      'The hackathon limit is 50 MiB per project.',
    );
  const file = await one(
    ctx,
    sql`insert into app.project_files(project_id,uploaded_by,name,mime_type,size_bytes,sha256,content)
  values(${ctx.params.id}::uuid,${ctx.actor.id}::uuid,${name},${mime},${bytes.length},${createHash('sha256').update(bytes).digest('hex')},${bytes}) returning ${metadata}`,
  );
  await activity(ctx, ctx.params.id!, 'file.uploaded', file.id);
  return file;
}
export async function listFiles(ctx: Context) {
  await permitted(
    ctx,
    sql<boolean>`app.workflow_access(${ctx.params.id}::uuid)`,
  );
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select ${metadata} from app.project_files where project_id=${ctx.params.id}::uuid ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function downloadFile(ctx: Context) {
  return one(
    ctx,
    sql`select ${metadata},replace(encode(content,'base64'),chr(10),'') as content_base64 from app.project_files where id=${ctx.params.id}::uuid`,
  );
}
