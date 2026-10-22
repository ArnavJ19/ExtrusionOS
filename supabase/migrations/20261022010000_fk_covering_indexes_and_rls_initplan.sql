-- Performance advisor follow-up (BUGS-MEGA security/advisor gate).
--
-- 1. Every foreign key in the public and private schemas without an index whose
--    leading columns cover the key columns gets one. Joins, ON DELETE checks and
--    company/parent lookups stop scanning the child table. Indexes only; no
--    table, constraint, policy or row changes.
-- 2. RLS policies in public that call auth.uid() directly are rewritten to call
--    (select auth.uid()), so PostgreSQL evaluates it once per statement instead
--    of once per row. The expression is otherwise identical: roles, command,
--    permissive/restrictive mode and every other predicate are unchanged, and
--    the rewrite asserts that only the auth.uid() call sites differ.
--
-- Not changed on purpose: multiple permissive policies (merging them changes
-- the access model) and unused indexes (removal is not an accepted fix).
-- Repeatable: a second run finds nothing to index or rewrite.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $migration$
declare
  v_fk record;
  v_name text;
  v_created integer := 0;
begin
  for v_fk in
    select c.conrelid, n.nspname as schema_name, t.relname as table_name, c.conname,
      c.conkey,
      (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
         from unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as column_list,
      (select string_agg(a.attname, '_' order by k.ord)
         from unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as column_label
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname in ('public', 'private')
      and t.relkind in ('r', 'p')
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and i.indpred is null
          and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
          and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
      )
    order by n.nspname, t.relname, c.conname
  loop
    v_name := format('%s_%s_fk_idx', v_fk.table_name, v_fk.column_label);
    if length(v_name) > 63 then
      v_name := left(v_name, 54) || '_' || left(md5(v_name), 8);
    end if;
    -- A same-named relation elsewhere in the schema would make IF NOT EXISTS skip this key.
    if exists (select 1 from pg_class r join pg_namespace s on s.oid = r.relnamespace where s.nspname = v_fk.schema_name and r.relname = v_name) then
      v_name := left(v_name, 54) || '_' || left(md5(v_fk.conname || ':' || v_fk.conrelid::text), 8);
    end if;
    execute format('create index if not exists %I on %I.%I (%s)', v_name, v_fk.schema_name, v_fk.table_name, v_fk.column_list);
    v_created := v_created + 1;
  end loop;
  raise notice 'Foreign-key covering indexes created: %', v_created;
end;
$migration$;

do $migration$
declare
  v_policy record;
  v_qual text;
  v_check text;
  v_new_qual text;
  v_new_check text;
  v_marker constant text := '<<wrapped-auth-uid>>';
  v_wrapped constant text := '( SELECT auth.uid() AS uid)';
  v_rewritten integer := 0;
begin
  -- Deparse and re-parse with the same search_path so unqualified names
  -- resolve to the same objects.
  perform set_config('search_path', 'public, pg_catalog', true);
  for v_policy in
    select p.oid, p.polname, c.relname, p.polqual, p.polwithcheck, p.polrelid
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    order by c.relname, p.polname
  loop
    v_qual := pg_get_expr(v_policy.polqual, v_policy.polrelid);
    v_check := pg_get_expr(v_policy.polwithcheck, v_policy.polrelid);
    v_new_qual := replace(replace(replace(v_qual, v_wrapped, v_marker), 'auth.uid()', '(select auth.uid())'), v_marker, v_wrapped);
    v_new_check := replace(replace(replace(v_check, v_wrapped, v_marker), 'auth.uid()', '(select auth.uid())'), v_marker, v_wrapped);
    if v_new_qual is not distinct from v_qual and v_new_check is not distinct from v_check then
      continue;
    end if;
    -- Only the auth.uid() call sites may differ.
    if replace(coalesce(v_new_qual, ''), '(select auth.uid())', 'auth.uid()') <> coalesce(v_qual, '')
       or replace(coalesce(v_new_check, ''), '(select auth.uid())', 'auth.uid()') <> coalesce(v_check, '') then
      raise exception 'Unexpected policy rewrite for %.%', v_policy.relname, v_policy.polname;
    end if;
    if v_new_qual is not null and v_new_check is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', v_policy.polname, v_policy.relname, v_new_qual, v_new_check);
    elsif v_new_qual is not null then
      execute format('alter policy %I on public.%I using (%s)', v_policy.polname, v_policy.relname, v_new_qual);
    else
      execute format('alter policy %I on public.%I with check (%s)', v_policy.polname, v_policy.relname, v_new_check);
    end if;
    v_rewritten := v_rewritten + 1;
  end loop;
  raise notice 'RLS policies rewritten to evaluate auth.uid() once per statement: %', v_rewritten;
end;
$migration$;

commit;
