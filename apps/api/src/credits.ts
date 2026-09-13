import { sql } from 'kysely';
import type { Context } from './context.js';
import { record } from './context.js';
import { ApiError } from './errors.js';
import { one, listClause, listed, permitted } from './workflow-utils.js';

export async function createVoucher(ctx: Context) {
  const b = ctx.body;
  if (Date.parse(String(b.validUntil)) <= Date.now())
    throw new ApiError(
      422,
      'INVALID_EXPIRY',
      'Voucher expiry must be in the future.',
    );
  const v = await one(
    ctx,
    sql`insert into app.vouchers(institution_id,code,currency,discount_minor,budget_minor,max_redemptions,valid_until)
    values(${b.institutionId as string}::uuid,${b.code as string},${b.currency as string},${b.discountMinor as number},${b.budgetMinor as number},${b.maxRedemptions as number},${b.validUntil as string}::timestamptz) returning *`,
  );
  await record(ctx, 'voucher.created', v.id);
  return v;
}
export async function listVouchers(ctx: Context) {
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.vouchers where active and valid_until>now() ${clause} ${ctx.query.institutionId ? sql`and institution_id=${ctx.query.institutionId as string}::uuid` : sql``} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
export async function deactivateVoucher(ctx: Context) {
  const v = await one(
    ctx,
    sql`update app.vouchers set active=false where id=${ctx.params.id}::uuid returning *`,
  );
  await record(ctx, 'voucher.deactivated', v.id);
  return v;
}
export async function voucherLedger(ctx: Context) {
  const v = await one(
    ctx,
    sql`select * from app.vouchers where id=${ctx.params.id}::uuid`,
  );
  await permitted(
    ctx,
    sql<boolean>`app.has_school_role(${v.institutionId}::uuid,'resource_manager')`,
  );
  const { limit, clause } = listClause(ctx);
  return listed(
    ctx,
    sql`select * from app.credit_ledger where voucher_id=${v.id}::uuid ${clause} order by created_at desc,id desc limit ${limit + 1}`,
  );
}
