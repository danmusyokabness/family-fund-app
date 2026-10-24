-- =====================================================================
-- db/006_payment_purpose.sql
-- WHAT A PAYMENT IS FOR (see lib/payment-purpose.ts).
--
-- Until now every payment was treated as a member's monthly contribution,
-- and a payment marked "ignored" was treated as if it were not in the
-- account. Both were too simple. This adds:
--
--   payments.purpose            monthly | booster | recovery | donation | other
--                               (everything existing becomes "monthly", which
--                               is what it was)
--   payments.related_expense_id  for a "recovery" payment: the withdrawal it
--                               puts back (optional)
--
-- The app now counts EVERY payment in "Total in account", so that figure
-- always matches the M-PESA balance, and only "monthly" payments tick off a
-- member's months.
--
-- It also marks payments you had "ignored" (like a stray payment nobody
-- can be credited with) as purpose "other", so they are described as
-- "Other income" in the full ledger.
--
-- SAFE TO RUN TWICE. It never drops or deletes anything.
--
-- HOW TO RUN
--   Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
--   Do this BEFORE the new code is deployed.
-- EXPECTED RESULT
--   A small table with every value "true".
-- =====================================================================

alter table public.payments
  add column if not exists purpose text not null default 'monthly';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_purpose_check') then
    alter table public.payments
      add constraint payments_purpose_check
      check (purpose in ('monthly', 'booster', 'recovery', 'donation', 'other'));
  end if;
end $$;

alter table public.payments
  add column if not exists related_expense_id uuid references public.fund_expenses (id) on delete set null;

create index if not exists payments_purpose_idx on public.payments (purpose);
create index if not exists payments_related_expense_idx on public.payments (related_expense_id);

-- Money you marked "ignored" is real money in the account that is not credited
-- to anyone: describe it as such. (Only rows still on the default are touched,
-- so running this again changes nothing.)
update public.payments
   set purpose = 'other'
 where match_status = 'ignored'
   and purpose = 'monthly';

-- Check: every value should say true
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'purpose')             as payments_purpose,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'related_expense_id') as payments_related_expense_id,
  exists (select 1 from pg_constraint where conname = 'payments_purpose_check')                                                                      as purpose_check;
