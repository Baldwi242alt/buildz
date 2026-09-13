-- Operator-only Supabase deployment step, separate from portable app migrations.
-- No paid Render worker, HTTP keep-alive requests, or credentials in job text.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'buildz-reservation-expiry',
  '* * * * *',
  $job$BEGIN;
  SET LOCAL ROLE buildz_worker;
  SET LOCAL statement_timeout = '20s';
  SELECT app.expire_invitations() + app.expire_bookings();
  COMMIT;$job$
);
