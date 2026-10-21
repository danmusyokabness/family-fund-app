-- =====================================================================
-- db/002_add_member_admin.sql
-- Lets a member be an admin (decision D18).
--
-- SAFE TO RUN TWICE. Adds the column only if it is missing; changes no data.
-- Supabase dashboard > SQL Editor > New query > paste > Run.
-- Expected result: "Success. No rows returned".
-- =====================================================================

alter table public.members
  add column if not exists is_admin boolean not null default false;
