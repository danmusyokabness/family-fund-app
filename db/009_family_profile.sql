-- =====================================================================
-- db/009_family_profile.sql
-- Family tree: the details people are asked for the first time they open
-- the tree (education, work, where they live), and a mark for "this person
-- has filled in their details". Also the flag that will let a member be
-- "family only" (not contributing to the fund) later.
--
-- WHAT IT DOES
--   * family_nodes.education  : a list of where they studied (starts empty)
--   * family_nodes.work       : a list of work they have done (starts empty)
--   * family_nodes.residence  : where they live (empty until given)
--   * family_nodes.profile_completed_at : empty until they fill in their
--       details; every existing person therefore gets asked once
--   * members.contributes     : true for everyone (nothing uses it yet)
--
-- SAFE TO RUN TWICE. It only ADDS columns. It never changes or removes any
-- existing data, payments, members or balances.
--
-- HOW TO RUN
--   Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
--   Run it BEFORE putting the new version of the site online (the new site
--   reads these columns).
-- EXPECTED RESULT
--   One row, and all four values must be true.
-- =====================================================================

alter table public.family_nodes
  add column if not exists education jsonb not null default '[]'::jsonb,
  add column if not exists work jsonb not null default '[]'::jsonb,
  add column if not exists residence jsonb,
  add column if not exists profile_completed_at timestamptz;

alter table public.members
  add column if not exists contributes boolean not null default true;

-- The check:
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes' and column_name = 'education') as has_education,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes' and column_name = 'work') as has_work,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes' and column_name = 'residence')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes' and column_name = 'profile_completed_at') as has_residence_and_completed,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'contributes') as has_contributes;
