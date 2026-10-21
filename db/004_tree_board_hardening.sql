-- =====================================================================
-- db/004_tree_board_hardening.sql
-- Batch 1 of the completion work (21 Oct 2026).
--
-- WHAT IT ADDS
--   1. members.sort_order        The admin's manual order for members whose
--                                age is not known yet (the up/down arrows).
--   2. family_nodes              Soft delete (deleted_at), updated_at, who
--                                created it, and indexes. Nothing is ever
--                                permanently deleted (decision A3).
--   3. family_node_history       A change log for the family tree, so any
--                                edit can be undone (decision D12).
--   4. message_board             Columns for private conversations: whether
--                                a message is from the admin, when it was
--                                read, and soft delete (decision A2).
--
-- SAFE TO RUN TWICE. Everything uses "if not exists" or checks first.
-- It never drops, deletes or overwrites any existing data.
--
-- HOW TO RUN
--   Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
-- EXPECTED RESULT
--   A small table at the bottom with every column showing "true".
--   If any shows "false", send me a screenshot.
--
-- IMPORTANT: run this BEFORE deploying the new code to Vercel.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Manual member order
-- ---------------------------------------------------------------------
alter table public.members
  add column if not exists sort_order integer;

create index if not exists members_sort_order_idx on public.members (sort_order);


-- ---------------------------------------------------------------------
-- 2. Family tree: soft delete, audit columns, indexes
-- ---------------------------------------------------------------------
alter table public.family_nodes
  add column if not exists deleted_at timestamptz;

alter table public.family_nodes
  add column if not exists updated_at timestamptz not null default now();

alter table public.family_nodes
  add column if not exists created_by_member_id uuid references public.members (id) on delete set null;

create index if not exists family_nodes_parent_idx on public.family_nodes (parent_id);
create index if not exists family_nodes_spouse_idx on public.family_nodes (spouse_id);
create index if not exists family_nodes_member_idx on public.family_nodes (member_id);

-- One live tree node per member. If your existing data already has two
-- live nodes linked to the same member, this step is skipped with a
-- notice instead of failing, and the app still works.
do $$
begin
  create unique index if not exists family_nodes_one_per_member_idx
    on public.family_nodes (member_id)
    where member_id is not null and deleted_at is null;
exception
  when unique_violation then
    raise notice 'Skipped family_nodes_one_per_member_idx: two live nodes are linked to the same member. Fix that in the family tree, then run this file again.';
end $$;


-- ---------------------------------------------------------------------
-- 3. Family tree change log
-- ---------------------------------------------------------------------
create table if not exists public.family_node_history (
  id                   uuid primary key default gen_random_uuid(),
  node_id              uuid not null references public.family_nodes (id) on delete cascade,
  changed_by_member_id uuid references public.members (id) on delete set null,
  changed_by_name      text not null default 'Unknown',
  action               text not null check (action in ('create', 'update', 'delete', 'restore', 'link')),
  before               jsonb,
  after                jsonb,
  created_at           timestamptz not null default now(),
  undone_at            timestamptz
);

create index if not exists family_node_history_node_idx    on public.family_node_history (node_id, created_at desc);
create index if not exists family_node_history_created_idx on public.family_node_history (created_at desc);

alter table public.family_node_history enable row level security;


-- ---------------------------------------------------------------------
-- 4. Message board: private conversations
--    A private "thread" is all private rows with the same member_id:
--    the member's own messages plus the admin's replies.
-- ---------------------------------------------------------------------
alter table public.message_board
  add column if not exists is_from_admin boolean not null default false;

alter table public.message_board
  add column if not exists read_at timestamptz;

alter table public.message_board
  add column if not exists deleted_at timestamptz;

create index if not exists message_board_thread_idx
  on public.message_board (is_private, member_id, created_at desc);

-- A private message must belong to a member. "not valid" means rows that
-- already exist are not re-checked (so this can never fail on old data),
-- but every new row is checked.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'message_board_private_needs_member') then
    alter table public.message_board
      add constraint message_board_private_needs_member
      check (not is_private or member_id is not null) not valid;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 5. Lock everything down again (harmless if already done)
-- ---------------------------------------------------------------------
alter table public.family_nodes enable row level security;
alter table public.message_board enable row level security;
alter table public.members enable row level security;

revoke all on public.family_node_history from anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. Check: every value below should say true
-- ---------------------------------------------------------------------
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members'          and column_name = 'sort_order')     as members_sort_order,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes'     and column_name = 'deleted_at')     as nodes_deleted_at,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes'     and column_name = 'updated_at')     as nodes_updated_at,
  exists (select 1 from information_schema.tables  where table_schema = 'public' and table_name = 'family_node_history')                                  as history_table,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'message_board'    and column_name = 'is_from_admin')  as board_is_from_admin,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'message_board'    and column_name = 'read_at')        as board_read_at,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'message_board'    and column_name = 'deleted_at')     as board_deleted_at;
