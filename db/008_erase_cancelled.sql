-- =====================================================================
-- db/008_erase_cancelled.sql
-- Supports "Cancel out" erasing money records WITHOUT leaving a trace.
--
-- WHAT IT DOES
--   1. Creates a small hidden table, import_skip_receipts, that holds ONLY
--      M-PESA receipt numbers (no amounts, no names). When you import an old
--      statement again, the app skips any receipt on this list, so entries you
--      erased do not come back. Nothing in the app shows or exports this list.
--   2. Copies the receipt numbers from earlier cancel-outs (kept until now in
--      job_runs) into that list.
--   3. Deletes those old cancel-out records from job_runs, so nothing says
--      what was cancelled. (This is the one step that deletes data, and it is
--      what you asked for. It touches only job_runs rows where job is
--      'cancel_out'.)
--   4. Locks the new table like every other table.
--
-- SAFE TO RUN TWICE. It never changes payments, expenses, members or balances.
--
-- HOW TO RUN
--   Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
-- EXPECTED RESULT
--   One row. skip_table_exists, skip_table_locked and no_cancel_records_left
--   must all be true. receipts_remembered and fee_rows_left_from_old_cancels
--   are just numbers (see the notes at the end of README section 3.4).
-- =====================================================================

create table if not exists public.import_skip_receipts (
  id uuid primary key default gen_random_uuid(),
  mpesa_receipt text not null unique,
  created_at timestamptz not null default now()
);

alter table public.import_skip_receipts enable row level security;
revoke all on public.import_skip_receipts from anon, authenticated;

-- Step 2: remember the receipts of earlier cancel-outs, before their records go.
insert into public.import_skip_receipts (mpesa_receipt)
select distinct r.receipt
from (
  select e ->> 'mpesa_receipt' as receipt
  from public.job_runs j
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(j.details -> 'expenses') = 'array' then j.details -> 'expenses' else '[]'::jsonb end
  ) e
  where j.job = 'cancel_out'
  union
  select p ->> 'mpesa_receipt' as receipt
  from public.job_runs j
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(j.details -> 'payments') = 'array' then j.details -> 'payments' else '[]'::jsonb end
  ) p
  where j.job = 'cancel_out'
) r
where r.receipt is not null and r.receipt <> ''
on conflict (mpesa_receipt) do nothing;

-- Step 3: erase the old cancel-out records.
delete from public.job_runs where job = 'cancel_out';

-- The check:
select
  to_regclass('public.import_skip_receipts') is not null as skip_table_exists,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.import_skip_receipts')), false) as skip_table_locked,
  not exists (select 1 from public.job_runs where job = 'cancel_out') as no_cancel_records_left,
  (select count(*) from public.import_skip_receipts) as receipts_remembered,
  (select count(*) from public.fund_expenses
     where kind = 'charge' and mpesa_receipt in (select mpesa_receipt from public.import_skip_receipts)) as fee_rows_left_from_old_cancels;
