-- =====================================================================
-- db/001_schema.sql
-- Family Emergency Fund: clean schema (Step 1)
--
-- HOW TO RUN
--   Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
--
-- WHAT IT DOES
--   * DROPS the old, non-functional tables: ledger_entries, member_phones,
--     members, message_board (and re-creates them in the new design).
--   * KEEPS family_nodes exactly as it is (it is cleaned up in Step 10),
--     so any family tree data you already entered is safe.
--   * Creates every table EMPTY. There is no seed data at all: fund name,
--     Till number, target, members and so on are entered later through
--     the Setup page.
--   * Turns on Row Level Security on every table and takes away all access
--     from the public "anon" and "authenticated" roles. Only the server
--     (using the service-role key) can read or write.
--
-- SAFETY GUARD
--   If public.payments already contains rows, this script refuses to run,
--   so it can never wipe real payment data by accident. During testing
--   (no payments yet) you can re-run it freely to reset everything.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Safety guard
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.payments') is not null then
    if exists (select 1 from public.payments limit 1) then
      raise exception 'Refusing to reset: public.payments already contains rows. If you really want to wipe everything, delete this safety block first.';
    end if;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1. Drop old and previous-run tables (children first)
-- ---------------------------------------------------------------------
drop table if exists public.payment_allocations cascade;
drop table if exists public.payer_aliases       cascade;
drop table if exists public.payments            cascade;
drop table if exists public.fund_expenses       cascade;
drop table if exists public.imports             cascade;
drop table if exists public.sms_log             cascade;
drop table if exists public.job_runs            cascade;
drop table if exists public.login_attempts      cascade;
drop table if exists public.message_board       cascade;
drop table if exists public.ledger_entries      cascade;
drop table if exists public.member_phones       cascade;
drop table if exists public.members             cascade;
drop table if exists public.settings            cascade;


-- ---------------------------------------------------------------------
-- 2. settings: key/value configuration, empty until Setup is saved
-- ---------------------------------------------------------------------
create table public.settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. members and their phones
-- ---------------------------------------------------------------------
create table public.members (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null check (length(btrim(full_name)) > 0),
  -- First day of the month the member started owing contributions.
  joined_on  date not null check (extract(day from joined_on) = 1),
  is_active  boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index members_full_name_idx on public.members (lower(full_name));

-- Full, real phone numbers only, stored as 2547XXXXXXXX or 2541XXXXXXXX.
-- Masked numbers and business numbers live in payer_aliases instead.
create table public.member_phones (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members (id) on delete cascade,
  phone_number text not null unique check (phone_number ~ '^254[17][0-9]{8}$'),
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index member_phones_member_idx on public.member_phones (member_id);

-- At most one primary phone per member.
create unique index member_phones_one_primary_idx
  on public.member_phones (member_id)
  where is_primary;


-- ---------------------------------------------------------------------
-- 4. payer_aliases: other ways a member's payments show up on M-PESA
--    masked_phone : e.g. 254712***772
--    shortcode    : a business number, e.g. 8760493
--    payer_name   : an M-PESA name remembered after a confirmation
-- ---------------------------------------------------------------------
create table public.payer_aliases (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members (id) on delete cascade,
  alias_type  text not null check (alias_type in ('masked_phone', 'shortcode', 'payer_name')),
  alias_value text not null check (length(btrim(alias_value)) > 0),
  source      text not null default 'admin' check (source in ('admin', 'confirmed', 'import')),
  created_at  timestamptz not null default now(),
  unique (member_id, alias_type, alias_value)
);

create index payer_aliases_lookup_idx on public.payer_aliases (alias_type, alias_value);


-- ---------------------------------------------------------------------
-- 5. imports: one row per statement upload (audit trail)
-- ---------------------------------------------------------------------
create table public.imports (
  id                         uuid primary key default gen_random_uuid(),
  source                     text not null check (source in ('pdf', 'csv', 'daraja')),
  filename                   text,
  uploaded_by                text,
  period_start               date,
  period_end                 date,
  rows_total                 integer not null default 0,
  rows_new                   integer not null default 0,
  rows_duplicate             integer not null default 0,
  rows_skipped               integer not null default 0,
  total_paid_in              numeric(12, 2),
  total_charges              numeric(12, 2),
  closing_balance_reported   numeric(12, 2),
  closing_balance_calculated numeric(12, 2),
  integrity_ok               boolean,
  status                     text not null default 'confirmed' check (status in ('confirmed', 'failed')),
  note                       text,
  created_at                 timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 6. payments: one row per money-in event
--    A payment counts for members only through payment_allocations.
--    match_status:
--      matched            allocations exist and are counted
--      needs_confirmation a name-based suggestion, NOT counted yet
--      unmatched          nothing usable, NOT counted yet
--      ignored            money in that is not a contribution
-- ---------------------------------------------------------------------
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  amount              numeric(12, 2) not null check (amount <> 0),
  kind                text not null check (kind in ('mpesa', 'manual', 'adjustment', 'opening')),
  source              text not null check (source in ('statement', 'daraja', 'admin')),
  mpesa_receipt       text,
  payer_name          text,
  payer_phone_masked  text,
  payer_ref           text,
  paid_at             timestamptz not null,
  match_status        text not null default 'unmatched'
                        check (match_status in ('matched', 'needs_confirmation', 'unmatched', 'ignored')),
  suggested_member_id uuid references public.members (id) on delete set null,
  suggestion_reason   text,
  import_id           uuid references public.imports (id) on delete set null,
  raw                 jsonb,
  note                text,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (kind <> 'mpesa' or amount > 0),
  check (kind <> 'mpesa' or mpesa_receipt is not null)
);

-- A receipt can only ever be recorded once, so re-importing never doubles anything.
create unique index payments_receipt_uq
  on public.payments (mpesa_receipt)
  where mpesa_receipt is not null;

create index payments_paid_at_idx on public.payments (paid_at desc);
create index payments_status_idx  on public.payments (match_status);


-- ---------------------------------------------------------------------
-- 7. payment_allocations: who each payment counts for
--    A split is simply several allocations for one payment.
-- ---------------------------------------------------------------------
create table public.payment_allocations (
  id         uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  member_id  uuid not null references public.members (id) on delete restrict,
  amount     numeric(12, 2) not null check (amount <> 0),
  created_at timestamptz not null default now(),
  unique (payment_id, member_id)
);

create index payment_allocations_member_idx  on public.payment_allocations (member_id);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id);


-- ---------------------------------------------------------------------
-- 8. fund_expenses: money out of the Till (M-PESA charges, withdrawals)
--    Amounts are stored as positive numbers.
-- ---------------------------------------------------------------------
create table public.fund_expenses (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('charge', 'withdrawal', 'other')),
  amount        numeric(12, 2) not null check (amount > 0),
  occurred_at   timestamptz not null,
  mpesa_receipt text,
  description   text,
  note          text,
  import_id     uuid references public.imports (id) on delete set null,
  created_by    text,
  created_at    timestamptz not null default now()
);

-- A charge shares its receipt with the payment it belongs to, so uniqueness
-- is on receipt PLUS kind.
create unique index fund_expenses_receipt_kind_uq
  on public.fund_expenses (mpesa_receipt, kind)
  where mpesa_receipt is not null;

create index fund_expenses_occurred_idx on public.fund_expenses (occurred_at desc);


-- ---------------------------------------------------------------------
-- 9. sms_log: every SMS attempt (including dry runs)
-- ---------------------------------------------------------------------
create table public.sms_log (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('reminder', 'report', 'test')),
  period            text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  member_id         uuid references public.members (id) on delete set null,
  to_phone          text,
  message           text not null,
  status            text not null check (status in ('dry_run', 'sent', 'failed', 'skipped')),
  skip_reason       text,
  provider_response jsonb,
  error             text,
  created_at        timestamptz not null default now()
);

-- One SMS per member, per kind, per period can ever be marked "sent",
-- so a retry can never double-send.
create unique index sms_log_one_sent_idx
  on public.sms_log (kind, period, member_id)
  where status = 'sent' and member_id is not null;

create index sms_log_period_idx on public.sms_log (period, kind);


-- ---------------------------------------------------------------------
-- 10. job_runs: scheduled job history (feeds the admin health panel)
-- ---------------------------------------------------------------------
create table public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  details     jsonb
);

create index job_runs_job_idx on public.job_runs (job, started_at desc);


-- ---------------------------------------------------------------------
-- 11. login_attempts: throttling for member and admin logins
-- ---------------------------------------------------------------------
create table public.login_attempts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('member', 'admin')),
  identifier text not null,
  ip         text,
  succeeded  boolean not null,
  created_at timestamptz not null default now()
);

create index login_attempts_identifier_idx on public.login_attempts (kind, identifier, created_at desc);
create index login_attempts_ip_idx         on public.login_attempts (ip, created_at desc);


-- ---------------------------------------------------------------------
-- 12. message_board
-- ---------------------------------------------------------------------
create table public.message_board (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid references public.members (id) on delete set null,
  sender_name text not null check (length(btrim(sender_name)) > 0),
  content     text not null check (length(btrim(content)) > 0),
  is_private  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index message_board_created_idx on public.message_board (created_at desc);


-- ---------------------------------------------------------------------
-- 13. family_nodes: kept exactly as it is today (cleaned up in Step 10).
--     "if not exists" means an existing table and its data are untouched.
-- ---------------------------------------------------------------------
create table if not exists public.family_nodes (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  spouse_name      text,
  parents          uuid[] default '{}'::uuid[],
  birthdate        text,
  work_education   text,
  bio              text,
  phone            text,
  created_at       timestamptz not null default timezone('utc'::text, now()),
  parent_id        uuid references public.family_nodes (id),
  spouse_id        uuid references public.family_nodes (id)
);


-- ---------------------------------------------------------------------
-- 14. Lock everything down
--     RLS on, no policies: the public anon key can do nothing.
--     The server uses the service-role key, which bypasses RLS.
-- ---------------------------------------------------------------------
alter table public.settings            enable row level security;
alter table public.members             enable row level security;
alter table public.member_phones       enable row level security;
alter table public.payer_aliases       enable row level security;
alter table public.imports             enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.fund_expenses       enable row level security;
alter table public.sms_log             enable row level security;
alter table public.job_runs            enable row level security;
alter table public.login_attempts      enable row level security;
alter table public.message_board       enable row level security;
alter table public.family_nodes        enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;


-- ---------------------------------------------------------------------
-- 15. Check: every table should show rls_enabled = true
-- ---------------------------------------------------------------------
select
  c.relname          as table_name,
  c.relrowsecurity   as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;
