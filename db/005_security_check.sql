-- =====================================================================
-- db/005_security_check.sql
-- Makes sure nobody can read or change your data except through the
-- website's own server, then shows you proof.
--
-- WHAT IT DOES
--   1. Turns on Row Level Security on EVERY table in the public schema
--      (including any added later).
--   2. Takes away all access to those tables from the two public database
--      roles, "anon" (anyone holding the public key) and "authenticated".
--      The website's server uses the private service key, which is not
--      affected, so nothing in the app changes.
--   3. Shows a table so you can SEE the result.
--
-- SAFE TO RUN TWICE. It never drops, deletes or changes any data.
--
-- HOW TO RUN
--   Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
-- EXPECTED RESULT
--   A list of your tables. In EVERY row: row_level_security_on = true,
--   anon_can_read = false, signed_in_role_can_read = false.
--   If any row shows something different, send me a screenshot.
-- =====================================================================

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Anything created in future should start locked too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- The proof:
select
  c.relname                                             as table_name,
  c.relrowsecurity                                      as row_level_security_on,
  has_table_privilege('anon', c.oid, 'select')          as anon_can_read,
  has_table_privilege('authenticated', c.oid, 'select') as signed_in_role_can_read
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
