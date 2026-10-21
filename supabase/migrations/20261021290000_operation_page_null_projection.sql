begin;

-- Authorized views deliberately mask restricted fields with NULL. Omit those
-- keys at the database-page response boundary, including nested lookup objects.
-- Patch only the final aggregation so the fixed manifest, tenant predicates,
-- invoker permissions, ordering, and ten-row pagination remain unchanged.
do $migration$
declare
  v_function regprocedure := to_regprocedure('public.get_operation_database_page(text,text,jsonb,text,text,integer,date,date)');
  v_definition text;
  v_old constant text := 'jsonb_agg(row_data)';
  v_new constant text := 'jsonb_agg(jsonb_strip_nulls(row_data))';
begin
  if v_function is null then
    raise exception 'Operation database page prerequisite is missing';
  end if;
  if (select prosecdef from pg_proc where oid = v_function) then
    raise exception 'Operation database page must remain SECURITY INVOKER';
  end if;
  v_definition := pg_get_functiondef(v_function);
  if strpos(v_definition, v_new) > 0 then
    return;
  end if;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Operation database page projection has changed; review before applying';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

commit;
