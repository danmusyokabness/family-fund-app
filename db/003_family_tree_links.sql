-- =====================================================================
-- db/003_family_tree_links.sql
-- Links a family-tree node to a member account, and adds a real
-- date-of-birth column that can be sorted (decisions D19 and D20).
--
-- SAFE TO RUN TWICE. Adds columns only if they are missing; changes no data.
-- Supabase dashboard > SQL Editor > New query > paste > Run.
-- Expected result: "Success. No rows returned".
-- =====================================================================

alter table public.family_nodes
  add column if not exists member_id uuid references public.members (id) on delete set null;

alter table public.family_nodes
  add column if not exists date_of_birth date;
