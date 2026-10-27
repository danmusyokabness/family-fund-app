-- =====================================================================
-- db/007_tree_privacy_chat.sql
-- Family tree: photos, "who can see which detail", spouse details.
-- Chat: messages to a specific member, and to the admin.
--
-- SAFE TO RUN TWICE. It never drops or deletes anything.
--
-- HOW TO RUN
--   Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
--   Do this BEFORE the new code is deployed.
-- EXPECTED RESULT
--   A small table at the bottom with every value "true".
-- =====================================================================

-- ---- Family tree -------------------------------------------------------

-- Details this person has chosen not to show to the rest of the family.
alter table public.family_nodes add column if not exists hidden_fields text[] not null default '{}';

-- A small profile photo (a compressed picture, kept as text) and a flag so lists do not have to load it.
alter table public.family_nodes add column if not exists photo text;
alter table public.family_nodes add column if not exists has_photo boolean not null default false;

-- Optional extra information about the spouse.
alter table public.family_nodes add column if not exists spouse_details text;

-- Phone numbers already on the tree were entered when the rule was "phones are for admins only".
-- Keep them hidden until their owner chooses to show them. (Only entries that have not
-- hidden anything yet are touched, so running this again changes nothing.)
update public.family_nodes
   set hidden_fields = array['phone']
 where phone is not null
   and phone <> ''
   and not ('phone' = any (hidden_fields));

-- ---- Chat --------------------------------------------------------------

-- A message can now be addressed to one member (a private chat between two members) ...
alter table public.message_board
  add column if not exists recipient_member_id uuid references public.members (id) on delete set null;

-- ... or marked as being for the admin.
alter table public.message_board
  add column if not exists to_admin boolean not null default false;

-- Until now every private message was a member writing to the admin.
update public.message_board
   set to_admin = true
 where is_private
   and coalesce(is_from_admin, false) = false
   and recipient_member_id is null
   and to_admin = false;

create index if not exists message_board_recipient_idx on public.message_board (recipient_member_id, created_at desc);
create index if not exists message_board_to_admin_idx on public.message_board (to_admin, created_at desc);

-- ---- Check: every value should say true ----------------------------------
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes'  and column_name = 'hidden_fields')       as nodes_hidden_fields,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes'  and column_name = 'photo')                as nodes_photo,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes'  and column_name = 'has_photo')            as nodes_has_photo,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'family_nodes'  and column_name = 'spouse_details')       as nodes_spouse_details,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'message_board' and column_name = 'recipient_member_id') as chat_recipient,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'message_board' and column_name = 'to_admin')            as chat_to_admin;
